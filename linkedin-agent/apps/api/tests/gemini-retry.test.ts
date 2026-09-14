import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../src/config.js';
import { generateJson, isTransientGeminiError, modelLadder } from '../src/providers/gemini.js';
import { AppError } from '../src/lib/errors.js';
import { clearProviderEnv } from './fixtures.js';

const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } } };

function options(fetchImpl: typeof fetch) {
  return { systemInstruction: 'system', prompt: 'prompt', responseSchema: SCHEMA, fetchImpl };
}

function okResponse(): Response {
  return Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ ok: true }) }] } }],
  });
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message, status: 'UNAVAILABLE' } }), { status });
}

beforeEach(() => {
  clearProviderEnv();
  process.env.GEMINI_API_KEY = 'test-key';
  // Most cases here are about the retry ladder on one model; the fallback
  // ladder gets its own describe block below.
  process.env.GEMINI_FALLBACK_MODELS = '';
  resetConfigCache();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_FALLBACK_MODELS;
  clearProviderEnv();
});

/** Drives the fake clock forward until the pending promise settles. */
async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
  await vi.runAllTimersAsync();
  const outcome = await settled;
  if (outcome.error !== undefined) throw outcome.error;
  return outcome.value as T;
}

describe('transient error classification', () => {
  it('treats 503 as transient and 429 as not', () => {
    expect(
      isTransientGeminiError(new AppError('gemini_failed', 'busy', { httpStatus: 503 })),
    ).toBe(true);
    expect(
      isTransientGeminiError(new AppError('gemini_quota', 'quota', { httpStatus: 429 })),
    ).toBe(false);
    expect(
      isTransientGeminiError(new AppError('gemini_failed', 'bad request', { httpStatus: 400 })),
    ).toBe(false);
  });
});

describe('generateJson retry behaviour', () => {
  it('retries a 503 "high demand" response and succeeds', async () => {
    // This is the exact failure seen in production: one spike must not lose the
    // day's scheduled post.
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1
        ? errorResponse(503, 'This model is currently experiencing high demand.')
        : okResponse();
    }) as unknown as typeof fetch;

    const result = await runWithTimers(generateJson(options(fetchImpl)));
    expect(result).toEqual({ ok: true });
    expect(call).toBe(2);
  });

  it('gives up after the configured attempts and reports the real error', async () => {
    const fetchImpl = vi.fn(async () =>
      errorResponse(503, 'This model is currently experiencing high demand.'),
    ) as unknown as typeof fetch;

    await expect(runWithTimers(generateJson(options(fetchImpl)))).rejects.toMatchObject({
      code: 'gemini_failed',
      httpStatus: 503,
    });
    // Initial attempt plus the three backoff steps.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
  });

  it('never retries a quota error', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'quota', status: 'RESOURCE_EXHAUSTED' } }), {
        status: 429,
      }),
    ) as unknown as typeof fetch;

    await expect(runWithTimers(generateJson(options(fetchImpl)))).rejects.toMatchObject({
      code: 'gemini_quota',
    });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('never retries a client error', async () => {
    const fetchImpl = vi.fn(async () =>
      errorResponse(400, 'Invalid request'),
    ) as unknown as typeof fetch;

    await expect(runWithTimers(generateJson(options(fetchImpl)))).rejects.toMatchObject({
      httpStatus: 400,
    });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe('model fallback', () => {
  function modelOf(call: unknown[]): string {
    return decodeURIComponent(String(call[0]).split('/models/')[1]?.split(':')[0] ?? '');
  }

  it('orders the ladder and drops duplicates and blanks', () => {
    expect(modelLadder('primary', ['', ' backup ', 'primary', 'last'])).toEqual([
      'primary',
      'backup',
      'last',
    ]);
  });

  it('moves to the next model once the primary is out of retries', async () => {
    // 2026-09-14: the primary answered 503 for twenty minutes straight and the
    // day's post was lost because there was nowhere else to go.
    process.env.GEMINI_MODEL = 'busy-model';
    process.env.GEMINI_FALLBACK_MODELS = 'spare-model';
    resetConfigCache();

    const fetchImpl = vi.fn(async (url: unknown) =>
      String(url).includes('busy-model')
        ? errorResponse(503, 'This model is currently experiencing high demand.')
        : okResponse(),
    ) as unknown as typeof fetch;

    const result = await runWithTimers(generateJson(options(fetchImpl)));
    expect(result).toEqual({ ok: true });

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    // Four attempts on the primary, then one on the spare.
    expect(calls.map(modelOf)).toEqual([
      'busy-model',
      'busy-model',
      'busy-model',
      'busy-model',
      'spare-model',
    ]);

    delete process.env.GEMINI_MODEL;
  });

  it('does not reach for a fallback when the primary fails for a real reason', async () => {
    process.env.GEMINI_FALLBACK_MODELS = 'spare-model';
    resetConfigCache();

    const fetchImpl = vi.fn(async () =>
      errorResponse(400, 'Invalid request'),
    ) as unknown as typeof fetch;

    await expect(runWithTimers(generateJson(options(fetchImpl)))).rejects.toMatchObject({
      httpStatus: 400,
    });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('reports the primary error, not the fallback\'s, when everything fails', async () => {
    // A stale fallback name would otherwise surface as "model not found" and
    // send the next person debugging the wrong thing.
    process.env.GEMINI_MODEL = 'busy-model';
    process.env.GEMINI_FALLBACK_MODELS = 'missing-model';
    resetConfigCache();

    const fetchImpl = vi.fn(async (url: unknown) =>
      String(url).includes('busy-model')
        ? errorResponse(503, 'This model is currently experiencing high demand.')
        : errorResponse(404, 'models/missing-model is not found.'),
    ) as unknown as typeof fetch;

    await expect(runWithTimers(generateJson(options(fetchImpl)))).rejects.toMatchObject({
      httpStatus: 503,
    });

    delete process.env.GEMINI_MODEL;
  });
});
