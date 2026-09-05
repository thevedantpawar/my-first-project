import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../src/config.js';
import { runLinkedInContentWorkflow } from '../src/workflows/linkedin-content-workflow.js';
import { loadRuns } from '../src/store/run-log.js';
import { clearProviderEnv, makeContent, useTemporaryDataDir } from './fixtures.js';
import type { ContentPackage } from '../src/validation/linkedin-content-schema.js';

const POST_URN = 'urn:li:share:7300000000000000001';

interface MockOptions {
  content?: Partial<ContentPackage>;
  tavilyStatus?: number;
  linkedinStatus?: number;
  linkedinBody?: unknown;
  sheetsStatus?: number;
  imageStatus?: number;
  imageBody?: unknown;
}

interface MockFetch {
  impl: typeof fetch;
  calls: string[];
}

function buildFetch(options: MockOptions = {}): MockFetch {
  const calls: string[] = [];
  const content = makeContent(options.content ?? {});

  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push(href);

    if (href.includes('api.tavily.com')) {
      if ((options.tavilyStatus ?? 200) !== 200) {
        return new Response('{}', { status: options.tavilyStatus ?? 500 });
      }
      return Response.json({
        results: [
          {
            title: 'Agent reliability report',
            url: 'https://example.com/report',
            published_date: '2026-02-10',
            content: 'Teams report that retry logic without state causes duplicate side effects.',
          },
        ],
      });
    }

    if (href.includes('generativelanguage.googleapis.com')) {
      // The image model uses the same host; route on the model in the path.
      if (href.includes('image')) {
        if ((options.imageStatus ?? 200) !== 200) {
          return new Response('{}', { status: options.imageStatus ?? 500 });
        }
        return Response.json(
          options.imageBody ?? {
            candidates: [
              { content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } },
            ],
          },
        );
      }
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(content) }] } }],
      });
    }

    if (href.includes('api.linkedin.com/rest/images')) {
      return Response.json({
        value: { uploadUrl: 'https://upload.linkedin.example/put', image: 'urn:li:image:C1' },
      });
    }
    if (href.includes('upload.linkedin.example')) {
      return new Response('', { status: 201 });
    }
    if (href.includes('api.linkedin.com/rest/posts')) {
      const status = options.linkedinStatus ?? 201;
      if (status >= 400) {
        return new Response(JSON.stringify(options.linkedinBody ?? {}), { status });
      }
      return new Response('{}', { status, headers: { 'x-restli-id': POST_URN } });
    }

    if (href.includes('sheets.googleapis.com')) {
      const status = options.sheetsStatus ?? 200;
      return new Response('{}', { status });
    }

    void init;
    throw new Error(`Unexpected fetch to ${href}`);
  }) as unknown as typeof fetch;

  return { impl, calls };
}

let temp: { dir: string; cleanup: () => void };

function configureAll(): void {
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.GEMINI_MODEL = 'gemini-3.6-flash';
  process.env.GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
  process.env.TAVILY_API_KEY = 'test-tavily-key';
  process.env.LINKEDIN_ACCESS_TOKEN = 'test-linkedin-token';
  process.env.LINKEDIN_PERSON_URN = 'urn:li:person:AbC123';
  resetConfigCache();
}

beforeEach(() => {
  clearProviderEnv();
  temp = useTemporaryDataDir();
  configureAll();
});

afterEach(() => {
  temp.cleanup();
  for (const key of ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_IMAGE_MODEL']) delete process.env[key];
  clearProviderEnv();
});

describe('draft mode', () => {
  it('generates and validates but never calls LinkedIn', async () => {
    const { impl, calls } = buildFetch();
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_draft',
      draftOnly: true,
      fetchImpl: impl,
    });

    expect(result.status).toBe('generated');
    expect(result.qualityPassed).toBe(true);
    expect(result.linkedin.attempted).toBe(false);
    expect(calls.some((call) => call.includes('api.linkedin.com'))).toBe(false);
    expect(result.wordCount).toBeGreaterThanOrEqual(150);
  });

  it('reports the full agent output contract', async () => {
    const { impl } = buildFetch();
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_draft',
      draftOnly: true,
      fetchImpl: impl,
    });
    for (const field of [
      'status',
      'postType',
      'topic',
      'targetAudience',
      'painSignal',
      'dreamSignal',
      'pointOfView',
      'hook',
      'linkedinPost',
      'ctaType',
      'ctaText',
      'publicResourceUrl',
      'needsImage',
      'imagePrompt',
      'researchSource',
      'authenticitySource',
      'qualityScore',
      'qualityReasons',
      'unsupportedAutomationDetected',
    ]) {
      expect(result).toHaveProperty(field);
    }
  });
});

describe('dry run', () => {
  it('never publishes and returns dry_run', async () => {
    const { impl, calls } = buildFetch();
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: true,
      fetchImpl: impl,
    });

    expect(result.status).toBe('dry_run');
    expect(result.dryRun).toBe(true);
    expect(result.linkedin.attempted).toBe(false);
    expect(result.linkedin.postId).toBeNull();
    expect(calls.some((call) => call.includes('api.linkedin.com'))).toBe(false);
  });

  it('uses SOCIAL_CONTENT_DRY_RUN when the request does not say', async () => {
    process.env.SOCIAL_CONTENT_DRY_RUN = 'true';
    resetConfigCache();
    const { impl, calls } = buildFetch();
    const result = await runLinkedInContentWorkflow({ trigger: 'manual_run', fetchImpl: impl });
    expect(result.status).toBe('dry_run');
    expect(calls.some((call) => call.includes('api.linkedin.com'))).toBe(false);
  });

  it('prepares image metadata in a dry run without uploading it', async () => {
    const { impl, calls } = buildFetch({
      content: {
        needsImage: true,
        imagePrompt:
          'Minimal flat before/after diagram: a linear chain with no recovery arrow beside the same chain with a labelled recovery arrow and a queue.',
      },
    });
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: true,
      fetchImpl: impl,
    });
    expect(result.status).toBe('dry_run');
    expect(result.imageStatus).toBe('prepared_not_attached');
    expect(calls.some((call) => call.includes('api.linkedin.com'))).toBe(false);
  });
});

describe('explicit publish confirmation', () => {
  it('refuses a live manual run without confirmation', async () => {
    const { impl, calls } = buildFetch();
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: false,
      fetchImpl: impl,
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toContain('explicit confirmation');
    expect(calls).toHaveLength(0);
  });

  it('publishes once confirmation is given', async () => {
    const { impl } = buildFetch();
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: false,
      confirmPublish: true,
      fetchImpl: impl,
    });
    expect(result.status).toBe('published');
  });

  it('lets the scheduler publish without a per-run confirmation', async () => {
    const { impl } = buildFetch();
    const result = await runLinkedInContentWorkflow({
      trigger: 'scheduler',
      dryRun: false,
      fetchImpl: impl,
    });
    expect(result.status).toBe('published');
  });
});

describe('publishing', () => {
  it('publishes a validated post and records sanitized metadata', async () => {
    const { impl } = buildFetch();
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: false,
      confirmPublish: true,
      fetchImpl: impl,
    });

    expect(result.status).toBe('published');
    expect(result.linkedin.httpStatus).toBe(201);
    expect(result.linkedin.postId).toBe(POST_URN);
    expect(JSON.stringify(result)).not.toContain('test-linkedin-token');
    expect(loadRuns()).toHaveLength(1);
    expect(loadRuns()[0]?.status).toBe('published');
  });

  it('never reports published when LinkedIn returns 401', async () => {
    const { impl } = buildFetch({ linkedinStatus: 401 });
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: false,
      confirmPublish: true,
      fetchImpl: impl,
    });
    expect(result.status).toBe('failed');
    expect(result.linkedin.error?.code).toBe('linkedin_unauthorized');
    expect(result.linkedin.postId).toBeNull();
  });

  it('never reports published when LinkedIn returns 429', async () => {
    const { impl } = buildFetch({ linkedinStatus: 429 });
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: false,
      confirmPublish: true,
      fetchImpl: impl,
    });
    expect(result.status).toBe('failed');
    expect(result.linkedin.error?.code).toBe('linkedin_rate_limited');
  });

  it('never reports published when LinkedIn returns 403 or 409', async () => {
    for (const [status, code] of [
      [403, 'linkedin_forbidden'],
      [409, 'linkedin_conflict'],
    ] as [number, string][]) {
      const { impl } = buildFetch({ linkedinStatus: status });
      const result = await runLinkedInContentWorkflow({
        trigger: 'manual_run',
        dryRun: false,
        confirmPublish: true,
        fetchImpl: impl,
      });
      expect(result.status).toBe('failed');
      expect(result.linkedin.error?.code).toBe(code);
    }
  });

  it('fails clearly when LinkedIn credentials are missing', async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    resetConfigCache();
    const { impl, calls } = buildFetch();
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: false,
      confirmPublish: true,
      fetchImpl: impl,
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toContain('LINKEDIN_ACCESS_TOKEN');
    expect(calls.some((call) => call.includes('api.linkedin.com'))).toBe(false);
  });

  it('fails clearly when the person URN has the wrong prefix', async () => {
    process.env.LINKEDIN_PERSON_URN = 'urn:li:organization:999';
    resetConfigCache();
    const { impl, calls } = buildFetch();
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: false,
      confirmPublish: true,
      fetchImpl: impl,
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toContain('urn:li:person:');
    expect(calls.some((call) => call.includes('api.linkedin.com/rest/posts'))).toBe(false);
  });
});

describe('optional image', () => {
  const imageContent = {
    needsImage: true,
    imagePrompt:
      'Minimal flat before/after diagram: a linear chain with no recovery arrow beside the same chain with a labelled recovery arrow and a queue.',
  };

  it('attaches the image when generation and upload succeed', async () => {
    process.env.LINKEDIN_ENABLE_IMAGE_UPLOAD = 'true';
    resetConfigCache();
    const { impl } = buildFetch({ content: imageContent });
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: false,
      confirmPublish: true,
      fetchImpl: impl,
    });
    expect(result.status).toBe('published');
    expect(result.imageStatus).toBe('attached');
  });

  it('still publishes text-only when image generation fails', async () => {
    process.env.LINKEDIN_ENABLE_IMAGE_UPLOAD = 'true';
    resetConfigCache();
    const { impl } = buildFetch({ content: imageContent, imageStatus: 500 });
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: false,
      confirmPublish: true,
      fetchImpl: impl,
    });
    expect(result.linkedin.postId).toBe(POST_URN);
    expect(result.imageStatus).toBe('generation_failed');
    expect(result.status).toBe('partially_published');
  });

  it('publishes text-only when image upload is disabled', async () => {
    const { impl, calls } = buildFetch({ content: imageContent });
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: false,
      confirmPublish: true,
      fetchImpl: impl,
    });
    expect(result.status).toBe('published');
    expect(result.imageStatus).toBe('prepared_not_attached');
    expect(calls.some((call) => call.includes('/rest/images'))).toBe(false);
  });
});

describe('quality gate integration', () => {
  it('blocks a draft that promises comment automation and never publishes it', async () => {
    const cta = "Comment WORKFLOW and I'll send you the blueprint.";
    const { impl, calls } = buildFetch({
      content: {
        ctaText: cta,
        linkedinPost: makeContent().linkedinPost.replace(
          'Save this for your next workflow review.',
          cta,
        ),
      },
    });
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: false,
      confirmPublish: true,
      fetchImpl: impl,
    });

    expect(result.status).toBe('quality_blocked');
    expect(result.unsupportedAutomationDetected).toBe(true);
    expect(result.qualityReasons.length).toBeGreaterThan(0);
    expect(calls.some((call) => call.includes('api.linkedin.com'))).toBe(false);
    expect(loadRuns()[0]?.status).toBe('quality_blocked');
  });

  it('blocks a post outside the word limits', async () => {
    const { impl } = buildFetch({ content: { linkedinPost: 'Too short.' } });
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: true,
      fetchImpl: impl,
    });
    expect(result.status).toBe('quality_blocked');
    expect(result.qualityReasons.join(' ')).toContain('the minimum is 150');
  });
});

describe('research fallback', () => {
  it('continues with an evergreen idea when Tavily fails', async () => {
    const { impl } = buildFetch({ tavilyStatus: 500 });
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_draft',
      draftOnly: true,
      fetchImpl: impl,
    });
    expect(result.research.available).toBe(false);
    expect(result.research.unavailableReason).toContain('HTTP 500');
    expect(result.status).toBe('generated');
  });
});

describe('Google Sheets logging', () => {
  it('does not hide a successful publish when Sheets authentication fails', async () => {
    process.env.GOOGLE_SHEETS_ID = 'sheet-id';
    process.env.GOOGLE_SHEETS_ACCESS_TOKEN = 'sheets-token';
    resetConfigCache();
    const { impl } = buildFetch({ sheetsStatus: 401 });
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: false,
      confirmPublish: true,
      fetchImpl: impl,
    });

    expect(result.linkedin.postId).toBe(POST_URN);
    expect(result.linkedin.httpStatus).toBe(201);
    expect(result.logging.logged).toBe(false);
    expect(result.logging.error).toContain('authentication failed');
    expect(result.status).toBe('partially_published');
  });

  it('logs a successful publish to the published sheet', async () => {
    process.env.GOOGLE_SHEETS_ID = 'sheet-id';
    process.env.GOOGLE_SHEETS_ACCESS_TOKEN = 'sheets-token';
    resetConfigCache();
    const { impl, calls } = buildFetch();
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: false,
      confirmPublish: true,
      fetchImpl: impl,
    });
    expect(result.status).toBe('published');
    expect(result.logging.logged).toBe(true);
    expect(result.logging.sheet).toBe('published');
    expect(calls.some((call) => call.includes('published!A1'))).toBe(true);
  });

  it('logs a blocked run to the blocked sheet', async () => {
    process.env.GOOGLE_SHEETS_ID = 'sheet-id';
    process.env.GOOGLE_SHEETS_ACCESS_TOKEN = 'sheets-token';
    resetConfigCache();
    const { impl, calls } = buildFetch({ content: { linkedinPost: 'Too short.' } });
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_run',
      dryRun: true,
      fetchImpl: impl,
    });
    expect(result.status).toBe('quality_blocked');
    expect(result.logging.sheet).toBe('blocked');
    expect(calls.some((call) => call.includes('blocked!A1'))).toBe(true);
  });

  it('skips logging without an error when Sheets is not configured', async () => {
    const { impl } = buildFetch();
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_draft',
      draftOnly: true,
      fetchImpl: impl,
    });
    expect(result.logging).toEqual({ logged: false, sheet: null, error: null });
  });
});

describe('missing provider configuration', () => {
  it('fails with a clear message when the Gemini key is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    resetConfigCache();
    const { impl } = buildFetch();
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_draft',
      draftOnly: true,
      fetchImpl: impl,
    });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('config_missing');
    expect(result.error?.message).toContain('GEMINI_API_KEY');
  });

  it('treats a missing Tavily key as no research, not a failure', async () => {
    delete process.env.TAVILY_API_KEY;
    resetConfigCache();
    const { impl } = buildFetch();
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_draft',
      draftOnly: true,
      fetchImpl: impl,
    });
    expect(result.research.available).toBe(false);
    expect(result.research.unavailableReason).toContain('TAVILY_API_KEY');
    expect(result.status).toBe('generated');
  });
});
