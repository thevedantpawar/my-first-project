import { redact } from './errors.js';

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  // Fields go first: a caller field named `msg` used to replace the log message
  // outright, so every error line read as the error's own text and the call
  // site was invisible. Reserved keys now win.
  const line = {
    ...redactFields(fields),
    ts: new Date().toISOString(),
    level,
    msg: redact(message),
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
