import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import {
  assertLinkedInReady,
  publishTextPost,
  sanitizePostId,
  uploadImage,
} from '../src/providers/linkedin.js';
import { clearProviderEnv } from './fixtures.js';

const PERSON_URN = 'urn:li:person:AbC123';
const POST_URN = 'urn:li:share:7300000000000000000';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function configureCredentials(): void {
  process.env.LINKEDIN_ACCESS_TOKEN = 'test-access-token-value';
  process.env.LINKEDIN_PERSON_URN = PERSON_URN;
  clearProviderEnvExceptLinkedIn();
}

function clearProviderEnvExceptLinkedIn(): void {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const urn = process.env.LINKEDIN_PERSON_URN;
  clearProviderEnv();
  if (token) process.env.LINKEDIN_ACCESS_TOKEN = token;
  if (urn) process.env.LINKEDIN_PERSON_URN = urn;
}

beforeEach(() => clearProviderEnv());
afterEach(() => clearProviderEnv());

describe('credential checks', () => {
  it('fails when the access token is missing', () => {
    process.env.LINKEDIN_PERSON_URN = PERSON_URN;
    clearProviderEnvExceptLinkedIn();
    expect(() => assertLinkedInReady()).toThrowError(/LINKEDIN_ACCESS_TOKEN is not configured/);
  });

  it('fails when the person URN is missing', () => {
    process.env.LINKEDIN_ACCESS_TOKEN = 'token';
    clearProviderEnvExceptLinkedIn();
    expect(() => assertLinkedInReady()).toThrowError(/LINKEDIN_PERSON_URN is not configured/);
  });

  it('rejects a person URN with the wrong prefix', () => {
    process.env.LINKEDIN_ACCESS_TOKEN = 'token';
    process.env.LINKEDIN_PERSON_URN = 'urn:li:organization:12345';
    clearProviderEnvExceptLinkedIn();
    expect(() => assertLinkedInReady()).toThrowError(/must start with "urn:li:person:"/);
  });

  it('never calls LinkedIn when credentials are missing', async () => {
    const fetchImpl = vi.fn();
    await expect(publishTextPost({ commentary: 'hello', fetchImpl })).rejects.toThrowError(
      /LINKEDIN_ACCESS_TOKEN/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts a well-formed configuration', () => {
    configureCredentials();
    expect(assertLinkedInReady().personUrn).toBe(PERSON_URN);
  });
});

describe('publishing', () => {
  it('publishes a text-only post and returns sanitized metadata', async () => {
    configureCredentials();
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, {}, { 'x-restli-id': POST_URN }),
    ) as unknown as typeof fetch;

    const result = await publishTextPost({ commentary: 'A post body', fetchImpl });

    expect(result).toEqual({
      status: 'published',
      httpStatus: 201,
      postId: POST_URN,
      postUrl: `https://www.linkedin.com/feed/update/${POST_URN}/`,
    });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.linkedin.com/rest/posts');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.author).toBe(PERSON_URN);
    expect(body.commentary).toBe('A post body');
    expect(body.lifecycleState).toBe('PUBLISHED');
    expect(body.content).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('test-access-token-value');
  });

  it('maps a 401 to an expired or invalid token', async () => {
    configureCredentials();
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { message: 'Invalid access token' }),
    ) as unknown as typeof fetch;
    await expect(publishTextPost({ commentary: 'x', fetchImpl })).rejects.toMatchObject({
      code: 'linkedin_unauthorized',
      httpStatus: 401,
    });
  });

  it('maps a 403 to a permission error', async () => {
    configureCredentials();
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    await expect(publishTextPost({ commentary: 'x', fetchImpl })).rejects.toMatchObject({
      code: 'linkedin_forbidden',
    });
  });

  it('maps a 409 to a duplicate-post conflict', async () => {
    configureCredentials();
    const fetchImpl = vi.fn(async () => jsonResponse(409, {})) as unknown as typeof fetch;
    await expect(publishTextPost({ commentary: 'x', fetchImpl })).rejects.toMatchObject({
      code: 'linkedin_conflict',
    });
  });

  it('maps a 429 to a rate limit', async () => {
    configureCredentials();
    const fetchImpl = vi.fn(async () => jsonResponse(429, {})) as unknown as typeof fetch;
    await expect(publishTextPost({ commentary: 'x', fetchImpl })).rejects.toMatchObject({
      code: 'linkedin_rate_limited',
      httpStatus: 429,
    });
  });

  it('refuses to report success when LinkedIn returns no post id', async () => {
    configureCredentials();
    const fetchImpl = vi.fn(async () => jsonResponse(201, {})) as unknown as typeof fetch;
    await expect(publishTextPost({ commentary: 'x', fetchImpl })).rejects.toThrowError(
      /returned no post id/,
    );
  });

  it('never puts the access token into an error message', async () => {
    configureCredentials();
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { message: 'Bearer test-access-token-value rejected' }),
    ) as unknown as typeof fetch;
    const error = await publishTextPost({ commentary: 'x', fetchImpl }).catch((caught) => caught);
    expect(error).toBeInstanceOf(AppError);
    const serialized = JSON.stringify({
      message: (error as AppError).message,
      details: (error as AppError).details,
    });
    expect(serialized).not.toContain('test-access-token-value');
  });

  it('attaches an image only via a LinkedIn image URN', async () => {
    configureCredentials();
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, {}, { 'x-restli-id': POST_URN }),
    ) as unknown as typeof fetch;

    await publishTextPost({
      commentary: 'A post body',
      imageUrn: 'urn:li:image:C123',
      imageAltText: 'diagram',
      fetchImpl,
    });

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as { content?: { media?: { id?: string } } };
    expect(body.content?.media?.id).toBe('urn:li:image:C123');
  });
});

describe('image upload', () => {
  it('initializes, uploads the bytes and returns the URN', async () => {
    configureCredentials();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('initializeUpload')) {
        return jsonResponse(200, {
          value: { uploadUrl: 'https://upload.linkedin.example/abc', image: 'urn:li:image:C123' },
        });
      }
      return new Response('', { status: 201 });
    }) as unknown as typeof fetch;

    const urn = await uploadImage({ base64: Buffer.from('png-bytes').toString('base64'), mimeType: 'image/png' }, { fetchImpl });

    expect(urn).toBe('urn:li:image:C123');
    expect(calls[0]).toContain('/rest/images?action=initializeUpload');
    expect(calls[1]).toBe('https://upload.linkedin.example/abc');
  });

  it('surfaces an upload failure as a LinkedIn error', async () => {
    configureCredentials();
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('initializeUpload')
        ? jsonResponse(200, { value: { uploadUrl: 'https://upload.example/x', image: 'urn:li:image:C1' } })
        : new Response('', { status: 429 }),
    ) as unknown as typeof fetch;

    await expect(
      uploadImage({ base64: 'AAAA', mimeType: 'image/png' }, { fetchImpl }),
    ).rejects.toMatchObject({ code: 'linkedin_rate_limited' });
  });
});

describe('sanitizePostId', () => {
  it('keeps URN characters and drops anything else', () => {
    expect(sanitizePostId(' urn:li:share:123 \n')).toBe('urn:li:share:123');
    expect(sanitizePostId('urn:li:share:123<script>')).toBe('urn:li:share:123script');
  });
});
