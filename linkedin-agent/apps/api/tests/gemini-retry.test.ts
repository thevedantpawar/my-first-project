import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../src/config.js';
import { generateJson, isTransientGeminiError } from '../src/providers/gemini.js';
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
  resetConfigCache();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.GEMINI_API_KEY;
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
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
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
