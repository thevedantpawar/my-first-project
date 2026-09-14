import { getConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GenerateJsonOptions {
  systemInstruction: string;
  prompt: string;
  /** Gemini responseSchema — forces the model to return the content package shape. */
  responseSchema: Record<string, unknown>;
  temperature?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  model?: string;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

function assertConfigured(): string {
  const key = getConfig().GEMINI_API_KEY;
  if (key === '') {
    throw new AppError(
      'config_missing',
      'GEMINI_API_KEY is not configured. Content generation cannot run.',
    );
  }
  return key;
}

async function callGemini(
  model: string,
  body: Record<string, unknown>,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<GeminiResponse> {
  const apiKey = assertConfigured();
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);

  try {
    const response = await doFetch(`${BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: GeminiResponse = {};
    try {
      payload = text === '' ? {} : (JSON.parse(text) as GeminiResponse);
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const message = payload.error?.message ?? `HTTP ${response.status}`;
      if (response.status === 429 || payload.error?.status === 'RESOURCE_EXHAUSTED') {
        // Quota is not transient in any useful sense — retrying just burns it.
        throw new AppError('gemini_quota', `Gemini quota or rate limit reached: ${message}`, {
          httpStatus: response.status,
        });
      }
      throw new AppError('gemini_failed', `Gemini request failed: ${message}`, {
        httpStatus: response.status,
      });
    }

    if (payload.promptFeedback?.blockReason) {
      throw new AppError(
        'gemini_failed',
        `Gemini blocked the prompt: ${payload.promptFeedback.blockReason}`,
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError('gemini_failed', 'Gemini request timed out.', { cause: error });
    }
    throw new AppError(
      'gemini_failed',
      `Gemini request failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** Server-side hiccups worth one more attempt; a 429 quota error is not one. */
const TRANSIENT_HTTP_STATUSES = new Set([500, 502, 503, 504]);

export function isTransientGeminiError(error: unknown): boolean {
  if (!(error instanceof AppError) || error.code !== 'gemini_failed') return false;
  // A timeout carries no HTTP status but is exactly the kind of blip worth one
  // more attempt — a real scheduled post was lost to one on 2026-09-09.
  if (error.httpStatus === undefined) return /timed out/i.test(error.message);
  return TRANSIENT_HTTP_STATUSES.has(error.httpStatus);
}

/**
 * A free-tier 429 names the bucket it emptied ("model: gemini-3.6-flash").
 * Each model has its own per-minute allowance, so a sibling is worth a try —
 * unlike a key-wide quota error, where changing models only burns more of it.
 * On 2026-09-14 the corrective revision died on exactly this: the primary's
 * minute was spent by the retries that had just got us a draft, and the run
 * gave up with two other models sitting idle.
 */
export function isModelScopedQuotaError(error: unknown): boolean {
  return (
    error instanceof AppError &&
    error.code === 'gemini_quota' &&
    /\bmodel:\s*\S/i.test(error.message)
  );
}

// A 503 "high demand" spike lasts minutes, not seconds. The old 1.5s + 4s
// ladder gave up 5.5 seconds in and cost a real scheduled post on 2026-09-14.
const RETRY_DELAYS_MS = [5_000, 20_000, 60_000];

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `attempt`, retrying only "the model is busy" style failures.
 * "This model is currently experiencing high demand" arrives as a 503 and is
 * usually gone within seconds — without this, one spike loses the whole day's
 * scheduled post.
 */
async function withTransientRetry<T>(
  attempt: () => Promise<T>,
  delays: number[] = RETRY_DELAYS_MS,
): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index <= delays.length; index += 1) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      const delay = delays[index];
      if (delay === undefined || !isTransientGeminiError(error)) throw error;
      logger.warn('Gemini returned a transient error; retrying', {
        attempt: index + 1,
        delayMs: delay,
        httpStatus: (error as AppError).httpStatus,
      });
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * The models to try, in order, when the configured one will not answer.
 * "High demand" is a per-model condition, so a sibling model on the same free
 * key is usually serving while the primary is saturated. On 2026-09-14 the
 * primary stayed 503 for over twenty minutes and there was nowhere to go.
 */
export function modelLadder(primary: string, fallbacks: string[]): string[] {
  const seen = new Set([primary]);
  const ladder = [primary];
  for (const candidate of fallbacks) {
    const model = candidate.trim();
    if (model === '' || seen.has(model)) continue;
    seen.add(model);
    ladder.push(model);
  }
  return ladder;
}

/**
 * Runs `attempt` down the model ladder. The primary gets the full retry ladder
 * and its errors are reported as-is; a fallback is a long shot, so anything it
 * throws (including "unknown model" from a stale config) only moves us on, and
 * the caller still sees the primary's error if nothing works.
 */
async function withModelFallback<T>(
  ladder: string[],
  attempt: (model: string) => Promise<T>,
): Promise<T> {
  let primaryError: unknown;
  for (const [index, model] of ladder.entries()) {
    const isPrimary = index === 0;
    try {
      return await withTransientRetry(() => attempt(model));
    } catch (error) {
      if (isPrimary) {
        const worthAnotherModel =
          isTransientGeminiError(error) || isModelScopedQuotaError(error);
        if (!worthAnotherModel || ladder.length === 1) throw error;
        primaryError = error;
      }
      const next = ladder[index + 1];
      if (next === undefined) throw primaryError ?? error;
      logger.warn('Gemini model unavailable; trying the next model', { model, next });
    }
  }
  throw primaryError;
}

/** Generates one JSON object matching `responseSchema`. */
export async function generateJson(options: GenerateJsonOptions): Promise<unknown> {
  const config = getConfig();
  const ladder =
    options.model === undefined
      ? modelLadder(config.GEMINI_MODEL, config.GEMINI_FALLBACK_MODELS)
      : [options.model];
  const payload = await withModelFallback(ladder, (model) =>
    callGemini(
    model,
    {
      systemInstruction: { parts: [{ text: options.systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
      generationConfig: {
        temperature: options.temperature ?? 0.85,
        responseMimeType: 'application/json',
        responseSchema: options.responseSchema,
        candidateCount: 1,
      },
    },
      { timeoutMs: options.timeoutMs, fetchImpl: options.fetchImpl },
    ),
  );

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  if (text.trim() === '') {
    throw new AppError('gemini_invalid_output', 'Gemini returned an empty response.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    logger.warn('Gemini returned non-JSON output', { length: text.length });
    throw new AppError('gemini_invalid_output', 'Gemini returned output that is not valid JSON.', {
      cause,
    });
  }
}

export interface GeneratedImage {
  mimeType: string;
  /** Raw image bytes, base64-encoded exactly as the model returned them. */
  base64: string;
}

/**
 * Optional. Callers must treat a rejection as non-fatal and publish text-only.
 */
export async function generateImage(
  prompt: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch; model?: string } = {},
): Promise<GeneratedImage> {
  const config = getConfig();
  const model = options.model ?? config.GEMINI_IMAGE_MODEL;
  const payload = await callGemini(
    model,
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], candidateCount: 1 },
    },
    { timeoutMs: options.timeoutMs ?? 90_000, fetchImpl: options.fetchImpl },
  );

  const part = payload.candidates?.[0]?.content?.parts?.find((candidate) => candidate.inlineData);
  const data = part?.inlineData?.data;
  if (!data) {
    throw new AppError('image_failed', 'Gemini returned no image data.');
  }
  return { mimeType: part?.inlineData?.mimeType ?? 'image/png', base64: data };
}
