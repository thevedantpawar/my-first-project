export interface ProviderReadiness {
  gemini: boolean;
  tavily: boolean;
  linkedin: boolean;
  googleSheets: boolean;
}

export interface RunRecord {
  id: string;
  timestamp: string;
  trigger: string;
  status: string;
  postType: string | null;
  topic: string;
  hook: string;
  qualityPassed: boolean;
  qualityScore: number;
  qualityReasons: string[];
  linkedinHttpStatus: number | null;
  linkedinPostId: string | null;
  imageStatus: string;
  loggingStatus: string;
  errorMessage: string;
}

export interface ProfileAuditReport {
  items: { id: string; label: string; completed: boolean; notes: string }[];
  proof: { id: string; claim: string; evidenceUrl: string; recordedAt: string }[];
  completed: number;
  total: number;
  completionPercentage: number;
  warnings: string[];
}

export interface MixReport {
  balanced: boolean;
  warnings: string[];
  actualPercentages: Record<string, number>;
  targetPercentages: Record<string, number>;
}

export interface StatusResponse {
  service: string;
  platform: string;
  environment: string;
  providers: ProviderReadiness;
  linkedin: { personUrnFormatValid: boolean; apiVersion: string; imageUploadEnabled: boolean };
  scheduler: {
    enabled: boolean;
    timeZone: string;
    days: string;
    scheduledTime: string;
    nextRunAt: string | null;
    state: { lastRunAt: string | null; lastRunStatus: string | null; running: boolean } | null;
  };
  dryRun: { defaultEnabled: boolean; warning: string };
  contentLimits: { minWords: number; maxWords: number };
  destinations: Record<string, boolean>;
  strategy: {
    beliefs: { id: string; claim: string }[];
    painSignalCount: number;
    dreamSignalCount: number;
    timezone: string;
    growthTarget: { followers: number; months: number; guaranteed: boolean; note: string };
  } | null;
  strategyError: string | null;
  todaysPostType: string | null;
  portfolioMix: MixReport | null;
  profileAudit: ProfileAuditReport | { error: string } | null;
  library: { authenticityIdeas: number; swipeFileEntries: number };
  lastRun: RunRecord | null;
  totalRuns: number;
  unsupportedCapabilities: string[];
}

export interface SanitizedError {
  code: string;
  message: string;
  httpStatus?: number;
  details?: string;
}

export interface WorkflowResult {
  runId: string;
  timestamp: string;
  trigger: string;
  status: string;
  postType: string | null;
  topic: string;
  targetAudience: string;
  painSignal: string;
  dreamSignal: string;
  pointOfView: string;
  hook: string;
  linkedinPost: string;
  ctaType: string | null;
  ctaText: string;
  publicResourceUrl: string;
  needsImage: boolean;
  imagePrompt: string;
  researchSource: string;
  authenticitySource: string;
  qualityScore: number;
  qualityPassed: boolean;
  qualityReasons: string[];
  wordCount: number;
  unsupportedAutomationDetected: boolean;
  dryRun: boolean;
  imageStatus: string;
  linkedin: {
    attempted: boolean;
    httpStatus: number | null;
    postId: string | null;
    postUrl: string | null;
    error: SanitizedError | null;
  };
  logging: { logged: boolean; sheet: string | null; error: string | null };
  research: { available: boolean; sourceCount: number; unavailableReason: string | null };
  error: SanitizedError | null;
}

export interface CalendarResponse {
  timezone: string;
  entries: { date: string; weekday: number; weekIndex: number; postType: string; focus: string }[];
  plannedMix: MixReport;
  recentMix: MixReport;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const text = await response.text();
  const payload = text === '' ? null : (JSON.parse(text) as unknown);
  if (!response.ok && payload && typeof payload === 'object' && 'error' in payload) {
    // Workflow endpoints return the full result on 422/502; pass it through.
    if ('status' in (payload as Record<string, unknown>)) return payload as T;
    throw new Error(((payload as { error: SanitizedError }).error ?? {}).message ?? 'Request failed');
  }
  if (!response.ok && payload && typeof payload === 'object' && 'status' in payload) {
    return payload as T;
  }
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
  return payload as T;
}

export const api = {
  status: () => request<StatusResponse>('/api/workflows/linkedin-content/status'),
  draft: () =>
    request<WorkflowResult>('/api/workflows/linkedin-content/draft', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  dryRun: () =>
    request<WorkflowResult>('/api/workflows/linkedin-content/run', {
      method: 'POST',
      body: JSON.stringify({ dryRun: true }),
    }),
  publish: () =>
    request<WorkflowResult>('/api/linkedin/publish', {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    }),
  calendar: () => request<CalendarResponse>('/api/linkedin/calendar?weeks=4'),
  profileAudit: () => request<ProfileAuditReport>('/api/linkedin/profile-audit'),
};
