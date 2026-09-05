import { randomUUID } from 'node:crypto';
import { destinationUrls, getConfig } from '../config.js';
import { AppError, toSanitizedError } from '../lib/errors.js';
import type { SanitizedError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { generateContentPackage, planAssignment } from '../agents/linkedin-content-agent/index.js';
import { loadStrategy } from '../agents/linkedin-content-agent/strategy.js';
import type { CtaType, PostType, Strategy } from '../agents/linkedin-content-agent/strategy.js';
import { generateImage } from '../providers/gemini.js';
import { publishTextPost, uploadImage } from '../providers/linkedin.js';
import { researchCurrentTopics } from '../providers/tavily.js';
import type { ResearchDigest } from '../providers/tavily.js';
import { appendRunRow, isSheetsConfigured } from '../providers/google-sheets.js';
import type { LogRow, SheetsLogResult } from '../providers/google-sheets.js';
import { loadAuthenticityPack, markAuthenticityIdeaUsed } from '../store/authenticity-pack.js';
import { loadSwipeFile } from '../store/swipe-file.js';
import { appendRun, loadRuns, recentTopics } from '../store/run-log.js';
import type { RunRecord } from '../store/run-log.js';
import { runQualityGate } from '../validation/quality-gate.js';
import type { ContentPackage, ImageStatus, WorkflowStatus } from '../validation/linkedin-content-schema.js';

export type WorkflowTrigger = 'manual_draft' | 'manual_run' | 'agent_trigger' | 'scheduler';

export interface RunWorkflowOptions {
  trigger: WorkflowTrigger;
  /** Draft mode generates and validates but can never publish. */
  draftOnly?: boolean;
  /** Request-level override. When undefined, SOCIAL_CONTENT_DRY_RUN decides. */
  dryRun?: boolean;
  /** Required for a manual live publish. The scheduler is authorised by its env flag. */
  confirmPublish?: boolean;
  postType?: PostType;
  now?: Date;
  fetchImpl?: typeof fetch;
}

/** The agent output contract (§18 of the growth directive). */
export interface WorkflowResult {
  runId: string;
  timestamp: string;
  trigger: WorkflowTrigger;
  status: WorkflowStatus;
  postType: PostType | null;
  topic: string;
  targetAudience: string;
  painSignal: string;
  dreamSignal: string;
  pointOfView: string;
  hook: string;
  linkedinPost: string;
  ctaType: CtaType | null;
  ctaText: string;
  publicResourceUrl: string;
  needsImage: boolean;
  imagePrompt: string;
  researchSource: string;
  authenticitySource: string;
  /** Set when the scheduled format could not be produced honestly. */
  formatSubstitution: { from: PostType; reason: string } | null;
  qualityScore: number;
  qualityPassed: boolean;
  qualityReasons: string[];
  wordCount: number;
  unsupportedAutomationDetected: boolean;
  dryRun: boolean;
  imageStatus: ImageStatus;
  linkedin: {
    attempted: boolean;
    httpStatus: number | null;
    postId: string | null;
    postUrl: string | null;
    error: SanitizedError | null;
  };
  logging: SheetsLogResult;
  research: { available: boolean; sourceCount: number; unavailableReason: string | null };
  error: SanitizedError | null;
}

const EMPTY_LOGGING: SheetsLogResult = { logged: false, sheet: null, error: null };

function baseResult(trigger: WorkflowTrigger, now: Date, dryRun: boolean): WorkflowResult {
  return {
    runId: randomUUID(),
    timestamp: now.toISOString(),
    trigger,
    status: 'failed',
    postType: null,
    topic: '',
    targetAudience: '',
    painSignal: '',
    dreamSignal: '',
    pointOfView: '',
    hook: '',
    linkedinPost: '',
    ctaType: null,
    ctaText: '',
    publicResourceUrl: '',
    needsImage: false,
    imagePrompt: '',
    researchSource: '',
    authenticitySource: '',
    formatSubstitution: null,
    qualityScore: 0,
    qualityPassed: false,
    qualityReasons: [],
    wordCount: 0,
    unsupportedAutomationDetected: false,
    dryRun,
    imageStatus: 'not_requested',
    linkedin: { attempted: false, httpStatus: null, postId: null, postUrl: null, error: null },
    logging: { ...EMPTY_LOGGING },
    research: { available: false, sourceCount: 0, unavailableReason: null },
    error: null,
  };
}

function applyContent(result: WorkflowResult, content: ContentPackage): void {
  result.postType = content.postType;
  result.topic = content.topic;
  result.targetAudience = content.targetAudience;
  result.painSignal = content.painSignal;
  result.dreamSignal = content.dreamSignal;
  result.pointOfView = content.pointOfView;
  result.hook = content.linkedinHook;
  result.linkedinPost = content.linkedinPost;
  result.ctaType = content.ctaType;
  result.ctaText = content.ctaText;
  result.publicResourceUrl = content.publicResourceUrl;
  result.needsImage = content.needsImage;
  result.imagePrompt = content.imagePrompt;
  result.researchSource = content.researchSource;
  result.authenticitySource = content.authenticitySource;
}

/**
 * The single entry point for drafting, dry runs, manual publishes and the
 * scheduler. Every caller goes through this function so behaviour cannot drift
 * between the dashboard, the API and the 9pm run.
 */
export async function runLinkedInContentWorkflow(
  options: RunWorkflowOptions,
): Promise<WorkflowResult> {
  const config = getConfig();
  const now = options.now ?? new Date();
  const draftOnly = options.draftOnly === true;
  const dryRun = draftOnly ? true : (options.dryRun ?? config.SOCIAL_CONTENT_DRY_RUN);
  const result = baseResult(options.trigger, now, dryRun);

  let strategy: Strategy;
  try {
    strategy = loadStrategy();
  } catch (error) {
    result.status = 'failed';
    result.error = toSanitizedError(error);
    await persist(result, null, options.fetchImpl);
    return result;
  }

  // A live publish from a manual endpoint needs an explicit confirmation. The
  // scheduler's authorisation is SOCIAL_CONTENT_SCHEDULER_ENABLED.
  if (
    !dryRun &&
    !draftOnly &&
    options.trigger !== 'scheduler' &&
    options.confirmPublish !== true
  ) {
    result.status = 'failed';
    result.error = toSanitizedError(
      new AppError(
        'bad_request',
        'Live publishing requires an explicit confirmation. Send { "confirm": true } to publish, or run in dry-run mode.',
      ),
    );
    return result;
  }

  let research: ResearchDigest;
  try {
    research = await researchCurrentTopics(
      options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
    );
  } catch (error) {
    // researchCurrentTopics does not normally throw; treat anything that gets
    // here as "no research" rather than failing the run.
    research = {
      available: false,
      query: config.CONTENT_RESEARCH_QUERY,
      results: [],
      digest: '',
      unavailableReason: toSanitizedError(error).message,
    };
  }
  result.research = {
    available: research.available,
    sourceCount: research.results.length,
    unavailableReason: research.unavailableReason,
  };

  let content: ContentPackage;
  try {
    const assignment = planAssignment(strategy, {
      date: now,
      seed: loadRuns().length,
      ...(options.postType ? { postType: options.postType } : {}),
    });
    if (assignment.substitution) {
      result.formatSubstitution = assignment.substitution;
      logger.info('Substituted the scheduled format', {
        from: assignment.substitution.from,
        to: assignment.postType,
        reason: assignment.substitution.reason,
      });
    }
    const generated = await generateContentPackage({
      strategy,
      research,
      assignment,
      recentTopics: recentTopics(28, now),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    content = generated.content;
  } catch (error) {
    result.status = 'failed';
    result.error = toSanitizedError(error);
    logger.error('Content generation failed', { code: result.error.code, msg: result.error.message });
    await persist(result, null, options.fetchImpl);
    return result;
  }

  applyContent(result, content);

  const quality = runQualityGate(content, {
    strategy,
    minWords: config.CONTENT_MIN_WORDS,
    maxWords: config.CONTENT_MAX_WORDS,
    destinations: destinationUrls(config),
    swipeEntries: loadSwipeFile(),
    authenticityIdeas: loadAuthenticityPack().ideas,
    recentTopics: recentTopics(28, now),
  });

  result.qualityPassed = quality.passed;
  result.qualityReasons = quality.failReasons;
  result.qualityScore = quality.qualityScore;
  result.wordCount = quality.wordCount;
  result.unsupportedAutomationDetected = quality.unsupportedAutomationDetected;

  if (!quality.passed) {
    result.status = 'quality_blocked';
    logger.warn('Quality gate blocked a draft', {
      reasons: quality.failReasons.length,
      postType: content.postType,
    });
    await persist(result, content, options.fetchImpl);
    return result;
  }

  // Optional image. A failure here is recorded but never fails the run.
  let generatedImage: { base64: string; mimeType: string } | null = null;
  if (content.needsImage && content.imagePrompt.trim() !== '') {
    result.imageStatus = 'prepared_not_attached';
    if (config.LINKEDIN_ENABLE_IMAGE_UPLOAD && !dryRun) {
      try {
        generatedImage = await generateImage(
          content.imagePrompt,
          options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
        );
      } catch (error) {
        result.imageStatus = 'generation_failed';
        logger.warn('Image generation failed; continuing text-only', {
          msg: toSanitizedError(error).message,
        });
      }
    }
  }

  if (draftOnly) {
    result.status = 'generated';
    await persist(result, content, options.fetchImpl);
    return result;
  }

  if (dryRun) {
    result.status = 'dry_run';
    logger.info('Dry run complete; nothing was published', { postType: content.postType });
    await persist(result, content, options.fetchImpl);
    return result;
  }

  // ---- Live publish ------------------------------------------------------
  let imageUrn: string | null = null;
  if (generatedImage) {
    try {
      imageUrn = await uploadImage(
        generatedImage,
        options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
      );
    } catch (error) {
      result.imageStatus = 'upload_failed';
      logger.warn('LinkedIn image upload failed; publishing text-only', {
        msg: toSanitizedError(error).message,
      });
    }
  }

  result.linkedin.attempted = true;
  try {
    const published = await publishTextPost({
      commentary: content.linkedinPost,
      imageUrn,
      imageAltText: imageUrn ? content.topic : undefined,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    result.linkedin.httpStatus = published.httpStatus;
    result.linkedin.postId = published.postId;
    result.linkedin.postUrl = published.postUrl;
    if (imageUrn) result.imageStatus = 'attached';
    // Publishing succeeded. Anything that failed around it downgrades the
    // status to partially_published — never the other way round.
    const imageDegraded =
      result.imageStatus === 'generation_failed' || result.imageStatus === 'upload_failed';
    result.status = imageDegraded ? 'partially_published' : 'published';
    if (content.authenticitySource.trim() !== '') {
      markAuthenticityIdeaUsed(content.authenticitySource.trim());
    }
  } catch (error) {
    const sanitized = toSanitizedError(error);
    result.status = 'failed';
    result.error = sanitized;
    result.linkedin.error = sanitized;
    result.linkedin.httpStatus = sanitized.httpStatus ?? null;
    logger.error('LinkedIn publishing failed', { code: sanitized.code, httpStatus: sanitized.httpStatus });
    await persist(result, content, options.fetchImpl);
    return result;
  }

  await persist(result, content, options.fetchImpl);

  // A logging failure must be visible without hiding the publish result.
  if (result.status === 'published' && result.logging.error !== null && isSheetsConfigured()) {
    result.status = 'partially_published';
  }

  return result;
}

async function persist(
  result: WorkflowResult,
  content: ContentPackage | null,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const published = result.status === 'published' || result.status === 'partially_published';
  const row: LogRow = {
    timestamp: result.timestamp,
    trigger: result.trigger,
    status: result.status,
    postType: result.postType ?? '',
    topic: result.topic,
    researchSource: result.researchSource,
    linkedinHook: result.hook,
    linkedinPost: result.linkedinPost,
    qualityPassed: String(result.qualityPassed),
    qualityReasons: result.qualityReasons.join(' | '),
    linkedinHttpStatus: result.linkedin.httpStatus === null ? '' : String(result.linkedin.httpStatus),
    linkedinPostId: result.linkedin.postId ?? '',
    imageStatus: result.imageStatus,
    errorMessage: result.error?.message ?? '',
  };

  if (isSheetsConfigured()) {
    result.logging = await appendRunRow(row, {
      published,
      ...(fetchImpl ? { fetchImpl } : {}),
    });
    if (result.logging.error) {
      logger.warn('Google Sheets logging failed', { error: result.logging.error });
    }
  } else {
    result.logging = { logged: false, sheet: null, error: null };
  }

  const record: RunRecord = {
    id: result.runId,
    timestamp: result.timestamp,
    trigger: result.trigger,
    status: result.status,
    postType: result.postType,
    topic: result.topic,
    researchSource: result.researchSource,
    hook: result.hook,
    linkedinPost: result.linkedinPost,
    qualityPassed: result.qualityPassed,
    qualityScore: result.qualityScore,
    qualityReasons: result.qualityReasons,
    linkedinHttpStatus: result.linkedin.httpStatus,
    linkedinPostId: result.linkedin.postId,
    imageStatus: result.imageStatus,
    loggingStatus: result.logging.logged
      ? 'logged'
      : result.logging.error
        ? 'failed'
        : 'skipped',
    errorMessage: result.error?.message ?? '',
  };

  try {
    appendRun(record);
  } catch (error) {
    logger.warn('Could not append to the local run log', {
      msg: toSanitizedError(error).message,
    });
  }

  void content;
}
