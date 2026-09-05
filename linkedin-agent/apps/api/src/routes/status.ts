import { getConfig, providerReadiness } from '../config.js';
import { loadStrategy } from '../agents/linkedin-content-agent/strategy.js';
import { evaluateMix, postTypeForDate } from '../calendar/content-calendar.js';
import { buildProfileAudit } from '../profile/profile-audit.js';
import { loadRuns, lastRun } from '../store/run-log.js';
import { loadAuthenticityPack } from '../store/authenticity-pack.js';
import { loadSwipeFile } from '../store/swipe-file.js';
import { nextRunAt, settingsFromConfig } from '../scheduler/weekday-scheduler.js';
import type { WeekdayScheduler } from '../scheduler/weekday-scheduler.js';
import { toSanitizedError } from '../lib/errors.js';

/** Features this build deliberately does not have. Surfaced in the dashboard. */
export const UNSUPPORTED_CAPABILITIES = [
  'Automatic LinkedIn DMs',
  'Keyword-triggered DMs',
  'Automatic replies to commenters',
  'Automatic commenter mentions',
  'Comment monitoring',
  'Connection requests',
  'Twitter/X or any cross-posting',
] as const;

export function buildStatus(scheduler: WeekdayScheduler | null) {
  const config = getConfig();
  const settings = settingsFromConfig();
  const runs = loadRuns();
  const last = lastRun();

  let strategySummary: Record<string, unknown> | null = null;
  let mix: unknown = null;
  let todaysPostType: string | null = null;
  let strategyError: string | null = null;
  try {
    const strategy = loadStrategy();
    strategySummary = {
      beliefs: strategy.beliefs.map((belief) => ({ id: belief.id, claim: belief.claim })),
      painSignalCount: strategy.painSignals.length,
      dreamSignalCount: strategy.dreamSignals.length,
      timezone: strategy.portfolio.timezone,
      growthTarget: strategy.audience.growthTarget,
    };
    const windowPosts = runs
      .filter((run) => run.postType !== null)
      .slice(-strategy.portfolio.rollingWindowWeeks * 5)
      .map((run) => run.postType!);
    mix = evaluateMix(windowPosts, strategy);
    todaysPostType = postTypeForDate(strategy);
  } catch (error) {
    strategyError = toSanitizedError(error).message;
  }

  let profileAudit: unknown = null;
  try {
    profileAudit = buildProfileAudit();
  } catch (error) {
    profileAudit = { error: toSanitizedError(error).message };
  }

  return {
    service: 'microns-linkedin-content-agent',
    platform: 'linkedin_only',
    environment: config.NODE_ENV,
    providers: providerReadiness(config),
    // Never the values — only whether they are present and well-formed.
    linkedin: {
      personUrnFormatValid:
        config.LINKEDIN_PERSON_URN === '' ||
        config.LINKEDIN_PERSON_URN.startsWith('urn:li:person:'),
      apiVersion: config.LINKEDIN_API_VERSION,
      imageUploadEnabled: config.LINKEDIN_ENABLE_IMAGE_UPLOAD,
    },
    scheduler: {
      enabled: settings.enabled,
      timeZone: settings.timeZone,
      days: 'Monday-Friday',
      scheduledTime: `${String(settings.hour).padStart(2, '0')}:${String(settings.minute).padStart(2, '0')}`,
      nextRunAt: nextRunAt(settings),
      state: scheduler ? scheduler.getState() : null,
    },
    dryRun: {
      defaultEnabled: config.SOCIAL_CONTENT_DRY_RUN,
      warning: config.SOCIAL_CONTENT_DRY_RUN
        ? 'Dry run is ON. Scheduled and manual runs will generate and validate but will not publish.'
        : 'Dry run is OFF. A confirmed manual run or the scheduled run will publish to LinkedIn.',
    },
    contentLimits: { minWords: config.CONTENT_MIN_WORDS, maxWords: config.CONTENT_MAX_WORDS },
    destinations: {
      profileConfigured: config.PROFILE_URL !== '',
      publicResourceConfigured: config.PUBLIC_RESOURCE_URL !== '',
      caseStudyConfigured: config.CASE_STUDY_URL !== '',
      calendarConfigured: config.CALENDAR_URL !== '',
    },
    strategy: strategySummary,
    strategyError,
    todaysPostType,
    portfolioMix: mix,
    profileAudit,
    library: {
      authenticityIdeas: loadAuthenticityPack().ideas.length,
      swipeFileEntries: loadSwipeFile().length,
    },
    lastRun: last,
    totalRuns: runs.length,
    unsupportedCapabilities: UNSUPPORTED_CAPABILITIES,
  };
}
