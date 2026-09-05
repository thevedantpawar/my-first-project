# Microns LinkedIn Content Agent

A LinkedIn content operating system for Vedant Pawar and Microns: it researches
current AI-automation material, writes one post in the format the calendar calls
for, runs it through a quality gate, optionally prepares a diagram, publishes to
the authenticated LinkedIn profile, logs the run, and repeats Monday to Friday at
21:00 Asia/Kolkata.

## Scope

This is **LinkedIn only**. The following are deliberately absent, and the quality
gate blocks any draft that promises them:

- Twitter/X, or any cross-posting
- Automatic DMs, keyword-triggered DMs
- Automatic replies to commenters, automatic commenter mentions
- Comment monitoring
- Connection requests

Every CTA the agent writes must be honest without any of those. A draft saying
"Comment WORKFLOW and I'll send you the blueprint" is blocked, because nothing in
this system can deliver it.

The follower target (10,000 relevant followers in four months) is a direction to
work toward. The system reports whether pacing is ahead, on track or behind, and
never presents the number as a guarantee.

## Layout

```
linkedin-agent/
  config/strategy/          Editable strategy: point of view, signal libraries,
                            audience, weekly portfolio, CTA map, profile audit
  data/                     Runtime state (git-ignored): run log, authenticity
                            pack, swipe file, analytics
  apps/api/
    src/
      agents/linkedin-content-agent/   Assignment planning and prompt building
      workflows/linkedin-content-workflow.ts
      providers/            gemini.ts, tavily.ts, linkedin.ts, google-sheets.ts
      validation/           Zod contract + the quality gate
      calendar/             Monday-Friday calendar and portfolio mix
      analytics/            Rate maths and the 30-day review
      profile/              Profile conversion checklist
      scheduler/weekday-scheduler.ts
      routes/               Express endpoints
    tests/                  Vitest suites
  apps/dashboard/           React + Vite operational dashboard
```

## Quick start

```bash
cd linkedin-agent
npm install
cp .env.example .env         # the API loads linkedin-agent/.env
# fill in GEMINI_API_KEY at minimum
npm run typecheck
npm test
npm run build

npm run dev                  # API on http://localhost:3001
npm run dev:dashboard        # dashboard on http://localhost:5173 (proxies /api)
```

`SOCIAL_CONTENT_DRY_RUN` defaults to `true`. Leave it that way until you have
reviewed several drafts by hand.

## Provider setup

### Gemini (required)

Create an API key at <https://aistudio.google.com/apikey> and set
`GEMINI_API_KEY`. `GEMINI_MODEL` defaults to `gemini-3.6-flash`. Without this key
the workflow fails fast with `config_missing` — it never publishes filler.

### Tavily (optional but recommended)

Create a key at <https://tavily.com> and set `TAVILY_API_KEY`. Tune
`CONTENT_RESEARCH_QUERY` to the material you want the agent reading.

If Tavily is unavailable the run continues on an evergreen idea, `researchSource`
starts with `Current research unavailable`, and the quality gate then blocks any
recency claim ("today", "just announced", "this week") in the post. An evergreen
idea is never dressed up as news.

### LinkedIn (required to publish)

1. Create an app at <https://www.linkedin.com/developers/apps> and associate it
   with your company page.
2. Request the **Share on LinkedIn** and **Sign In with LinkedIn using OpenID
   Connect** products. You need the `w_member_social` and `openid profile`
   scopes.
3. Run the 3-legged OAuth flow and keep the member access token. Set it as
   `LINKEDIN_ACCESS_TOKEN`. Member tokens expire (60 days by default) — an
   expired token surfaces as `linkedin_unauthorized` with a clear message.
4. Get your person URN. Call the userinfo endpoint with the token:

   ```bash
   curl -H "Authorization: Bearer $LINKEDIN_ACCESS_TOKEN" \
     https://api.linkedin.com/v2/userinfo
   ```

   Take the `sub` value and set `LINKEDIN_PERSON_URN=urn:li:person:<sub>`. The
   provider refuses to publish if it does not start with `urn:li:person:`.
5. `LINKEDIN_API_VERSION` is the `LinkedIn-Version` header (`YYYYMM`). Bump it
   when LinkedIn retires the version you are pinned to.

Publishing posts to `POST https://api.linkedin.com/rest/posts` as the
authenticated member. That is the only write this system performs.

**Images.** Upload is implemented (`initializeUpload` → `PUT` the bytes → attach
the returned `urn:li:image:` to the post) but disabled by default. With
`LINKEDIN_ENABLE_IMAGE_UPLOAD=false` a post that wants a diagram publishes
text-only and records `imageStatus: prepared_not_attached`. A fabricated or
external image URL is never sent to LinkedIn.

### Google Sheets (optional)

1. Create a spreadsheet and copy its id from the URL into `GOOGLE_SHEETS_ID`.
   The `published` and `blocked` tabs are created automatically, with their
   header rows, the first time the agent writes to them.
2. Authenticate. Two ways, and the choice matters:

   **Refresh token (use this).** A Google access token lasts about an hour, so a
   bare token is dead before the next scheduled run. Create an OAuth client of
   type *Desktop app* in Google Cloud with the Sheets API enabled, consent once
   for the `https://www.googleapis.com/auth/spreadsheets` scope, then set
   `GOOGLE_SHEETS_CLIENT_ID`, `GOOGLE_SHEETS_CLIENT_SECRET` and
   `GOOGLE_SHEETS_REFRESH_TOKEN`. The app mints its own access tokens and caches
   each until a minute before expiry.

   **Access token.** Set `GOOGLE_SHEETS_ACCESS_TOKEN` for a one-off manual test.
   It stops working within the hour.

   A Claude Google connector authenticates Claude, not this app, so it cannot
   supply either credential — it can create the spreadsheet, not write to it on a
   schedule.

Columns appended per run: `timestamp, trigger, status, postType, topic,
researchSource, linkedinHook, linkedinPost, qualityPassed, qualityReasons,
linkedinHttpStatus, linkedinPostId, imageStatus, errorMessage`.

A Sheets failure is reported separately and never hides the LinkedIn result: a
post that published while logging failed comes back as `partially_published`
with the logging error attached.

## Workflow statuses

| Status | Meaning |
| --- | --- |
| `generated` | Draft produced and validated. Nothing published. |
| `quality_blocked` | The quality gate refused it. Reasons are returned. |
| `dry_run` | Generated, validated, not published. |
| `published` | Live on LinkedIn, with a post id. |
| `partially_published` | Published, but the image or the logging step failed. |
| `failed` | Something upstream of a confirmed publish failed. |

`published` is only ever returned when LinkedIn returned a post id.

## Dry-run mode

With `SOCIAL_CONTENT_DRY_RUN=true` (the default) every run researches, generates,
validates and prepares image metadata, then stops. Nothing is published.

```bash
curl -X POST localhost:3001/api/workflows/linkedin-content/draft -H 'content-type: application/json' -d '{}'
curl -X POST localhost:3001/api/workflows/linkedin-content/run   -H 'content-type: application/json' -d '{"dryRun": true}'
```

With `SOCIAL_CONTENT_DRY_RUN=false`, a manual run still requires an explicit
confirmation; the scheduler's authorisation is `SOCIAL_CONTENT_SCHEDULER_ENABLED`.

```bash
curl -X POST localhost:3001/api/linkedin/publish -H 'content-type: application/json' -d '{"confirm": true}'
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness. |
| GET | `/api/workflows/linkedin-content/status` | Full operational status. |
| POST | `/api/workflows/linkedin-content/draft` | Generate and validate. Never publishes. |
| POST | `/api/workflows/linkedin-content/run` | Run with optional `{ dryRun, confirm }`. |
| POST | `/api/agents/trigger` | `{ "agentId": "linkedin-content-agent" }`. |
| GET | `/api/linkedin/strategy` | Point of view, signal libraries, portfolio, CTA map. |
| GET | `/api/linkedin/calendar?weeks=4` | Monday-Friday calendar and mix report. |
| POST | `/api/linkedin/draft` | Alias of the draft endpoint. |
| POST | `/api/linkedin/publish` | Live publish. Requires `{ "confirm": true }`. |
| GET/POST | `/api/linkedin/authenticity-pack` | Read / ingest the monthly pack. |
| GET/POST | `/api/linkedin/swipe-file` | Read / add a pattern entry. |
| GET/POST | `/api/linkedin/profile-audit` | Checklist and manual proof. |
| GET/POST | `/api/linkedin/analytics` | Read rates / record post metrics or a follower sample. |
| POST | `/api/linkedin/monthly-review` | 30-day rankings and recommendations. |

## Strategy configuration

Everything editorial lives in `config/strategy/` and is re-read on every request,
so you can change it without a restart.

- **`point-of-view.json`** — the three recurring beliefs. Every post reinforces
  one or challenges it explicitly. The gate rejects a post whose `pointOfView` is
  not one of them.
- **`pain-signals.json` / `dream-signals.json`** — the ICP signal libraries.
  Every post must name at least one signal from these files.
- **`audience.json`** — positioning, the topics to reject outright, the growth
  target.
- **`content-portfolio.json`** — the weekday map (Mon named problem, Tue deep
  work system, Wed audit, Thu founder story, Fri point of view / lead magnet on
  alternate weeks) and the rolling four-week target mix (30/25/20/15/10).
- **`cta.json`** — the CTA types and which post types may use them. A CTA whose
  destination URL is not configured in `.env` is dropped before generation and
  blocked at the gate, so the agent can never point at a resource that does not
  exist.
- **`profile-audit.json`** — the profile conversion checklist and your real
  proof. Nothing here is inferred; you tick items off yourself.

## One post per weekday

The portfolio is one primary post per weekday, and the workflow enforces it.
Before any provider call, a publish run checks whether something already went out
today in `Asia/Kolkata`. If it has, the run stops immediately with
`error.code: "duplicate_run"` — no research, no generation, no Gemini quota
spent. Drafts and dry runs are unaffected; it is publishing that is capped.

To publish a second post deliberately, send `allowSecondPostToday: true`
alongside `confirm: true`.

## When a format cannot be produced honestly

Two formats depend on things that may not exist yet:

- **Founder/Practitioner Story** needs a real entry in the authenticity pack.
- **Lead Magnet** needs a configured destination URL (`PUBLIC_RESOURCE_URL` or
  `PROFILE_URL`); every one of its CTAs is a link.

Rather than generate a post that the quality gate would certainly block, the
agent substitutes the nearest format it *can* deliver and says so. The run comes
back with `formatSubstitution: { from, reason }`, and the dashboard shows the
swap above the quality-gate result. Fill in the missing piece and the scheduled
format is used again on its own.

## Reliability notes

- Gemini's "this model is currently experiencing high demand" arrives as a 503
  and clears within seconds. The provider retries it twice (1.5s, then 4s). A
  429 quota error is never retried — that would only burn the quota faster.
- The quality gate is strict on purpose, and it does block real drafts. Observed
  causes are the model paraphrasing its own first line into `linkedinHook`, or
  writing a forbidden word into `imagePrompt`. A blocked run publishes nothing,
  logs the reasons, and returns `quality_blocked`; the next scheduled run tries
  again. If you would rather the agent get one corrective attempt before giving
  up, that is a deliberate change to the contract and is not enabled.
- `SKIP_DOTENV=true` stops the API reading `.env`. The test suite sets it, so
  the suite behaves the same whether or not this machine has one.

## Authenticity pack

Personal stories come only from material you supply. Paste voice-memo
transcripts, call notes, decisions and mistakes:

```bash
curl -X POST localhost:3001/api/linkedin/authenticity-pack \
  -H 'content-type: application/json' \
  -d '{"rawNotes": "A duplicate invoice went out because the retry had no idempotency key.\n\nI keep telling people to instrument the failure path first."}'
```

Blank lines split the text into ideas. The original wording is stored verbatim.

The live pack is `data/authenticity-pack.json`, which is git-ignored because it
is your material, not code. A committed copy lives at
`config/authenticity-pack.seed.json` so a fresh deploy has something to restore
from: `cp config/authenticity-pack.seed.json data/authenticity-pack.json`.
If the pack is empty, Thursday's founder-story slot falls back to a named-problem
post rather than inventing a memory, and the gate blocks any story whose
`authenticitySource` does not match a real pack entry.

## Swipe file

Swipe-file entries record patterns, never wording. There is no field for copied
text and `copiedText: true` is rejected. A generated post that shares an 8-word
run with any entry is blocked as copying.

## Analytics and the learning loop

Record what LinkedIn will not hand you automatically:

```bash
curl -X POST localhost:3001/api/linkedin/analytics -H 'content-type: application/json' -d '{
  "postId": "urn:li:share:...", "publishedAt": "2026-09-01T15:30:00.000Z",
  "postType": "Surfaced Problem/Audit", "ctaType": "save",
  "impressions": 3200, "reactions": 74, "comments": 11, "reposts": 4,
  "saves": 38, "profileViews": 96, "linkClicks": 22,
  "qualifiedConversations": 3, "bookedCalls": 1
}'
curl -X POST localhost:3001/api/linkedin/monthly-review -H 'content-type: application/json' -d '{"windowDays": 30}'
```

A metric you never recorded reads as `null`, not `0` — a missing number must not
look like a bad result. Rankings put business outcome first and audience
relevance second; distribution is reported but is never the headline.

## Engagement

Publishing alone is not enough, and this system will not fake the rest. There is
no bot commenting, no mass connection requests, no automated replies. The daily
human loop — 15-30 minutes reading ICP posts, a few specific comments, replying
to real comments on your own post, recording recurring prospect language in the
authenticity pack — stays manual on purpose.

## Live deployment

Running on Railway, project `microns-linkedin-agent`:

- **https://linkedin-agent-production-a802.up.railway.app** — dashboard and API on one origin
- Source: this branch, root directory `/linkedin-agent`, built from the Dockerfile
- Volume mounted at `/app/data`, so the run log and libraries survive redeploys
- Healthcheck on `/health`, restart on failure

Startup verifies both credentials and logs the result, so a dead token is
visible in the Railway logs rather than at 21:00:

```
LinkedIn token verified    member="Vedant Pawar" httpStatus=200
Research provider verified sources=8
```

`GET /api/linkedin/verify` re-runs the LinkedIn check on demand. It calls
`/v2/userinfo` and publishes nothing.

Environment variables are set on the Railway service, not in a committed file.
Redeploy after changing one; `SOCIAL_CONTENT_DRY_RUN` is the switch that decides
whether the 21:00 run publishes.

## Deployment (self-hosted)

The API is a single Node process.

```bash
npm run build
NODE_ENV=production node apps/api/dist/index.js
```

Notes:

- The process must stay running for the scheduler to fire; it is process-local,
  not a cron entry. On a platform that sleeps idle containers, either keep the
  instance warm or drive `/api/agents/trigger` from an external scheduler with
  `SOCIAL_CONTENT_SCHEDULER_ENABLED=false`.
- Run exactly one instance with the scheduler enabled. Two instances would each
  hold their own duplicate-minute guard and could both post.
- `data/` holds the run log, authenticity pack, swipe file and analytics. Mount
  it on a persistent volume, or you lose duplicate-topic prevention and history
  on every redeploy.
- The dashboard builds to static files in `apps/dashboard/dist`.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `config_missing: GEMINI_API_KEY` | No key. Nothing runs without it. |
| `research.available: false` | Tavily key missing, timed out or returned nothing. The run continues on an evergreen idea. |
| `linkedin_unauthorized` (401) | Token invalid or expired. Re-run OAuth. |
| `linkedin_forbidden` (403) | Token is missing `w_member_social`, or the author URN is not the authenticated member. |
| `linkedin_conflict` (409) | LinkedIn thinks this is a duplicate. Check the profile before retrying. |
| `linkedin_rate_limited` (429) | Wait for the window. Do not retry in a loop. |
| `config_invalid` about the URN | `LINKEDIN_PERSON_URN` must start with `urn:li:person:`. |
| `gemini_quota` | Quota or rate limit. |
| Sheets error but a post id present | The post is live; only logging failed. Status is `partially_published`. |
| `quality_blocked` every time | Read `qualityReasons`. Common causes: an unconfigured CTA destination, a founder story with an empty authenticity pack, or a topic repeating a recent one. |
| Scheduler never fires | `SOCIAL_CONTENT_SCHEDULER_ENABLED` is not `true`, it is the weekend, or the process restarted past the minute. |

## Tests

```bash
npm test          # 200 tests
npm run typecheck # API (src and tests) and dashboard
```

Coverage includes the word-count and hook boundaries, banned phrasing, hashtag
and emoji detection, DM/comment-automation CTA blocking, missing LinkedIn
credentials, an invalid person URN, 401/403/409/429 handling, dry-run never
touching LinkedIn, explicit publish confirmation, optional-image failure staying
non-fatal, Sheets failure not hiding a publish, Monday-Friday scheduling with
weekend exclusion and duplicate-minute prevention, ICP relevance, signal and
point-of-view assignment, format rotation, calendar generation, duplicate-topic
prevention, authenticity attribution, swipe-file originality, analytics maths,
monthly recommendations, and a guard proving no Twitter/X or messaging endpoint
exists anywhere in the tree.

## Safety rules the code enforces

- Never guarantee a follower count.
- Never fabricate news, dates, companies, numbers, clients or testimonials.
- Never invent lived experience.
- Never promise a DM, a reply, a mention or keyword delivery.
- Never publish an image LinkedIn did not accept through its own upload.
- Never return `published` unless LinkedIn returned a post id.
- Never write a credential to a response, a log line or an error message.
