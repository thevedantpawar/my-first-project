import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../src/config.js';
import {
  defaultLinkedInVersion,
  getNegotiatedVersion,
  publishTextPost,
  recentLinkedInVersions,
  resetNegotiatedVersion,
} from '../src/providers/linkedin.js';
import { clearProviderEnv } from './fixtures.js';

const POST_URN = 'urn:li:share:7300000000000000009';

/** The exact body LinkedIn returned when the pinned version had been retired. */
function retiredVersionResponse(version: string): Response {
  return new Response(
    JSON.stringify({
      status: 426,
      code: 'NONEXISTENT_VERSION',
      message: `Requested version ${version}01 is not active`,
    }),
    { status: 426 },
  );
}

function versionOf(init: RequestInit | undefined): string {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return headers['linkedin-version'] ?? '';
}

beforeEach(() => {
  clearProviderEnv();
  resetNegotiatedVersion();
  process.env.LINKEDIN_ACCESS_TOKEN = 'test-token';
  process.env.LINKEDIN_PERSON_URN = 'urn:li:person:AbC123';
  resetConfigCache();
});

afterEach(() => {
  resetNegotiatedVersion();
  clearProviderEnv();
});

describe('version derivation', () => {
  it('defaults to last month, not this one', () => {
    // The current month's version is not always live on the first.
    expect(defaultLinkedInVersion(new Date('2026-09-05T00:00:00Z'))).toBe('202608');
    expect(defaultLinkedInVersion(new Date('2026-01-15T00:00:00Z'))).toBe('202512');
  });

  it('lists recent versions newest first and crosses the year boundary', () => {
    const versions = recentLinkedInVersions(new Date('2026-02-10T00:00:00Z'), 4);
    expect(versions).toEqual(['202602', '202601', '202512', '202511']);
  });

  it('never repeats a version', () => {
    const versions = recentLinkedInVersions(new Date('2026-09-05T00:00:00Z'), 12);
    expect(new Set(versions).size).toBe(12);
  });
});

describe('negotiating past a retired version', () => {
  it('walks forward from a retired pinned version and publishes', async () => {
    process.env.LINKEDIN_API_VERSION = '202506';
    resetConfigCache();

    const tried: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const version = versionOf(init);
      tried.push(version);
      // Reproduces the live failure: the pinned version is long retired.
      if (version === '202506') return retiredVersionResponse(version);
      return new Response('{}', { status: 201, headers: { 'x-restli-id': POST_URN } });
    }) as unknown as typeof fetch;

    const result = await publishTextPost({ commentary: 'body', fetchImpl });

    expect(result.postId).toBe(POST_URN);
    expect(tried[0]).toBe('202506');
    expect(tried.length).toBeGreaterThan(1);
    expect(getNegotiatedVersion()).not.toBe('202506');
  });

  it('reuses the negotiated version on the next publish', async () => {
    process.env.LINKEDIN_API_VERSION = '202506';
    resetConfigCache();

    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) =>
      versionOf(init) === '202506'
        ? retiredVersionResponse('202506')
        : new Response('{}', { status: 201, headers: { 'x-restli-id': POST_URN } }),
    ) as unknown as typeof fetch;

    await publishTextPost({ commentary: 'first', fetchImpl });
    const callsAfterFirst = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    await publishTextPost({ commentary: 'second', fetchImpl });
    const callsAfterSecond = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    // The second publish costs exactly one request: no re-negotiation.
    expect(callsAfterSecond - callsAfterFirst).toBe(1);
  });

  it('reports clearly when no version is accepted', async () => {
    process.env.LINKEDIN_API_VERSION = '202506';
    resetConfigCache();

    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) =>
      retiredVersionResponse(versionOf(init)),
    ) as unknown as typeof fetch;

    await expect(publishTextPost({ commentary: 'body', fetchImpl })).rejects.toMatchObject({
      code: 'linkedin_version',
      httpStatus: 426,
    });
    await expect(publishTextPost({ commentary: 'body', fetchImpl })).rejects.toThrowError(
      /rejected every API version tried/,
    );
  });

  it('sends a current version when none is pinned', async () => {
    delete process.env.LINKEDIN_API_VERSION;
    resetConfigCache();

    let sent = '';
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      sent = versionOf(init);
      return new Response('{}', { status: 201, headers: { 'x-restli-id': POST_URN } });
    }) as unknown as typeof fetch;

    await publishTextPost({ commentary: 'body', fetchImpl });
    expect(sent).toBe(defaultLinkedInVersion());
    expect(sent).not.toBe('202506');
  });

  it('does not retry a 401 as if it were a version problem', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(publishTextPost({ commentary: 'body', fetchImpl })).rejects.toMatchObject({
      code: 'linkedin_unauthorized',
    });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});
