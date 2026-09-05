import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { clearProviderEnv, useTemporaryDataDir } from './fixtures.js';

let server: Server;
let baseUrl: string;
let temp: { dir: string; cleanup: () => void };

async function get(path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: await response.json() };
}

async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  clearProviderEnv();
  temp = useTemporaryDataDir();
  const app = createApp(null);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No port assigned');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  temp.cleanup();
});

describe('health and status', () => {
  it('reports health', async () => {
    const { status, body } = await get('/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('reports status without leaking credentials', async () => {
    const { status, body } = await get('/api/workflows/linkedin-content/status');
    expect(status).toBe(200);
    expect(body.platform).toBe('linkedin_only');
    expect(body.providers).toEqual({
      gemini: false,
      tavily: false,
      linkedin: false,
      googleSheets: false,
    });
    expect(body.scheduler.days).toBe('Monday-Friday');
    expect(body.scheduler.timeZone).toBe('Asia/Kolkata');
    expect(body.dryRun.defaultEnabled).toBe(true);
    expect(body.unsupportedCapabilities.join(' ')).toContain('DMs');
    expect(JSON.stringify(body)).not.toMatch(/ACCESS_TOKEN["']?\s*[:=]\s*["'][^"']+/);
  });

  it('returns 404 for an unknown endpoint', async () => {
    const { status } = await get('/api/does-not-exist');
    expect(status).toBe(404);
  });
});

describe('strategy, calendar and profile audit', () => {
  it('returns the strategy configuration', async () => {
    const { status, body } = await get('/api/linkedin/strategy');
    expect(status).toBe(200);
    expect(body.beliefs).toHaveLength(3);
    expect(body.painSignals.length).toBeGreaterThan(0);
    expect(body.unsupportedCapabilities.join(' ')).toContain('Twitter/X');
  });

  it('returns a Monday-Friday calendar', async () => {
    const { status, body } = await get('/api/linkedin/calendar?weeks=2');
    expect(status).toBe(200);
    expect(body.entries).toHaveLength(10);
    expect(body.entries.every((entry: { weekday: number }) => entry.weekday <= 5)).toBe(true);
  });

  it('rejects an out-of-range calendar window', async () => {
    const { status } = await get('/api/linkedin/calendar?weeks=99');
    expect(status).toBe(400);
  });

  it('returns the profile audit with warnings', async () => {
    const { status, body } = await get('/api/linkedin/profile-audit');
    expect(status).toBe(200);
    expect(body.total).toBeGreaterThan(0);
    expect(body.warnings.length).toBeGreaterThan(0);
  });
});

describe('libraries', () => {
  it('accepts an authenticity pack and reads it back', async () => {
    const created = await post('/api/linkedin/authenticity-pack', {
      rawNotes: 'We fixed the retry path after a duplicate email went out.',
    });
    expect(created.status).toBe(201);
    const { body } = await get('/api/linkedin/authenticity-pack');
    expect(body.ideas).toHaveLength(1);
    expect(body.suggestions).toHaveLength(1);
  });

  it('rejects an empty authenticity pack', async () => {
    const { status } = await post('/api/linkedin/authenticity-pack', {});
    expect(status).toBe(400);
  });

  it('accepts a swipe-file pattern entry', async () => {
    const { status } = await post('/api/linkedin/swipe-file', {
      format: 'audit',
      hookPattern: 'One symptom, then numbered checks.',
      structure: 'symptom, checks, fix, CTA',
      whyItWorks: 'Fast self-diagnosis.',
    });
    expect(status).toBe(201);
    const listed = await get('/api/linkedin/swipe-file');
    expect(listed.body.entries).toHaveLength(1);
  });

  it('refuses a swipe-file entry that admits copying text', async () => {
    const { status, body } = await post('/api/linkedin/swipe-file', {
      format: 'text',
      copiedText: true,
    });
    expect(status).toBe(400);
    expect(body.error.message).toContain('record patterns, not copied posts');
  });
});

describe('analytics', () => {
  it('records post metrics and returns computed rates', async () => {
    const created = await post('/api/linkedin/analytics', {
      postId: 'urn:li:share:1',
      publishedAt: '2026-09-01T15:30:00.000Z',
      postType: 'Named Problem',
      ctaType: 'save',
      impressions: 1000,
      reactions: 40,
      comments: 8,
      reposts: 2,
      profileViews: 30,
    });
    expect(created.status).toBe(201);

    const { body } = await get('/api/linkedin/analytics');
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].rates.engagementRate).toBeCloseTo(0.05);
    expect(body.followerTarget.guaranteed).toBe(false);
  });

  it('records a follower sample', async () => {
    const { status } = await post('/api/linkedin/analytics', {
      followerSample: { date: '2026-09-01', followers: 420, note: 'baseline' },
    });
    expect(status).toBe(201);
  });

  it('generates a monthly review', async () => {
    const { status, body } = await post('/api/linkedin/monthly-review', { windowDays: 90 });
    expect(status).toBe(200);
    expect(body.recommendations.length).toBeGreaterThan(0);
    expect(body.followerTarget.guaranteed).toBe(false);
  });

  it('rejects an out-of-range review window', async () => {
    const { status } = await post('/api/linkedin/monthly-review', { windowDays: 3 });
    expect(status).toBe(400);
  });
});

describe('publish guards', () => {
  it('refuses to publish without an explicit confirmation', async () => {
    const { status, body } = await post('/api/linkedin/publish', {});
    expect(status).toBe(400);
    expect(body.error.message).toContain('explicit confirmation');
  });

  it('rejects an unknown agent id', async () => {
    const { status, body } = await post('/api/agents/trigger', { agentId: 'twitter-agent' });
    expect(status).toBe(400);
    expect(body.error.message).toContain('linkedin-content-agent');
  });
});
