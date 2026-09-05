import { getConfig } from '../config.js';
import { AppError, redact } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const REST_BASE = 'https://api.linkedin.com/rest';

export interface LinkedInPublishResult {
  status: 'published';
  httpStatus: number;
  postId: string;
  postUrl: string | null;
}

export interface PublishOptions {
  commentary: string;
  /** Image URN from `uploadImage`. Never a URL — LinkedIn only accepts its own URN. */
  imageUrn?: string | null;
  imageAltText?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Verifies publishing credentials before any network call, so a
 * misconfiguration is a clear config error rather than a LinkedIn 401.
 */
export function assertLinkedInReady(): { accessToken: string; personUrn: string; apiVersion: string } {
  const config = getConfig();
  if (config.LINKEDIN_ACCESS_TOKEN === '') {
    throw new AppError('config_missing', 'LINKEDIN_ACCESS_TOKEN is not configured.');
  }
  if (config.LINKEDIN_PERSON_URN === '') {
    throw new AppError('config_missing', 'LINKEDIN_PERSON_URN is not configured.');
  }
  if (!config.LINKEDIN_PERSON_URN.startsWith('urn:li:person:')) {
    throw new AppError(
      'config_invalid',
      'LINKEDIN_PERSON_URN must start with "urn:li:person:". Use the authenticated member URN, not a numeric id or a company URN.',
    );
  }
  return {
    accessToken: config.LINKEDIN_ACCESS_TOKEN,
    personUrn: config.LINKEDIN_PERSON_URN,
    apiVersion: config.LINKEDIN_API_VERSION || defaultLinkedInVersion(),
  };
}

function formatVersion(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * LinkedIn keeps each monthly `LinkedIn-Version` alive for roughly a year, so
 * any version pinned in configuration eventually stops working. Default to last
 * month rather than this one: the current month's version is not always live on
 * the first.
 */
export function defaultLinkedInVersion(now: Date = new Date()): string {
  return formatVersion(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

/** Version candidates, newest first, for negotiating past a retired version. */
export function recentLinkedInVersions(now: Date = new Date(), count = 12): string[] {
  const versions: string[] = [];
  for (let monthsBack = 0; monthsBack < count; monthsBack += 1) {
    versions.push(
      formatVersion(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1))),
    );
  }
  return versions;
}

/**
 * The version that last worked, so one negotiation serves the whole process.
 * Cleared by tests.
 */
let negotiatedVersion: string | null = null;

export function resetNegotiatedVersion(): void {
  negotiatedVersion = null;
}

export function getNegotiatedVersion(): string | null {
  return negotiatedVersion;
}

function headers(accessToken: string, apiVersion: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    'x-restli-protocol-version': '2.0.0',
    'linkedin-version': apiVersion,
  };
}

/** Post ids are not secrets, but they are echoed to logs — keep them to safe characters. */
export function sanitizePostId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9:_-]/g, '');
}

function mapLinkedInError(status: number, body: string): AppError {
  // Redact before the snippet is ever stored on the error — an upstream body
  // can echo the Authorization header back at us.
  const snippet = redact(body).slice(0, 300);
  switch (status) {
    case 401:
      return new AppError(
        'linkedin_unauthorized',
        'LinkedIn rejected the access token (401). It is invalid or expired — re-run the OAuth flow to get a new member token.',
        { httpStatus: status, details: snippet },
      );
    case 403:
      return new AppError(
        'linkedin_forbidden',
        'LinkedIn refused the request (403). The token is missing the w_member_social permission, or the author URN is not the authenticated member.',
        { httpStatus: status, details: snippet },
      );
    case 409:
      return new AppError(
        'linkedin_conflict',
        'LinkedIn reported a conflict (409). This usually means a duplicate post was already created — check the profile before retrying.',
        { httpStatus: status, details: snippet },
      );
    case 426:
      return new AppError(
        'linkedin_version',
        'LinkedIn rejected the API version (426). Each monthly LinkedIn-Version is retired after about a year — set LINKEDIN_API_VERSION to a current YYYYMM value.',
        { httpStatus: status, details: snippet },
      );
    case 429:
      return new AppError(
        'linkedin_rate_limited',
        'LinkedIn rate limit reached (429). Wait for the window to reset; do not retry in a loop.',
        { httpStatus: status, details: snippet },
      );
    default:
      return new AppError('linkedin_failed', `LinkedIn returned HTTP ${status}.`, {
        httpStatus: status,
        details: snippet,
      });
  }
}

async function request(
  url: string,
  init: RequestInit,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<Response> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    return await doFetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError('linkedin_failed', 'LinkedIn request timed out.', { cause: error });
    }
    throw new AppError(
      'linkedin_failed',
      `LinkedIn request failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sends a versioned REST request, negotiating the version on a 426.
 *
 * A retired version is indistinguishable from a broken deployment at 21:00, so
 * rather than fail the day's post the client walks recent versions and uses the
 * first LinkedIn still accepts, then remembers it.
 */
async function requestVersioned(
  url: string,
  build: (version: string) => RequestInit,
  configuredVersion: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<Response> {
  const candidates =
    negotiatedVersion !== null
      ? [negotiatedVersion]
      : [...new Set([configuredVersion, ...recentLinkedInVersions()].filter(Boolean))];

  let lastBody = '';
  for (const version of candidates) {
    const response = await request(url, build(version), options);
    if (response.status !== 426) {
      if (negotiatedVersion === null && version !== configuredVersion) {
        logger.warn('LinkedIn version was retired; negotiated a working one', {
          configured: configuredVersion,
          using: version,
          hint: 'Set LINKEDIN_API_VERSION to this value to skip negotiation.',
        });
      }
      negotiatedVersion = version;
      return response;
    }
    lastBody = redact(await safeText(response));
  }

  throw new AppError(
    'linkedin_version',
    `LinkedIn rejected every API version tried (${candidates.join(', ')}). Check LinkedIn's current versioning documentation and set LINKEDIN_API_VERSION.`,
    { httpStatus: 426, details: lastBody.slice(0, 300) },
  );
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Publishes to the authenticated member's own profile.
 *
 * This is the only write this system performs on LinkedIn. There is no comment
 * monitoring, no automatic reply, no commenter mention, no messaging and no
 * connection request anywhere in this codebase.
 */
export async function publishTextPost(options: PublishOptions): Promise<LinkedInPublishResult> {
  const { accessToken, personUrn, apiVersion } = assertLinkedInReady();

  const body: Record<string, unknown> = {
    author: personUrn,
    commentary: options.commentary,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };

  if (options.imageUrn) {
    body.content = {
      media: {
        id: options.imageUrn,
        ...(options.imageAltText ? { altText: options.imageAltText } : {}),
      },
    };
  }

  const response = await requestVersioned(
    `${REST_BASE}/posts`,
    (version) => ({
      method: 'POST',
      headers: headers(accessToken, version),
      body: JSON.stringify(body),
    }),
    apiVersion,
    { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs },
  );

  if (!response.ok) {
    throw mapLinkedInError(response.status, await safeText(response));
  }

  const headerId = response.headers.get('x-restli-id') ?? response.headers.get('x-linkedin-id') ?? '';
  let postId = sanitizePostId(headerId);
  if (postId === '') {
    const text = await safeText(response);
    try {
      const parsed = JSON.parse(text) as { id?: string };
      postId = sanitizePostId(parsed.id ?? '');
    } catch {
      postId = '';
    }
  }

  if (postId === '') {
    // A 2xx with no id means we cannot prove the post exists; do not claim success.
    throw new AppError(
      'linkedin_failed',
      `LinkedIn accepted the request (HTTP ${response.status}) but returned no post id. Check the profile before retrying.`,
      { httpStatus: response.status },
    );
  }

  logger.info('LinkedIn post published', { httpStatus: response.status, postId });

  return {
    status: 'published',
    httpStatus: response.status,
    postId,
    postUrl: postId.startsWith('urn:li:')
      ? `https://www.linkedin.com/feed/update/${postId}/`
      : null,
  };
}

/**
 * Three-step LinkedIn image upload: initialize, PUT the bytes, return the URN.
 * Only the returned URN may be attached to a post — a fake or external image
 * URL is never sent.
 */
export async function uploadImage(
  image: { base64: string; mimeType: string },
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<string> {
  const { accessToken, personUrn, apiVersion } = assertLinkedInReady();

  const initResponse = await requestVersioned(
    `${REST_BASE}/images?action=initializeUpload`,
    (version) => ({
      method: 'POST',
      headers: headers(accessToken, version),
      body: JSON.stringify({ initializeUploadRequest: { owner: personUrn } }),
    }),
    apiVersion,
    options,
  );

  if (!initResponse.ok) {
    throw mapLinkedInError(initResponse.status, await safeText(initResponse));
  }

  const initBody = (await initResponse.json()) as {
    value?: { uploadUrl?: string; image?: string };
  };
  const uploadUrl = initBody.value?.uploadUrl;
  const imageUrn = initBody.value?.image;
  if (!uploadUrl || !imageUrn) {
    throw new AppError('linkedin_failed', 'LinkedIn did not return an image upload URL.');
  }

  const bytes = Buffer.from(image.base64, 'base64');
  const uploadResponse = await request(
    uploadUrl,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': image.mimeType,
      },
      body: new Uint8Array(bytes),
    },
    options,
  );

  if (!uploadResponse.ok) {
    throw mapLinkedInError(uploadResponse.status, await safeText(uploadResponse));
  }

  return imageUrn;
}

export interface LinkedInTokenCheck {
  valid: boolean;
  /** Whether the token's own member id matches LINKEDIN_PERSON_URN. */
  urnMatches: boolean | null;
  configuredUrn: string;
  derivedUrn: string | null;
  name: string | null;
  httpStatus: number | null;
  error: string | null;
}

/**
 * Read-only check that the member token still works and belongs to the
 * configured person.
 *
 * An expired token is the most likely failure this system will ever hit, and
 * without this you would discover it at 21:00 when a post fails. Calls
 * /v2/userinfo, which publishes nothing.
 */
export async function verifyLinkedInToken(
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<LinkedInTokenCheck> {
  const config = getConfig();
  const base: LinkedInTokenCheck = {
    valid: false,
    urnMatches: null,
    configuredUrn: config.LINKEDIN_PERSON_URN,
    derivedUrn: null,
    name: null,
    httpStatus: null,
    error: null,
  };

  let credentials: { accessToken: string; personUrn: string };
  try {
    credentials = assertLinkedInReady();
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }

  try {
    const response = await request(
      'https://api.linkedin.com/v2/userinfo',
      { method: 'GET', headers: { authorization: `Bearer ${credentials.accessToken}` } },
      options,
    );

    if (!response.ok) {
      const mapped = mapLinkedInError(response.status, await safeText(response));
      return { ...base, httpStatus: response.status, error: mapped.message };
    }

    const payload = (await response.json()) as { sub?: string; name?: string };
    const derivedUrn = payload.sub ? `urn:li:person:${payload.sub}` : null;
    return {
      valid: true,
      urnMatches: derivedUrn === null ? null : derivedUrn === credentials.personUrn,
      configuredUrn: credentials.personUrn,
      derivedUrn,
      name: payload.name ?? null,
      httpStatus: response.status,
      error: null,
    };
  } catch (error) {
    return { ...base, error: error instanceof Error ? redact(error.message) : String(error) };
  }
}
