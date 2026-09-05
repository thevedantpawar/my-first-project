import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import type { CalendarResponse, ProfileAuditReport, StatusResponse, WorkflowResult } from './api.js';

type Tab = 'operations' | 'strategy' | 'profile';

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`badge ${ok ? 'badge-ok' : 'badge-off'}`}>
      {label}: {ok ? 'configured' : 'not configured'}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'published'
      ? 'ok'
      : status === 'dry_run' || status === 'generated'
        ? 'info'
        : status === 'partially_published'
          ? 'warn'
          : 'bad';
  return <span className={`pill pill-${tone}`}>{status.replace(/_/g, ' ')}</span>;
}

function isAuditReport(value: unknown): value is ProfileAuditReport {
  return typeof value === 'object' && value !== null && 'items' in value;
}

export default function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [result, setResult] = useState<WorkflowResult | null>(null);
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('operations');

  const refresh = useCallback(async () => {
    setBusy('status');
    setError(null);
    try {
      setStatus(await api.status());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (tab !== 'strategy' || calendar) return;
    void api
      .calendar()
      .then(setCalendar)
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
      );
  }, [tab, calendar]);

  const run = useCallback(
    async (action: 'draft' | 'dryRun' | 'publish') => {
      if (action === 'publish') {
        const confirmed = window.confirm(
          'Publish this run to LinkedIn now?\n\nThis posts to the authenticated profile immediately and cannot be undone from here.',
        );
        if (!confirmed) return;
      }
      setBusy(action);
      setError(null);
      try {
        const next = await api[action]();
        setResult(next);
        setStatus(await api.status());
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const audit = status && isAuditReport(status.profileAudit) ? status.profileAudit : null;

  return (
    <div className="app">
      <header>
        <div>
          <h1>Microns LinkedIn Content Agent</h1>
          <p className="sub">
            LinkedIn only. No Twitter/X, no comment automation, no DMs — by design.
          </p>
        </div>
        <button onClick={() => void refresh()} disabled={busy !== null}>
          {busy === 'status' ? 'Refreshing…' : 'Refresh Status'}
        </button>
      </header>

      {error && <div className="banner banner-bad">{error}</div>}

      {status?.dryRun.defaultEnabled && (
        <div className="banner banner-warn">
          <strong>Dry run is ON.</strong> {status.dryRun.warning}
        </div>
      )}
      {status && !status.dryRun.defaultEnabled && (
        <div className="banner banner-live">
          <strong>Dry run is OFF.</strong> {status.dryRun.warning}
        </div>
      )}

      <nav className="tabs">
        {(['operations', 'strategy', 'profile'] as Tab[]).map((candidate) => (
          <button
            key={candidate}
            className={tab === candidate ? 'tab tab-active' : 'tab'}
            onClick={() => setTab(candidate)}
          >
            {candidate}
          </button>
        ))}
      </nav>

      {tab === 'operations' && (
        <>
          <section className="card">
            <h2>Providers</h2>
            <div className="badges">
              <Badge ok={status?.providers.gemini ?? false} label="Gemini" />
              <Badge ok={status?.providers.tavily ?? false} label="Tavily" />
              <Badge ok={status?.providers.linkedin ?? false} label="LinkedIn" />
              <Badge ok={status?.providers.googleSheets ?? false} label="Google Sheets" />
            </div>
            {status && !status.linkedin.personUrnFormatValid && (
              <p className="warn-text">
                LINKEDIN_PERSON_URN does not start with <code>urn:li:person:</code>. Publishing is blocked.
              </p>
            )}
            <p className="muted">
              Credentials are never sent to this dashboard — only whether each one is present.
            </p>
          </section>

          <section className="card">
            <h2>Scheduler</h2>
            <dl className="kv">
              <dt>Enabled</dt>
              <dd>{status?.scheduler.enabled ? 'yes' : 'no'}</dd>
              <dt>Scheduled time</dt>
              <dd>
                {status?.scheduler.scheduledTime} {status?.scheduler.timeZone} ({status?.scheduler.days})
              </dd>
              <dt>Next run</dt>
              <dd>{status?.scheduler.nextRunAt ?? '—'}</dd>
              <dt>Today&apos;s format</dt>
              <dd>{status?.todaysPostType ?? 'weekend — nothing scheduled'}</dd>
              <dt>Last run</dt>
              <dd>
                {status?.lastRun ? (
                  <>
                    {new Date(status.lastRun.timestamp).toLocaleString()}{' '}
                    <StatusPill status={status.lastRun.status} />
                  </>
                ) : (
                  '—'
                )}
              </dd>
              <dt>Total runs</dt>
              <dd>{status?.totalRuns ?? 0}</dd>
            </dl>
          </section>

          <section className="card">
            <h2>Actions</h2>
            <div className="actions">
              <button onClick={() => void run('draft')} disabled={busy !== null}>
                {busy === 'draft' ? 'Generating…' : 'Generate Draft'}
              </button>
              <button onClick={() => void run('dryRun')} disabled={busy !== null}>
                {busy === 'dryRun' ? 'Running…' : 'Run Dry Test'}
              </button>
              <button
                className="danger"
                onClick={() => void run('publish')}
                disabled={busy !== null || !(status?.providers.linkedin ?? false)}
              >
                {busy === 'publish' ? 'Publishing…' : 'Publish Now'}
              </button>
            </div>
            <p className="muted">
              Generate Draft and Run Dry Test never touch LinkedIn. Publish Now asks for confirmation
              first and posts immediately.
            </p>
          </section>

          {result && (
            <section className="card">
              <h2>
                Last result <StatusPill status={result.status} />
              </h2>

              <dl className="kv">
                <dt>Post type</dt>
                <dd>{result.postType ?? '—'}</dd>
                <dt>Topic</dt>
                <dd>{result.topic || '—'}</dd>
                <dt>Audience</dt>
                <dd>{result.targetAudience || '—'}</dd>
                <dt>Pain / dream signal</dt>
                <dd>
                  {result.painSignal || '—'} / {result.dreamSignal || '—'}
                </dd>
                <dt>Point of view</dt>
                <dd>{result.pointOfView || '—'}</dd>
                <dt>Research source</dt>
                <dd>
                  {result.researchSource || '—'}
                  {!result.research.available && (
                    <span className="warn-text">
                      {' '}
                      (current research unavailable: {result.research.unavailableReason})
                    </span>
                  )}
                </dd>
                <dt>Authenticity source</dt>
                <dd>{result.authenticitySource || '—'}</dd>
                <dt>Word count</dt>
                <dd>{result.wordCount}</dd>
                <dt>Image</dt>
                <dd>{result.imageStatus.replace(/_/g, ' ')}</dd>
              </dl>

              {result.formatSubstitution && (
                <p className="warn-text">
                  Scheduled format &ldquo;{result.formatSubstitution.from}&rdquo; was swapped for
                  &ldquo;{result.postType}&rdquo;. {result.formatSubstitution.reason}
                </p>
              )}

              <h3>
                Quality gate: {result.qualityPassed ? 'passed' : 'blocked'} (score {result.qualityScore})
              </h3>
              {result.qualityReasons.length > 0 && (
                <ul className="reasons">
                  {result.qualityReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
              {result.unsupportedAutomationDetected && (
                <p className="warn-text">
                  The draft promised comment or DM automation. It was blocked — this system cannot
                  deliver on that promise.
                </p>
              )}

              <h3>Post preview</h3>
              <pre className="post">{result.linkedinPost || '(nothing generated)'}</pre>
              {result.ctaText && (
                <p className="muted">
                  CTA ({result.ctaType}): {result.ctaText}
                  {result.publicResourceUrl ? ` → ${result.publicResourceUrl}` : ''}
                </p>
              )}
              {result.needsImage && (
                <>
                  <h3>Image prompt</h3>
                  <pre className="post">{result.imagePrompt}</pre>
                </>
              )}

              <h3>LinkedIn</h3>
              {result.linkedin.attempted ? (
                <dl className="kv">
                  <dt>HTTP status</dt>
                  <dd>{result.linkedin.httpStatus ?? '—'}</dd>
                  <dt>Post id</dt>
                  <dd>{result.linkedin.postId ?? '—'}</dd>
                  <dt>URL</dt>
                  <dd>
                    {result.linkedin.postUrl ? (
                      <a href={result.linkedin.postUrl} target="_blank" rel="noreferrer">
                        {result.linkedin.postUrl}
                      </a>
                    ) : (
                      '—'
                    )}
                  </dd>
                  {result.linkedin.error && (
                    <>
                      <dt>Error</dt>
                      <dd className="warn-text">
                        [{result.linkedin.error.code}] {result.linkedin.error.message}
                      </dd>
                    </>
                  )}
                </dl>
              ) : (
                <p className="muted">Not attempted — {result.dryRun ? 'dry run' : 'blocked before publishing'}.</p>
              )}

              <h3>Logging</h3>
              <p className={result.logging.error ? 'warn-text' : 'muted'}>
                {result.logging.logged
                  ? `Logged to the "${result.logging.sheet}" sheet.`
                  : (result.logging.error ?? 'Google Sheets is not configured; nothing was logged.')}
              </p>

              {result.error && (
                <>
                  <h3>Error</h3>
                  <p className="warn-text">
                    [{result.error.code}] {result.error.message}
                    {result.error.details ? ` — ${result.error.details}` : ''}
                  </p>
                </>
              )}
            </section>
          )}
        </>
      )}

      {tab === 'strategy' && (
        <>
          <section className="card">
            <h2>Category point of view</h2>
            <ol className="reasons">
              {(status?.strategy?.beliefs ?? []).map((belief) => (
                <li key={belief.id}>
                  <code>{belief.id}</code> — {belief.claim}
                </li>
              ))}
            </ol>
            <p className="muted">
              {status?.strategy?.painSignalCount ?? 0} pain signals ·{' '}
              {status?.strategy?.dreamSignalCount ?? 0} dream signals ·{' '}
              {status?.library.authenticityIdeas ?? 0} authenticity ideas ·{' '}
              {status?.library.swipeFileEntries ?? 0} swipe-file entries
            </p>
            {status?.strategy && (
              <p className="muted">
                Working target: {status.strategy.growthTarget.followers.toLocaleString()} relevant
                followers in {status.strategy.growthTarget.months} months.{' '}
                {status.strategy.growthTarget.note}
              </p>
            )}
          </section>

          <section className="card">
            <h2>Portfolio balance (rolling window)</h2>
            {status?.portfolioMix ? (
              status.portfolioMix.warnings.length === 0 ? (
                <p className="muted">Balanced against the configured target mix.</p>
              ) : (
                <ul className="reasons">
                  {status.portfolioMix.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )
            ) : (
              <p className="muted">No published runs yet.</p>
            )}
          </section>

          <section className="card">
            <h2>Next four weeks</h2>
            {calendar ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Format</th>
                    <th>Focus</th>
                  </tr>
                </thead>
                <tbody>
                  {calendar.entries.map((entry) => (
                    <tr key={entry.date}>
                      <td>{entry.date}</td>
                      <td>{entry.postType}</td>
                      <td className="muted">{entry.focus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">Loading…</p>
            )}
          </section>
        </>
      )}

      {tab === 'profile' && (
        <section className="card">
          <h2>Profile conversion checklist</h2>
          {audit ? (
            <>
              <p className="muted">
                {audit.completed} of {audit.total} complete ({audit.completionPercentage}%)
              </p>
              <ul className="checklist">
                {audit.items.map((item) => (
                  <li key={item.id} className={item.completed ? 'done' : 'todo'}>
                    {item.completed ? '✓' : '○'} {item.label}
                    {item.notes && <span className="muted"> — {item.notes}</span>}
                  </li>
                ))}
              </ul>
              {audit.warnings.length > 0 && (
                <>
                  <h3>Warnings</h3>
                  <ul className="reasons">
                    {audit.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </>
              )}
              <p className="muted">
                Proof is recorded by hand in <code>config/strategy/profile-audit.json</code>. The agent
                never invents clients, revenue or testimonials.
              </p>
            </>
          ) : (
            <p className="muted">Profile audit unavailable.</p>
          )}
        </section>
      )}

      <footer className="card">
        <h2>Deliberately unsupported</h2>
        <ul className="reasons">
          {(status?.unsupportedCapabilities ?? []).map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
        <p className="muted">
          The quality gate blocks any draft that promises one of these, so a post can never offer
          something the system cannot deliver.
        </p>
      </footer>
    </div>
  );
}
