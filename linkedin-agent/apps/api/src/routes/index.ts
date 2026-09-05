import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { POST_TYPES } from '../agents/linkedin-content-agent/strategy.js';
import { loadStrategy } from '../agents/linkedin-content-agent/strategy.js';
import { buildMonthlyReview } from '../analytics/monthly-review.js';
import { computePostRates, followerProgress } from '../analytics/metrics.js';
import { evaluateMix, generateCalendar } from '../calendar/content-calendar.js';
import { toSanitizedError } from '../lib/errors.js';
import { buildProfileAudit, profileAuditUpdateSchema, updateProfileAudit } from '../profile/profile-audit.js';
import {
  authenticityPackInputSchema,
  ingestAuthenticityPack,
  loadAuthenticityPack,
  suggestAuthenticityIdeas,
} from '../store/authenticity-pack.js';
import {
  followerSampleSchema,
  loadAnalytics,
  postMetricsSchema,
  recordFollowerSample,
  upsertPostMetrics,
} from '../store/analytics.js';
import { addSwipeFileEntry, loadSwipeFile, swipeFileInputSchema, SwipeFileRejected } from '../store/swipe-file.js';
import { loadRuns } from '../store/run-log.js';
import { runLinkedInContentWorkflow } from '../workflows/linkedin-content-workflow.js';
import type { WorkflowTrigger } from '../workflows/linkedin-content-workflow.js';
import type { WeekdayScheduler } from '../scheduler/weekday-scheduler.js';
import { buildStatus, UNSUPPORTED_CAPABILITIES } from './status.js';

const runRequestSchema = z.object({
  dryRun: z.boolean().optional(),
  confirm: z.boolean().optional(),
  postType: z.enum(POST_TYPES).optional(),
});

const triggerRequestSchema = z.object({
  agentId: z.string().min(1),
  dryRun: z.boolean().optional(),
  confirm: z.boolean().optional(),
  postType: z.enum(POST_TYPES).optional(),
});

const AGENT_ID = 'linkedin-content-agent';

function badRequest(res: Response, message: string, details?: unknown): void {
  res.status(400).json({ error: { code: 'bad_request', message, details } });
}

function handleFailure(res: Response, error: unknown): void {
  const sanitized = toSanitizedError(error);
  const status =
    sanitized.code === 'bad_request'
      ? 400
      : sanitized.code === 'config_missing' || sanitized.code === 'config_invalid'
        ? 503
        : 500;
  res.status(status).json({ error: sanitized });
}

/** HTTP status for a workflow result. A blocked or failed run is never a 200 "ok". */
function statusCodeFor(result: { status: string }): number {
  switch (result.status) {
    case 'quality_blocked':
      return 422;
    case 'failed':
      return 502;
    default:
      return 200;
  }
}

export function createRouter(scheduler: WeekdayScheduler | null): Router {
  const router = Router();

  // --- health and status --------------------------------------------------
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'microns-linkedin-content-agent', timestamp: new Date().toISOString() });
  });

  const statusHandler = (_req: Request, res: Response): void => {
    try {
      res.json(buildStatus(scheduler));
    } catch (error) {
      handleFailure(res, error);
    }
  };

  router.get('/api/workflows/linkedin-content/status', statusHandler);
  router.get('/api/linkedin/status', statusHandler);

  // --- draft / run / publish ---------------------------------------------
  const draftHandler = async (req: Request, res: Response): Promise<void> => {
    const parsed = runRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, 'Invalid request body.', parsed.error.issues);
    try {
      const result = await runLinkedInContentWorkflow({
        trigger: 'manual_draft',
        draftOnly: true,
        ...(parsed.data.postType ? { postType: parsed.data.postType } : {}),
      });
      res.status(statusCodeFor(result)).json(result);
    } catch (error) {
      handleFailure(res, error);
    }
  };

  router.post('/api/workflows/linkedin-content/draft', draftHandler);
  router.post('/api/linkedin/draft', draftHandler);

  const runHandler =
    (trigger: WorkflowTrigger) =>
    async (req: Request, res: Response): Promise<void> => {
      const parsed = runRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) return badRequest(res, 'Invalid request body.', parsed.error.issues);
      try {
        const result = await runLinkedInContentWorkflow({
          trigger,
          ...(parsed.data.dryRun === undefined ? {} : { dryRun: parsed.data.dryRun }),
          ...(parsed.data.confirm === undefined ? {} : { confirmPublish: parsed.data.confirm }),
          ...(parsed.data.postType ? { postType: parsed.data.postType } : {}),
        });
        res.status(statusCodeFor(result)).json(result);
      } catch (error) {
        handleFailure(res, error);
      }
    };

  router.post('/api/workflows/linkedin-content/run', runHandler('manual_run'));

  /** Explicit live publish. Requires { confirm: true }; dryRun is forced off. */
  router.post('/api/linkedin/publish', async (req: Request, res: Response) => {
    const parsed = runRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, 'Invalid request body.', parsed.error.issues);
    if (parsed.data.confirm !== true) {
      return badRequest(
        res,
        'Publishing to LinkedIn requires an explicit confirmation. Send { "confirm": true }.',
      );
    }
    try {
      const result = await runLinkedInContentWorkflow({
        trigger: 'manual_run',
        dryRun: false,
        confirmPublish: true,
        ...(parsed.data.postType ? { postType: parsed.data.postType } : {}),
      });
      res.status(statusCodeFor(result)).json(result);
    } catch (error) {
      handleFailure(res, error);
    }
  });

  router.post('/api/agents/trigger', async (req: Request, res: Response) => {
    const parsed = triggerRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, 'Invalid request body.', parsed.error.issues);
    if (parsed.data.agentId !== AGENT_ID) {
      return badRequest(
        res,
        `Unknown agentId "${parsed.data.agentId}". The only agent in this system is "${AGENT_ID}".`,
      );
    }
    try {
      const result = await runLinkedInContentWorkflow({
        trigger: 'agent_trigger',
        ...(parsed.data.dryRun === undefined ? {} : { dryRun: parsed.data.dryRun }),
        ...(parsed.data.confirm === undefined ? {} : { confirmPublish: parsed.data.confirm }),
        ...(parsed.data.postType ? { postType: parsed.data.postType } : {}),
      });
      res.status(statusCodeFor(result)).json({ agentId: AGENT_ID, result });
    } catch (error) {
      handleFailure(res, error);
    }
  });

  // --- strategy, calendar, libraries --------------------------------------
  router.get('/api/linkedin/strategy', (_req: Request, res: Response) => {
    try {
      const strategy = loadStrategy();
      res.json({ ...strategy, unsupportedCapabilities: UNSUPPORTED_CAPABILITIES });
    } catch (error) {
      handleFailure(res, error);
    }
  });

  router.get('/api/linkedin/calendar', (req: Request, res: Response) => {
    const weeks = Number.parseInt(String(req.query.weeks ?? '4'), 10);
    if (!Number.isFinite(weeks) || weeks < 1 || weeks > 26) {
      return badRequest(res, 'weeks must be between 1 and 26.');
    }
    try {
      const strategy = loadStrategy();
      const entries = generateCalendar(strategy, { weeks });
      const published = loadRuns()
        .filter((run) => run.postType !== null)
        .slice(-strategy.portfolio.rollingWindowWeeks * 5)
        .map((run) => run.postType!);
      res.json({
        timezone: strategy.portfolio.timezone,
        postsPerDay: strategy.portfolio.postsPerDay,
        entries,
        plannedMix: evaluateMix(entries.map((entry) => entry.postType), strategy),
        recentMix: evaluateMix(published, strategy),
      });
    } catch (error) {
      handleFailure(res, error);
    }
  });

  router.get('/api/linkedin/authenticity-pack', (_req: Request, res: Response) => {
    try {
      res.json({ ...loadAuthenticityPack(), suggestions: suggestAuthenticityIdeas(5) });
    } catch (error) {
      handleFailure(res, error);
    }
  });

  router.post('/api/linkedin/authenticity-pack', (req: Request, res: Response) => {
    const parsed = authenticityPackInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, 'Invalid authenticity pack.', parsed.error.issues);
    if (!parsed.data.rawNotes && (parsed.data.ideas ?? []).length === 0) {
      return badRequest(res, 'Provide rawNotes or at least one idea.');
    }
    try {
      res.status(201).json(ingestAuthenticityPack(parsed.data));
    } catch (error) {
      handleFailure(res, error);
    }
  });

  router.get('/api/linkedin/swipe-file', (_req: Request, res: Response) => {
    try {
      res.json({ entries: loadSwipeFile() });
    } catch (error) {
      handleFailure(res, error);
    }
  });

  router.post('/api/linkedin/swipe-file', (req: Request, res: Response) => {
    const parsed = swipeFileInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, 'Invalid swipe-file entry.', parsed.error.issues);
    try {
      res.status(201).json(addSwipeFileEntry(parsed.data));
    } catch (error) {
      if (error instanceof SwipeFileRejected) return badRequest(res, error.message);
      handleFailure(res, error);
    }
  });

  // --- profile audit -------------------------------------------------------
  router.get('/api/linkedin/profile-audit', (_req: Request, res: Response) => {
    try {
      res.json(buildProfileAudit());
    } catch (error) {
      handleFailure(res, error);
    }
  });

  router.post('/api/linkedin/profile-audit', (req: Request, res: Response) => {
    const parsed = profileAuditUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, 'Invalid profile audit update.', parsed.error.issues);
    try {
      res.json(updateProfileAudit(parsed.data));
    } catch (error) {
      handleFailure(res, error);
    }
  });

  // --- analytics -----------------------------------------------------------
  router.get('/api/linkedin/analytics', (_req: Request, res: Response) => {
    try {
      const store = loadAnalytics();
      const strategy = loadStrategy();
      res.json({
        posts: store.posts.map((post) => ({ ...post, rates: computePostRates(post) })),
        followerSamples: store.followerSamples,
        followerTarget: followerProgress(
          store.followerSamples,
          strategy.audience.growthTarget.followers,
          strategy.audience.growthTarget.months,
        ),
        runs: loadRuns().slice(-30),
      });
    } catch (error) {
      handleFailure(res, error);
    }
  });

  router.post('/api/linkedin/analytics', (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (body.followerSample !== undefined) {
      const parsed = followerSampleSchema.safeParse(body.followerSample);
      if (!parsed.success) return badRequest(res, 'Invalid follower sample.', parsed.error.issues);
      try {
        return void res.status(201).json(recordFollowerSample(parsed.data));
      } catch (error) {
        return handleFailure(res, error);
      }
    }
    const parsed = postMetricsSchema.safeParse(body);
    if (!parsed.success) return badRequest(res, 'Invalid post metrics.', parsed.error.issues);
    try {
      res.status(201).json(upsertPostMetrics(parsed.data));
    } catch (error) {
      handleFailure(res, error);
    }
  });

  router.post('/api/linkedin/monthly-review', (req: Request, res: Response) => {
    const windowDays = Number.parseInt(String((req.body ?? {}).windowDays ?? '30'), 10);
    if (!Number.isFinite(windowDays) || windowDays < 7 || windowDays > 365) {
      return badRequest(res, 'windowDays must be between 7 and 365.');
    }
    try {
      const store = loadAnalytics();
      const strategy = loadStrategy();
      res.json(buildMonthlyReview(store.posts, store.followerSamples, strategy, { windowDays }));
    } catch (error) {
      handleFailure(res, error);
    }
  });

  return router;
}
