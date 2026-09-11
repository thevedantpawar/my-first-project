import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import type { Overview } from './api.js';

const REFRESH_MS = 20_000;

/** Status colours always ship with a text label — never colour alone. */
const STATUS: Record<string, { label: string; short: string; tone: string }> = {
  published: { label: 'Published', short: 'P', tone: 'ok' },
  blocked: { label: 'Gate blocked', short: 'B', tone: 'warn' },
  failed: { label: 'Failed', short: 'F', tone: 'bad' },
  none: { label: 'No run', short: '·', tone: 'none' },
  weekend: { label: 'Weekend', short: '', tone: 'weekend' },
  future: { label: 'Upcoming', short: '', tone: 'none' },
};

function pct(value: number | null, digits = 0): string {
  return value === null ? 'not recorded' : `${(value * 100).toFixed(digits)}%`;
}

function num(value: number | null): string {
  return value === null ? 'not recorded' : value.toLocaleString();
}

function money(value: number | null): string {
  return value === null
    ? 'not recorded'
    : `$${Math.round(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function countdown(seconds: number | null): string {
  if (seconds === null) return 'scheduler off';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Tile({
  label,
  value,
  sub,
  tone = 'plain',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className={`tile tile-${tone}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

export default function LiveTab() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.overview());
      setUpdatedAt(new Date());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    void load();
    timer.current = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, [load]);

  if (error) return <div className="banner banner-bad">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;

  const { publishing, followers, pipeline, schedule } = data;
  const pacingTone =
    followers.pacing === 'ahead' ? 'ok' : followers.pacing === 'behind' ? 'warn' : 'plain';

  return (
    <>
      <div className="live-head">
        <span className="live-dot" aria-hidden="true" />
        <span className="muted">
          Live · refreshes every {REFRESH_MS / 1000}s
          {updatedAt && ` · updated ${updatedAt.toLocaleTimeString()}`}
        </span>
      </div>

      <section className="tiles">
        <Tile
          label="Next scheduled post"
          value={countdown(schedule.secondsUntilNextRun)}
          sub={`${schedule.scheduledTime} ${schedule.timeZone}${schedule.dryRun ? ' · DRY RUN' : ''}`}
          tone={schedule.dryRun ? 'warn' : 'plain'}
        />
        <Tile
          label="Publish rate"
          value={pct(publishing.publishRate)}
          sub={`${publishing.published} of ${publishing.weekdaysElapsed} weekdays`}
        />
        <Tile
          label="Current streak"
          value={`${publishing.currentStreak}`}
          sub="consecutive weekdays published"
        />
        <Tile
          label="Followers"
          value={followers.current === null ? 'no sample' : followers.current.toLocaleString()}
          sub={
            followers.current === null
              ? 'record one in Metrics to start pacing'
              : `${num(followers.gapToTarget)} to go · ${followers.weeksRemaining} weeks left`
          }
          tone={pacingTone}
        />
      </section>

      <section className="card">
        <h2>Last 28 days</h2>
        <div className="strip">
          {data.calendar.map((cell) => {
            const meta = STATUS[cell.status] ?? STATUS.none!;
            return (
              <div
                key={cell.date}
                className={`cell cell-${meta.tone}`}
                title={`${cell.date} — ${meta.label}${cell.topic ? `: ${cell.topic}` : ''}`}
              >
                {meta.short}
              </div>
            );
          })}
        </div>
        <div className="legend">
          {['published', 'blocked', 'failed', 'none', 'weekend'].map((key) => {
            const meta = STATUS[key]!;
            return (
              <span key={key} className="legend-item">
                <span className={`swatch swatch-${meta.tone}`} aria-hidden="true" />
                {meta.label}
              </span>
            );
          })}
        </div>
        <dl className="kv">
          <dt>Gate blocked</dt>
          <dd>{publishing.blocked}</dd>
          <dt>Failed</dt>
          <dd>{publishing.failed}</dd>
          <dt>Weekdays with no run at all</dt>
          <dd>{publishing.missed}</dd>
          <dt>First-pass rate</dt>
          <dd>{pct(publishing.firstPassRate)}</dd>
          <dt>Rescued by one revision</dt>
          <dd>
            {publishing.revisionRescues}{' '}
            <span className="muted">
              {publishing.revisionRescues > 0 && '— days that would have published nothing'}
            </span>
          </dd>
        </dl>
      </section>

      <section className="card">
        <h2>Pipeline — what the audience is actually worth</h2>
        <p className="muted">
          Follower count is not an input here, deliberately. A thousand of the wrong people is
          worth nothing and two hundred of the right ones can be worth a great deal. What predicts
          revenue is the chain below.
        </p>

        <table className="table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Recorded</th>
              <th>From previous</th>
            </tr>
          </thead>
          <tbody>
            {data.funnel.map((step) => (
              <tr key={step.label}>
                <td>
                  {step.label}
                  <div className="muted">{step.note}</div>
                </td>
                <td>{num(step.value)}</td>
                <td>{pct(step.rateFromPrevious, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Projection</h3>
        {pipeline.configured ? (
          <>
            <dl className="kv">
              <dt>Qualified conversations / month</dt>
              <dd>{pipeline.qualifiedConversationsPerMonth?.toFixed(1) ?? 'not recorded'}</dd>
              <dt>Projected calls / month</dt>
              <dd>{pipeline.projectedCallsPerMonth?.toFixed(1) ?? 'not recorded'}</dd>
              <dt>Projected deals / month</dt>
              <dd>{pipeline.projectedDealsPerMonth?.toFixed(2) ?? 'not recorded'}</dd>
              <dt>Projected revenue / month</dt>
              <dd>{money(pipeline.projectedRevenuePerMonth)}</dd>
              <dt>Projected gross profit / month</dt>
              <dd>{money(pipeline.projectedGrossProfitPerMonth)}</dd>
              <dt>Revenue actually recorded</dt>
              <dd>{money(pipeline.recordedRevenueToDate)}</dd>
            </dl>
            <p className={pipeline.usingRecordedRates ? 'muted' : 'warn-text'}>
              {pipeline.usingRecordedRates
                ? 'Conversion rates measured from your own entries.'
                : 'Conversion rates are assumptions you set, not measurements. They are replaced by real ones as soon as you record calls.'}
            </p>
          </>
        ) : (
          <p className="warn-text">
            Not projecting anything yet. Set <code>averageDealValueUsd</code> in{' '}
            <code>config/strategy/economics.json</code> and this becomes real.
          </p>
        )}
        <ul className="reasons">
          {pipeline.assumptions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="muted">{pipeline.caveat}</p>
      </section>

      {data.formulaUsage.length > 0 && (
        <section className="card">
          <h2>Hook formulas used</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Formula</th>
                <th>Posts</th>
              </tr>
            </thead>
            <tbody>
              {data.formulaUsage.map((formula) => (
                <tr key={formula.id}>
                  <td>
                    {formula.id} {formula.name}
                  </td>
                  <td>{formula.uses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2>Recent runs</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>Format</th>
                <th>Topic</th>
              </tr>
            </thead>
            <tbody>
              {data.recentRuns.map((run) => (
                <tr key={run.id}>
                  <td>{new Date(run.timestamp).toLocaleString()}</td>
                  <td>{run.status.replace(/_/g, ' ')}</td>
                  <td>{run.postType ?? '—'}</td>
                  <td>{run.topic || run.hook || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
