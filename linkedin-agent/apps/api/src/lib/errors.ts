/**
 * Typed errors. Every provider failure keeps its root cause and a machine
 * readable code so the workflow can decide what to do without string matching.
 */

export type ErrorCode =
  | 'config_missing'
  | 'config_invalid'
  | 'gemini_failed'
  | 'gemini_quota'
  | 'gemini_invalid_output'
  | 'tavily_failed'
  | 'linkedin_unauthorized'
  | 'linkedin_forbidden'
  | 'linkedin_conflict'
  | 'linkedin_rate_limited'
  | 'linkedin_version'
  | 'linkedin_failed'
  | 'sheets_unauthorized'
  | 'sheets_failed'
  | 'image_failed'
  | 'quality_blocked'
  | 'duplicate_run'
  | 'bad_request';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number | undefined;
  readonly details: string | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { httpStatus?: number; details?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = options.httpStatus;
    this.details = options.details;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: string) {
    super('config_missing', message, details === undefined ? {} : { details });
    this.name = 'ConfigError';
  }
}

export interface SanitizedError {
  code: ErrorCode | 'unknown';
  message: string;
  httpStatus?: number;
  details?: string;
}

/**
 * Turns anything thrown into a shape safe to return over HTTP or write to a
 * log. Secrets are stripped by `redact`, never by dropping the error.
 */
export function toSanitizedError(error: unknown): SanitizedError {
  if (error instanceof AppError) {
    const out: SanitizedError = { code: error.code, message: redact(error.message) };
    if (error.httpStatus !== undefined) out.httpStatus = error.httpStatus;
    if (error.details !== undefined) out.details = redact(error.details);
    return out;
  }
  if (error instanceof Error) {
    return { code: 'unknown', message: redact(error.message) };
  }
  return { code: 'unknown', message: redact(String(error)) };
}

const SECRET_PATTERNS: RegExp[] = [
  // Bearer tokens and Authorization headers.
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // Google API keys.
  /\bAIza[0-9A-Za-z._-]{10,}/g,
  // Tavily keys.
  /\btvly-[0-9A-Za-z._-]{8,}/g,
  // key=... / token=... / api_key=... in query strings or messages.
  /\b(api[_-]?key|access[_-]?token|token|secret|password)\b\s*[=:]\s*["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi,
];

/** Removes anything that looks like a credential from free text. */
export function redact(text: string): string {
  let output = text;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (match) => {
      const label = match.split(/[=:\s]/)[0] ?? 'secret';
      return `${label}=[redacted]`;
    });
  }
  return output;
}
