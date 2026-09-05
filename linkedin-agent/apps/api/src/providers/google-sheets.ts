import { getConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const LOG_COLUMNS = [
  'timestamp',
  'trigger',
  'status',
  'postType',
  'topic',
  'researchSource',
  'linkedinHook',
  'linkedinPost',
  'qualityPassed',
  'qualityReasons',
  'linkedinHttpStatus',
  'linkedinPostId',
  'imageStatus',
  'errorMessage',
] as const;

export type LogRow = Record<(typeof LOG_COLUMNS)[number], string>;

export interface SheetsLogResult {
  logged: boolean;
  sheet: string | null;
  /** Populated when logging failed; the LinkedIn result is reported separately. */
  error: string | null;
}

/**
 * Sheets can authenticate two ways:
 *
 * - A refresh token plus client id/secret. Preferred, and the only option that
 *   works unattended: the scheduler runs daily and a Google access token lasts
 *   about an hour.
 * - A bare access token. Fine for a manual test, dead by tomorrow.
 */
export function isSheetsConfigured(): boolean {
  const config = getConfig();
  if (config.GOOGLE_SHEETS_ID === '') return false;
  const hasRefreshFlow =
    config.GOOGLE_SHEETS_CLIENT_ID !== '' &&
    config.GOOGLE_SHEETS_CLIENT_SECRET !== '' &&
    config.GOOGLE_SHEETS_REFRESH_TOKEN !== '';
  return hasRefreshFlow || config.GOOGLE_SHEETS_ACCESS_TOKEN !== '';
}

export function sheetsAuthMode(): 'refresh_token' | 'access_token' | 'none' {
  const config = getConfig();
  if (
    config.GOOGLE_SHEETS_CLIENT_ID !== '' &&
    config.GOOGLE_SHEETS_CLIENT_SECRET !== '' &&
    config.GOOGLE_SHEETS_REFRESH_TOKEN !== ''
  ) {
    return 'refresh_token';
  }
  return config.GOOGLE_SHEETS_ACCESS_TOKEN === '' ? 'none' : 'access_token';
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/** Test helper: drops the cached access token. */
export function resetSheetsTokenCache(): void {
  cachedToken = null;
}

/**
 * Mints an access token from the refresh token, or returns the static one.
 * Cached until a minute before expiry so a daily run makes one token call.
 */
export async function resolveAccessToken(
  options: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<string> {
  const config = getConfig();
  const now = options.now ?? Date.now();

  if (sheetsAuthMode() === 'access_token') return config.GOOGLE_SHEETS_ACCESS_TOKEN;
  if (sheetsAuthMode() === 'none') {
    throw new AppError('sheets_unauthorized', 'Google Sheets credentials are not configured.');
  }

  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.value;

  const doFetch = options.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    client_id: config.GOOGLE_SHEETS_CLIENT_ID,
    client_secret: config.GOOGLE_SHEETS_CLIENT_SECRET,
    refresh_token: config.GOOGLE_SHEETS_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });

  const response = await doFetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new AppError(
      'sheets_unauthorized',
      `Could not exchange the Google refresh token (HTTP ${response.status}). Re-run the consent flow to get a new one.`,
      { httpStatus: response.status },
    );
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new AppError('sheets_unauthorized', 'Google returned no access token.');
  }

  cachedToken = {
    value: payload.access_token,
    expiresAt: now + Math.max(((payload.expires_in ?? 3600) - 60) * 1000, 0),
  };
  return cachedToken.value;
}

function toRowValues(row: LogRow): string[] {
  return LOG_COLUMNS.map((column) => row[column] ?? '');
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Creates a missing tab and writes its header row.
 *
 * A new spreadsheet only has "Sheet1", so the first run would otherwise fail
 * with "Unable to parse range" until someone added the tabs by hand.
 */
async function createSheetTab(
  accessToken: string,
  spreadsheetId: string,
  sheet: string,
  doFetch: typeof fetch,
): Promise<void> {
  const createResponse = await doFetch(
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: sheet } } }],
      }),
    },
  );

  if (!createResponse.ok) {
    throw new AppError(
      'sheets_failed',
      `Could not create the "${sheet}" tab (HTTP ${createResponse.status}).`,
      { httpStatus: createResponse.status, details: (await safeText(createResponse)).slice(0, 200) },
    );
  }

  const headerResponse = await doFetch(
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheet}!A1`)}` +
      ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ values: [[...LOG_COLUMNS]] }),
    },
  );

  if (!headerResponse.ok) {
    throw new AppError(
      'sheets_failed',
      `Created the "${sheet}" tab but could not write its header row (HTTP ${headerResponse.status}).`,
      { httpStatus: headerResponse.status },
    );
  }

  logger.info('Created a missing Google Sheets tab', { sheet });
}

async function appendValues(
  accessToken: string,
  spreadsheetId: string,
  sheet: string,
  values: string[],
  doFetch: typeof fetch,
): Promise<Response> {
  const range = `${sheet}!A1`;
  const url =
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}` +
    ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
  return doFetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ values: [values] }),
  });
}

/**
 * Appends one run to the published or blocked sheet.
 *
 * Logging failures are returned, not thrown: a Sheets outage must never hide
 * or overwrite what actually happened on LinkedIn.
 */
export async function appendRunRow(
  row: LogRow,
  options: { published: boolean; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<SheetsLogResult> {
  const config = getConfig();
  if (!isSheetsConfigured()) {
    return { logged: false, sheet: null, error: 'Google Sheets is not configured.' };
  }

  const sheet = options.published
    ? config.GOOGLE_SHEETS_PUBLISHED_SHEET
    : config.GOOGLE_SHEETS_BLOCKED_SHEET;
  const doFetch = options.fetchImpl ?? fetch;
  const values = toRowValues(row);

  try {
    const accessToken = await resolveAccessToken(
      options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
    );

    let response = await appendValues(accessToken, config.GOOGLE_SHEETS_ID, sheet, values, doFetch);

    // A missing tab comes back as 400 "Unable to parse range". Create it once
    // and retry, so first-run setup needs nothing but a spreadsheet id.
    if (response.status === 400) {
      const body = await safeText(response);
      if (/unable to parse range/i.test(body)) {
        await createSheetTab(accessToken, config.GOOGLE_SHEETS_ID, sheet, doFetch);
        response = await appendValues(accessToken, config.GOOGLE_SHEETS_ID, sheet, values, doFetch);
      } else {
        return { logged: false, sheet, error: `Google Sheets rejected the request: ${body.slice(0, 200)}` };
      }
    }

    if (response.status === 401 || response.status === 403) {
      resetSheetsTokenCache();
      return {
        logged: false,
        sheet,
        error: `Google Sheets authentication failed (HTTP ${response.status}). The credentials are invalid, expired, or lack access to this spreadsheet.`,
      };
    }
    if (response.status === 404) {
      return {
        logged: false,
        sheet,
        error: 'Google Sheets returned 404. Check GOOGLE_SHEETS_ID and that the authorised account can open that spreadsheet.',
      };
    }
    if (!response.ok) {
      return { logged: false, sheet, error: `Google Sheets returned HTTP ${response.status}.` };
    }
    return { logged: true, sheet, error: null };
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.message
        : error instanceof Error && error.name === 'AbortError'
          ? 'Google Sheets request timed out.'
          : `Google Sheets request failed: ${error instanceof Error ? error.message : String(error)}`;
    return { logged: false, sheet, error: message };
  }
}

export function assertSheetsConfigured(): void {
  if (!isSheetsConfigured()) {
    throw new AppError(
      'config_missing',
      'Set GOOGLE_SHEETS_ID plus either GOOGLE_SHEETS_REFRESH_TOKEN (with client id and secret) or GOOGLE_SHEETS_ACCESS_TOKEN.',
    );
  }
}
