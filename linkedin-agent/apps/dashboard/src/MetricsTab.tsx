import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import type { AnalyticsResponse, PostMetricsInput, RunRecord } from './api.js';

const NUMERIC_FIELDS: { key: keyof PostMetricsInput; label: string; hint: string }[] = [
  { key: 'impressions', label: 'Impressions', hint: 'Post analytics → Impressions' },
  { key: 'reactions', label: 'Reactions', hint: 'The reaction count under the post' },
  { key: 'comments', label: 'Comments', hint: 'Exclude your own replies' },
  { key: 'reposts', label: 'Reposts', hint: 'Post analytics → Reposts' },
  { key: 'saves', label: 'Saves', hint: 'Not in the API — read it off post analytics' },
  { key: 'profileViews', label: 'Profile views', hint: 'Your profile analytics for that day' },
  { key: 'linkClicks', label: 'Link clicks', hint: 'Post analytics, or your link shortener' },
  { key: 'qualifiedConversations', label: 'Qualified conversations', hint: 'Real replies from an ICP buyer' },
  { key: 'bookedCalls', label: 'Booked calls', hint: 'Calls you can trace back to this post' },
];

function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(2)}%`;
}

export default function MetricsTab() {
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [selectedRun, setSelectedRun] = useState<string>('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [followers, setFollowers] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setAnalytics(await api.analytics());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Only published runs can carry metrics — they are the ones with a post id.
  const publishedRuns: RunRecord[] = (analytics?.runs ?? []).filter(
    (run) => run.linkedinPostId !== null && run.linkedinPostId !== '',
  );

  const submitMetrics = async (): Promise<void> => {
    const run = publishedRuns.find((candidate) => candidate.linkedinPostId === selectedRun);
    if (!run || !run.linkedinPostId) {
      setMessage('Pick a published post first.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.saveMetrics({
        postId: run.linkedinPostId,
        publishedAt: run.timestamp,
        postType: run.postType ?? 'Named Problem',
        ctaType: 'save',
        topic: run.topic,
        hook: run.hook,
        hadImage: run.imageStatus === 'attached',
        ...Object.fromEntries(
          NUMERIC_FIELDS.map((field) => [field.key, toNumber(fields[field.key as string] ?? '')]),
        ),
      });
      setMessage('Saved. Rates recalculate immediately.');
      setFields({});
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const submitFollowers = async (): Promise<void> => {
    const count = toNumber(followers);
    if (count === null) {
      setMessage('Enter a follower count.');
      return;
    }
    setBusy(true);
    try {
      await api.saveFollowers({
        date: new Date().toISOString().slice(0, 10),
        followers: count,
        note: '',
      });
      setFollowers('');
      setMessage('Follower sample recorded.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {message && <div className="banner banner-warn">{message}</div>}

      <section className="card">
        <h2>Record metrics for a post</h2>
        <p className="muted">
          LinkedIn&apos;s API does not expose saves or per-post profile views, so these are entered by
          hand. Leave a box empty when you do not know the number — blank stays <code>null</code> and
          is excluded from the maths, rather than counting as a zero.
        </p>

        {publishedRuns.length === 0 ? (
          <p className="muted">No published posts yet. Metrics can be attached once something is live.</p>
        ) : (
          <>
            <label className="field">
              <span>Post</span>
              <select value={selectedRun} onChange={(event) => setSelectedRun(event.target.value)}>
                <option value="">Choose a published post…</option>
                {publishedRuns.map((run) => (
                  <option key={run.id} value={run.linkedinPostId ?? ''}>
                    {run.timestamp.slice(0, 10)} — {run.postType} — {run.topic || run.hook}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid">
              {NUMERIC_FIELDS.map((field) => (
                <label className="field" key={field.key as string}>
                  <span>{field.label}</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    placeholder="unknown"
                    value={fields[field.key as string] ?? ''}
                    onChange={(event) =>
                      setFields({ ...fields, [field.key as string]: event.target.value })
                    }
                  />
                  <small className="muted">{field.hint}</small>
                </label>
              ))}
            </div>

            <button onClick={() => void submitMetrics()} disabled={busy || selectedRun === ''}>
              {busy ? 'Saving…' : 'Save metrics'}
            </button>
          </>
        )}
      </section>

      <section className="card">
        <h2>Follower count</h2>
        <p className="muted">
          Record this weekly. It is what the pacing report is built from, and pacing is directional —
          never a promise.
        </p>
        <div className="actions">
          <input
            type="number"
            min="0"
            placeholder="Followers today"
            value={followers}
            onChange={(event) => setFollowers(event.target.value)}
          />
          <button onClick={() => void submitFollowers()} disabled={busy}>
            Record
          </button>
        </div>
        {analytics?.followerTarget && (
          <p className="muted">
            Current: {analytics.followerTarget.current ?? '—'} · Pacing:{' '}
            {analytics.followerTarget.pacing.replace(/_/g, ' ')} · {analytics.followerTarget.note}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Recorded posts</h2>
        {analytics && analytics.posts.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Engagement</th>
                  <th>Repost</th>
                  <th>Profile conv.</th>
                  <th>Qualified action</th>
                </tr>
              </thead>
              <tbody>
                {analytics.posts.map((post) => (
                  <tr key={post.postId}>
                    <td>{post.topic || post.postId}</td>
                    <td>{percent(post.rates.engagementRate)}</td>
                    <td>{percent(post.rates.repostRate)}</td>
                    <td>{percent(post.rates.profileConversionRate)}</td>
                    <td>{percent(post.rates.qualifiedActionRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Nothing recorded yet.</p>
        )}
      </section>
    </>
  );
}
