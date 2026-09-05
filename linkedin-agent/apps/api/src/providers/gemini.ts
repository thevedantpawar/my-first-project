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
  return (
    error instanceof AppError &&
    error.code === 'gemini_failed' &&
    error.httpStatus !== undefined &&
    TRANSIENT_HTTP_STATUSES.has(error.httpStatus)
  );
}

const RETRY_DELAYS_MS = [1_500, 4_000];

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

/** Generates one JSON object matching `responseSchema`. */
export async function generateJson(options: GenerateJsonOptions): Promise<unknown> {
  const config = getConfig();
  const model = options.model ?? config.GEMINI_MODEL;
  const payload = await withTransientRetry(() =>
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
