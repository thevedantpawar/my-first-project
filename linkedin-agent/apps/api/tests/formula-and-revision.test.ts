import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../src/config.js';
import { POST_TYPES, loadStrategy } from '../src/agents/linkedin-content-agent/strategy.js';
import type { Strategy } from '../src/agents/linkedin-content-agent/strategy.js';
import { planAssignment, usableFormulas } from '../src/agents/linkedin-content-agent/index.js';
import { runLinkedInContentWorkflow } from '../src/workflows/linkedin-content-workflow.js';
import { ingestAuthenticityPack } from '../src/store/authenticity-pack.js';
import { resetNegotiatedVersion } from '../src/providers/linkedin.js';
import { clearProviderEnv, makeContent, makePost, useTemporaryDataDir } from './fixtures.js';

let strategy: Strategy;
let temp: { dir: string; cleanup: () => void };

beforeEach(() => {
  clearProviderEnv();
  temp = useTemporaryDataDir();
  resetNegotiatedVersion();
  process.env.GEMINI_API_KEY = 'k';
  resetConfigCache();
  strategy = loadStrategy();
});

afterEach(() => {
  temp.cleanup();
  delete process.env.GEMINI_API_KEY;
  resetNegotiatedVersion();
  clearProviderEnv();
});

describe('hook formula library', () => {
  it('excludes the comment-gate formula entirely', () => {
    expect(strategy.hookFormulas.map((f) => f.id)).not.toContain('F6');
    expect(strategy.hookFormulas.length).toBe(19);
  });

  it('withholds story formulas until the authenticity pack has material', () => {
    const without = usableFormulas(strategy, 'Founder/Practitioner Story', {
      hasAuthenticity: false,
      hasCitedResearch: false,
    });
    expect(without.every((f) => !f.requiresAuthenticity)).toBe(true);

    const withPack = usableFormulas(strategy, 'Founder/Practitioner Story', {
      hasAuthenticity: true,
      hasCitedResearch: false,
    });
    expect(withPack.some((f) => f.requiresAuthenticity)).toBe(true);
  });

  it('withholds the ledger formula until research cited something', () => {
    const without = usableFormulas(strategy, 'Deep Work System', {
      hasAuthenticity: true,
      hasCitedResearch: false,
    });
    expect(without.map((f) => f.id)).not.toContain('F7');

    const withResearch = usableFormulas(strategy, 'Deep Work System', {
      hasAuthenticity: true,
      hasCitedResearch: true,
    });
    expect(withResearch.map((f) => f.id)).toContain('F7');
  });

  it('never returns an empty set, for any post type or capability combination', () => {
    // Every founder-story formula needs lived experience, so with an empty pack
    // the preferred set is legitimately empty and must widen, not return [].
    for (const postType of POST_TYPES) {
      for (const hasAuthenticity of [false, true]) {
        for (const hasCitedResearch of [false, true]) {
          const usable = usableFormulas(strategy, postType, {
            hasAuthenticity,
            hasCitedResearch,
          });
          expect(usable.length).toBeGreaterThan(0);
          if (!hasAuthenticity) {
            expect(usable.every((f) => !f.requiresAuthenticity)).toBe(true);
          }
          if (!hasCitedResearch) {
            expect(usable.every((f) => !f.requiresCitedNumbers)).toBe(true);
          }
        }
      }
    }
  });

  it('rotates formulas across consecutive runs', () => {
    const picked = [0, 1, 2, 3].map(
      (seed) =>
        planAssignment(strategy, { seed, postType: 'Named Problem', hasCitedResearch: true })
          .formula.id,
    );
    expect(new Set(picked).size).toBeGreaterThan(1);
  });

  it('assigns a formula the post type can carry', () => {
    const assignment = planAssignment(strategy, { seed: 0, postType: 'Deep Work System' });
    expect(assignment.formula.postTypes).toContain('Deep Work System');
  });
});

describe('one corrective revision', () => {
  /** First generation returns a broken draft, the revision returns a clean one. */
  function fetchWithRevision(broken: object, fixed: object) {
    const bodies: string[] = [];
    let call = 0;
    const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.includes('api.tavily.com')) return new Response('{}', { status: 403 });
      if (href.includes('generativelanguage')) {
        bodies.push(String(init?.body ?? ''));
        call += 1;
        return Response.json({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(call === 1 ? broken : fixed) }] } },
          ],
        });
      }
      return new Response('{}', { status: 201, headers: { 'x-restli-id': 'urn:li:share:9' } });
    }) as unknown as typeof fetch;
    return { impl, bodies, calls: () => call };
  }

  it('rescues a day that would otherwise publish nothing', async () => {
    // A hook out of sync with the first line — the single most common real slip.
    const broken = makeContent({ linkedinHook: 'A completely different opening line' });
    const fixed = makeContent();
    const { impl, calls } = fetchWithRevision(broken, fixed);

    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_draft',
      draftOnly: true,
      fetchImpl: impl,
    });

    expect(result.status).toBe('generated');
    expect(result.qualityPassed).toBe(true);
    expect(result.revision?.attempted).toBe(true);
    expect(result.revision?.succeeded).toBe(true);
    expect(result.revision?.firstAttemptReasons.join(' ')).toContain('not the declared hook');
    expect(calls()).toBe(2);
  });

  it('sends the failure reasons back to the model', async () => {
    const broken = makeContent({ linkedinPost: makePost(100) });
    const { impl, bodies } = fetchWithRevision(broken, makeContent());
    await runLinkedInContentWorkflow({ trigger: 'manual_draft', draftOnly: true, fetchImpl: impl });

    expect(bodies[1]).toContain('previous attempt was rejected');
    expect(bodies[1]).toContain('the minimum is 150');
  });

  it('still blocks when the revision is no better, and reports the current reasons', async () => {
    const broken = makeContent({ linkedinPost: makePost(100) });
    const { impl, calls } = fetchWithRevision(broken, broken);

    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_draft',
      draftOnly: true,
      fetchImpl: impl,
    });

    expect(result.status).toBe('quality_blocked');
    expect(result.revision?.succeeded).toBe(false);
    expect(result.qualityReasons.join(' ')).toContain('the minimum is 150');
    // Exactly one retry. Never a loop.
    expect(calls()).toBe(2);
  });

  it('does not revise a draft that passed first time', async () => {
    const { impl, calls } = fetchWithRevision(makeContent(), makeContent());
    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_draft',
      draftOnly: true,
      fetchImpl: impl,
    });
    expect(result.revision).toBeNull();
    expect(calls()).toBe(1);
  });

  it('keeps the first verdict when the revision call itself fails', async () => {
    let call = 0;
    const impl = vi.fn(async (url: string | URL) => {
      if (String(url).includes('api.tavily.com')) return new Response('{}', { status: 403 });
      call += 1;
      if (call === 1) {
        return Response.json({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(makeContent({ linkedinPost: makePost(100) })) }],
              },
            },
          ],
        });
      }
      return new Response('{}', { status: 400 });
    }) as unknown as typeof fetch;

    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_draft',
      draftOnly: true,
      fetchImpl: impl,
    });
    expect(result.status).toBe('quality_blocked');
    expect(result.revision).toEqual({
      attempted: true,
      succeeded: false,
      firstAttemptReasons: expect.arrayContaining([expect.stringContaining('the minimum is 150')]),
    });
  });

  it('never lets a revision smuggle a DM promise past the gate', async () => {
    const cta = "Comment GUIDE and I'll send it over.";
    const sneaky = makeContent({ ctaText: cta, linkedinPost: makePost(180, { cta }) });
    const { impl } = fetchWithRevision(makeContent({ linkedinPost: makePost(100) }), sneaky);

    const result = await runLinkedInContentWorkflow({
      trigger: 'manual_draft',
      draftOnly: true,
      fetchImpl: impl,
    });
    expect(result.status).toBe('quality_blocked');
    expect(result.unsupportedAutomationDetected).toBe(true);
  });
});

describe('the growth target stays a target', () => {
  it('is 1,000 and is not described as guaranteed', () => {
    expect(strategy.audience.growthTarget.followers).toBe(1000);
    expect(strategy.audience.growthTarget.guaranteed).toBe(false);
    expect(strategy.audience.growthTarget.note).toMatch(/never a promise/i);
  });
});

describe('story formulas once the pack is real', () => {
  it('offers them after material is ingested', () => {
    ingestAuthenticityPack({ rawNotes: 'A duplicate invoice went out on a Sunday.', replace: true });
    const assignment = planAssignment(strategy, {
      seed: 0,
      postType: 'Founder/Practitioner Story',
    });
    expect(assignment.postType).toBe('Founder/Practitioner Story');
    expect(assignment.formula.postTypes).toContain('Founder/Practitioner Story');
  });
});
