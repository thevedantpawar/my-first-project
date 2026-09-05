import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStrategy } from '../src/agents/linkedin-content-agent/strategy.js';
import { POST_TYPES } from '../src/agents/linkedin-content-agent/strategy.js';
import type { PostType, Strategy } from '../src/agents/linkedin-content-agent/strategy.js';
import { evaluateMix, generateCalendar, postTypeForDate } from '../src/calendar/content-calendar.js';
import { planAssignment } from '../src/agents/linkedin-content-agent/index.js';
import { resetConfigCache } from '../src/config.js';
import { clearProviderEnv, useTemporaryDataDir } from './fixtures.js';

let strategy: Strategy;
let temp: { dir: string; cleanup: () => void };

beforeAll(() => {
  clearProviderEnv();
  temp = useTemporaryDataDir();
  strategy = loadStrategy();
});

afterAll(() => temp.cleanup());

describe('calendar generation', () => {
  it('produces five weekday entries per week and never a weekend', () => {
    const entries = generateCalendar(strategy, { weeks: 4, from: new Date('2026-09-07T06:00:00Z') });
    expect(entries).toHaveLength(20);
    expect(entries.every((entry) => entry.weekday >= 1 && entry.weekday <= 5)).toBe(true);
  });

  it('assigns the configured format to each weekday', () => {
    const entries = generateCalendar(strategy, { weeks: 1, from: new Date('2026-09-07T06:00:00Z') });
    expect(entries.map((entry) => entry.postType)).toEqual([
      'Named Problem',
      'Deep Work System',
      'Surfaced Problem/Audit',
      'Founder/Practitioner Story',
      'Point-of-View',
    ]);
  });

  it('alternates the Friday slot so lead magnets get a place in the portfolio', () => {
    const entries = generateCalendar(strategy, { weeks: 4, from: new Date('2026-09-07T06:00:00Z') });
    const fridays = entries.filter((entry) => entry.weekday === 5).map((entry) => entry.postType);
    expect(fridays).toEqual(['Point-of-View', 'Lead Magnet', 'Point-of-View', 'Lead Magnet']);
  });

  it('returns no format on a weekend', () => {
    expect(postTypeForDate(strategy, new Date('2026-09-12T06:00:00Z'))).toBeNull();
    expect(postTypeForDate(strategy, new Date('2026-09-13T06:00:00Z'))).toBeNull();
  });

  it('rotates formats across a working week', () => {
    const week = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].map((date) =>
      postTypeForDate(strategy, new Date(`${date}T06:00:00Z`)),
    );
    expect(new Set(week).size).toBe(5);
  });
});

describe('portfolio mix', () => {
  it('reports a balanced window as balanced', () => {
    const window: PostType[] = [
      ...Array<PostType>(6).fill('Named Problem'),
      ...Array<PostType>(5).fill('Surfaced Problem/Audit'),
      ...Array<PostType>(4).fill('Deep Work System'),
      ...Array<PostType>(3).fill('Founder/Practitioner Story'),
      ...Array<PostType>(2).fill('Point-of-View'),
    ];
    expect(evaluateMix(window, strategy).balanced).toBe(true);
  });

  it('warns when one format dominates the window', () => {
    const window = Array<PostType>(20).fill('Named Problem');
    const report = evaluateMix(window, strategy);
    expect(report.balanced).toBe(false);
    expect(report.warnings.join(' ')).toContain('Named Problem is 100%');
  });
});

describe('assignment planning', () => {
  it('rotates beliefs and signals across consecutive runs', () => {
    const beliefs = [0, 1, 2].map(
      (seed) => planAssignment(strategy, { seed, date: new Date('2026-09-07T06:00:00Z') }).belief.id,
    );
    expect(new Set(beliefs).size).toBe(3);
  });

  it('falls back from a founder story when the authenticity pack is empty', () => {
    const assignment = planAssignment(strategy, {
      seed: 0,
      date: new Date('2026-09-10T06:00:00Z'),
    });
    expect(assignment.postType).toBe('Named Problem');
    expect(assignment.authenticityIdeas).toEqual([]);
    expect(assignment.substitution?.from).toBe('Founder/Practitioner Story');
    expect(assignment.substitution?.reason).toContain('never invents lived experience');
  });

  it('offers only CTAs whose destination is configured', () => {
    const assignment = planAssignment(strategy, {
      seed: 0,
      postType: 'Deep Work System',
      date: new Date('2026-09-08T06:00:00Z'),
    });
    // PUBLIC_RESOURCE_URL is unset in this environment, so "resource" is dropped.
    expect(assignment.ctaOptions.map((option) => option.ctaType)).not.toContain('resource');
    expect(assignment.ctaOptions.length).toBeGreaterThan(0);
  });

  it('substitutes a lead magnet when no destination URL is configured', () => {
    // Every lead-magnet CTA needs a link. With none set, generating this format
    // could only ever end in quality_blocked, so it must not be attempted.
    const assignment = planAssignment(strategy, {
      seed: 0,
      postType: 'Lead Magnet',
      date: new Date('2026-09-11T06:00:00Z'),
    });
    expect(assignment.postType).not.toBe('Lead Magnet');
    expect(assignment.substitution?.from).toBe('Lead Magnet');
    expect(assignment.substitution?.reason).toContain('PUBLIC_RESOURCE_URL');
    expect(assignment.ctaOptions.length).toBeGreaterThan(0);
  });

  it('keeps the lead magnet once a public resource URL exists', () => {
    process.env.PUBLIC_RESOURCE_URL = 'https://microns.example/checklist';
    resetConfigCache();
    try {
      const assignment = planAssignment(strategy, {
        seed: 0,
        postType: 'Lead Magnet',
        date: new Date('2026-09-11T06:00:00Z'),
      });
      expect(assignment.postType).toBe('Lead Magnet');
      expect(assignment.substitution).toBeNull();
      expect(assignment.ctaOptions.map((option) => option.ctaType)).toContain('resource');
    } finally {
      delete process.env.PUBLIC_RESOURCE_URL;
      resetConfigCache();
    }
  });

  it('never hands the model a CTA it cannot honour', () => {
    for (const postType of POST_TYPES) {
      const assignment = planAssignment(strategy, { seed: 1, postType });
      const allowed = strategy.cta.preferredByPostType[assignment.postType] ?? [];
      for (const option of assignment.ctaOptions) {
        expect(allowed).toContain(option.ctaType);
        const definition = strategy.cta.ctaTypes[option.ctaType];
        if (definition?.destination !== null) expect(option.url).not.toBeNull();
      }
    }
  });

  it('selects a pain signal and a dream signal from the libraries', () => {
    const assignment = planAssignment(strategy, { seed: 3, date: new Date('2026-09-07T06:00:00Z') });
    expect(strategy.painSignals.map((signal) => signal.id)).toContain(assignment.painSignal.id);
    expect(strategy.dreamSignals.map((signal) => signal.id)).toContain(assignment.dreamSignal.id);
  });
});
