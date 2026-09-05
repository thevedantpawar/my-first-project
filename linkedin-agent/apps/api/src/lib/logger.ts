import { redact } from './errors.js';

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: redact(message),
    ...redactFields(fields),
  };
  const serialized = JSON.stringify(line);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
}

function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = typeof value === 'string' ? redact(value) : value;
  }
  return out;
}

export const logger = {
  info: (message: string, fields?: Record<string, unknown>) => emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit('error', message, fields),
};
