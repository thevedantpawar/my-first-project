import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../src/lib/logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function captureWarn(run: () => void): Record<string, unknown> {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  run();
  return JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
}

describe('log line shape', () => {
  it('keeps the message when a field is named msg', () => {
    // Ten call sites passed `msg` as a field. The spread put it after the
    // reserved key, so every one of those lines showed the error text and hid
    // which call site produced it — including the run that lost a post.
    const line = captureWarn(() => {
      logger.warn('The revision attempt failed', { msg: 'Gemini quota reached' });
    });
    expect(line.msg).toBe('The revision attempt failed');
  });

  it('still records the caller fields', () => {
    const line = captureWarn(() => {
      logger.warn('Quality gate blocked a draft', { reasons: ['too long'], postType: 'Story' });
    });
    expect(line).toMatchObject({
      level: 'warn',
      msg: 'Quality gate blocked a draft',
      reasons: ['too long'],
      postType: 'Story',
    });
  });
});
