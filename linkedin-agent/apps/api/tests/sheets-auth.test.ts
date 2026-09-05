import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../src/config.js';
import {
  appendRunRow,
  isSheetsConfigured,
  resetSheetsTokenCache,
  resolveAccessToken,
  sheetsAuthMode,
  LOG_COLUMNS,
} from '../src/providers/google-sheets.js';
import type { LogRow } from '../src/providers/google-sheets.js';
import { clearProviderEnv } from './fixtures.js';

function row(): LogRow {
  return Object.fromEntries(LOG_COLUMNS.map((column) => [column, column])) as LogRow;
}

function useRefreshFlow(): void {
  process.env.GOOGLE_SHEETS_ID = 'sheet-id';
  process.env.GOOGLE_SHEETS_CLIENT_ID = 'client-id';
  process.env.GOOGLE_SHEETS_CLIENT_SECRET = 'client-secret';
  process.env.GOOGLE_SHEETS_REFRESH_TOKEN = 'refresh-token';
  resetConfigCache();
}

beforeEach(() => {
  clearProviderEnv();
  resetSheetsTokenCache();
});

afterEach(() => {
  for (const key of [
    'GOOGLE_SHEETS_ID',
    'GOOGLE_SHEETS_CLIENT_ID',
    'GOOGLE_SHEETS_CLIENT_SECRET',
    'GOOGLE_SHEETS_REFRESH_TOKEN',
  ]) {
    delete process.env[key];
  }
  resetSheetsTokenCache();
  clearProviderEnv();
});

describe('authentication mode', () => {
  it('is none with no credentials', () => {
    process.env.GOOGLE_SHEETS_ID = 'sheet-id';
    resetConfigCache();
    expect(sheetsAuthMode()).toBe('none');
    expect(isSheetsConfigured()).toBe(false);
  });

  it('prefers the refresh flow when both are present', () => {
    useRefreshFlow();
    process.env.GOOGLE_SHEETS_ACCESS_TOKEN = 'static-token';
    resetConfigCache();
    expect(sheetsAuthMode()).toBe('refresh_token');
  });

  it('falls back to a static access token', () => {
    process.env.GOOGLE_SHEETS_ID = 'sheet-id';
    process.env.GOOGLE_SHEETS_ACCESS_TOKEN = 'static-token';
    resetConfigCache();
    expect(sheetsAuthMode()).toBe('access_token');
    expect(isSheetsConfigured()).toBe(true);
  });

  it('needs a spreadsheet id as well as a credential', () => {
    process.env.GOOGLE_SHEETS_ACCESS_TOKEN = 'static-token';
    resetConfigCache();
    expect(isSheetsConfigured()).toBe(false);
  });
});

describe('refresh token exchange', () => {
  it('mints an access token and caches it until just before expiry', async () => {
    useRefreshFlow();
    const fetchImpl = vi.fn(async () =>
      Response.json({ access_token: 'minted-token', expires_in: 3600 }),
    ) as unknown as typeof fetch;

    const first = await resolveAccessToken({ fetchImpl, now: 0 });
    const second = await resolveAccessToken({ fetchImpl, now: 60_000 });

    expect(first).toBe('minted-token');
    expect(second).toBe('minted-token');
    // Cached: an unattended daily run should not mint a token per request.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('re-mints once the cached token has expired', async () => {
    useRefreshFlow();
    const fetchImpl = vi.fn(async () =>
      Response.json({ access_token: 'minted-token', expires_in: 3600 }),
    ) as unknown as typeof fetch;

    await resolveAccessToken({ fetchImpl, now: 0 });
    await resolveAccessToken({ fetchImpl, now: 3_600_000 });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('reports a rejected refresh token clearly', async () => {
    useRefreshFlow();
    const fetchImpl = vi.fn(async () =>
      new Response('{"error":"invalid_grant"}', { status: 400 }),
    ) as unknown as typeof fetch;

    await expect(resolveAccessToken({ fetchImpl, now: 0 })).rejects.toThrowError(
      /Re-run the consent flow/,
    );
  });
});

describe('appending a run', () => {
  it('creates a missing tab, writes its header, then retries the append', async () => {
    useRefreshFlow();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      calls.push(href);
      if (href.includes('oauth2.googleapis.com')) {
        return Response.json({ access_token: 'minted-token', expires_in: 3600 });
      }
      if (href.includes(':batchUpdate')) {
        const body = JSON.parse(String(init?.body)) as {
          requests: { addSheet: { properties: { title: string } } }[];
        };
        expect(body.requests[0]?.addSheet.properties.title).toBe('published');
        return Response.json({});
      }
      // First append fails because the tab does not exist yet.
      const appendsSoFar = calls.filter((call) => call.includes(':append')).length;
      if (appendsSoFar === 1) {
        return new Response('{"error":{"message":"Unable to parse range: published!A1"}}', {
          status: 400,
        });
      }
      return Response.json({});
    }) as unknown as typeof fetch;

    const result = await appendRunRow(row(), { published: true, fetchImpl });

    expect(result).toEqual({ logged: true, sheet: 'published', error: null });
    expect(calls.some((call) => call.includes(':batchUpdate'))).toBe(true);
    // Header write plus the two appends.
    expect(calls.filter((call) => call.includes(':append'))).toHaveLength(3);
  });

  it('reports an auth failure without throwing', async () => {
    useRefreshFlow();
    const fetchImpl = vi.fn(async (url: string | URL) =>
      String(url).includes('oauth2.googleapis.com')
        ? Response.json({ access_token: 'minted-token', expires_in: 3600 })
        : new Response('{}', { status: 403 }),
    ) as unknown as typeof fetch;

    const result = await appendRunRow(row(), { published: true, fetchImpl });
    expect(result.logged).toBe(false);
    expect(result.error).toContain('authentication failed');
  });

  it('explains a 404 as a wrong spreadsheet id', async () => {
    useRefreshFlow();
    const fetchImpl = vi.fn(async (url: string | URL) =>
      String(url).includes('oauth2.googleapis.com')
        ? Response.json({ access_token: 'minted-token', expires_in: 3600 })
        : new Response('{}', { status: 404 }),
    ) as unknown as typeof fetch;

    const result = await appendRunRow(row(), { published: true, fetchImpl });
    expect(result.error).toContain('GOOGLE_SHEETS_ID');
  });

  it('routes a blocked run to the blocked tab', async () => {
    useRefreshFlow();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      return String(url).includes('oauth2.googleapis.com')
        ? Response.json({ access_token: 'minted-token', expires_in: 3600 })
        : Response.json({});
    }) as unknown as typeof fetch;

    const result = await appendRunRow(row(), { published: false, fetchImpl });
    expect(result.sheet).toBe('blocked');
    expect(calls.some((call) => call.includes('blocked'))).toBe(true);
  });

  it('never throws when Sheets is unconfigured', async () => {
    resetConfigCache();
    const result = await appendRunRow(row(), { published: true });
    expect(result).toEqual({ logged: false, sheet: null, error: 'Google Sheets is not configured.' });
  });
});
