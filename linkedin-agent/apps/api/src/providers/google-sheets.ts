import { getConfig } from '../config.js';
import { AppError } from '../lib/errors.js';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

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

export function isSheetsConfigured(): boolean {
  const config = getConfig();
  return config.GOOGLE_SHEETS_ID !== '' && config.GOOGLE_SHEETS_ACCESS_TOKEN !== '';
}

function toRowValues(row: LogRow): string[] {
  return LOG_COLUMNS.map((column) => row[column] ?? '');
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
  const range = `${sheet}!A1`;
  const url =
    `${SHEETS_BASE}/${encodeURIComponent(config.GOOGLE_SHEETS_ID)}/values/${encodeURIComponent(range)}` +
    ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);

  try {
    const response = await doFetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.GOOGLE_SHEETS_ACCESS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ values: [toRowValues(row)] }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      return {
        logged: false,
        sheet,
        error: `Google Sheets authentication failed (HTTP ${response.status}). The access token is invalid, expired, or lacks access to this spreadsheet.`,
      };
    }
    if (!response.ok) {
      return { logged: false, sheet, error: `Google Sheets returned HTTP ${response.status}.` };
    }
    return { logged: true, sheet, error: null };
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Google Sheets request timed out.'
        : `Google Sheets request failed: ${error instanceof Error ? error.message : String(error)}`;
    return { logged: false, sheet, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

export function assertSheetsConfigured(): void {
  if (!isSheetsConfigured()) {
    throw new AppError(
      'config_missing',
      'GOOGLE_SHEETS_ID and GOOGLE_SHEETS_ACCESS_TOKEN must both be set to log runs.',
    );
  }
}
