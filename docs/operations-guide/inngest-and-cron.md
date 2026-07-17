# Inngest & Cron Jobs

Postmill uses **Inngest** as its durable job engine. Background jobs — analytics collection, comment sync, missing-post scanning, email delivery, media rendering, retention pruning, and watched-account probing — run as Inngest functions with retries, concurrency controls, and observability through the Inngest dashboard.

The backend (`apps/backend`) serves the Inngest handler at `/api/inngest`. Functions are registered from modules in `apps/backend/src/inngest/functions/` and triggered by cron schedules or events.

For local development you can use the **Inngest dev server** (`inngest-cli`) pointed at `http://localhost:3000/api/inngest`.

## Required environment variables

### For Inngest Cloud (production / hosted)

| Variable | Purpose |
|----------|---------|
| `INNGEST_EVENT_KEY` | Inngest event key for sending events |
| `INNGEST_SIGNING_KEY` | Primary signing key for validating requests |
| `INNGEST_SIGNING_KEY_FALLBACK` | Optional fallback key for rotation |
| `INNGEST_ENV` | Optional branch environment name |
| `INNGEST_SERVE_ORIGIN` | Public backend origin (e.g. `https://postmill.example.com`) |
| `INNGEST_SERVE_PATH` | Optional path override (default `/api/inngest`) |
| `USE_INNGEST` | Feature flag — set `true` to enable the cutover |

### For local dev server

```bash
INNGEST_DEV=1
INNGEST_BASE_URL=http://localhost:8288
```

No `INNGEST_EVENT_KEY` or `INNGEST_SIGNING_KEY` is required when `INNGEST_DEV=1`.

## Enabling background jobs

Inngest functions are scheduled by Inngest Cloud or the local dev server. Ensure:

1. `USE_INNGEST=true` is set.
2. Cloud credentials (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`) are set for non-dev deployments.
3. The backend is reachable on the public origin configured in `INNGEST_SERVE_ORIGIN`.
4. The Inngest app is registered with Inngest Cloud and pointed at `https://<your-origin>/api/inngest`.

Without this, the analytics dashboard, comment inbox, media render queue, and watchlist data will remain empty.

## Function inventory

### Cron-triggered functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `analytics-collection` | Daily at 02:00 UTC | Fans out one `analytics/sync-org` event per org |
| `comments-collection` | Every minute (sleeps `COMMENTS_SWEEP_INTERVAL_MINUTES` between sweeps) | Fans out one `comments/sync-org` event per org |
| `missing-post-finder` | Hourly | Detect posts that should have published but are stuck |
| `media-jobs-poll` | Every minute | Poll pending external media-generation jobs and re-enqueue stuck renders |
| `campaign-tag-purge` | Daily at 03:00 UTC | Delete `CampaignItem` tags for campaigns whose `endDate` is older than `CAMPAIGN_PURGE_DAYS` |
| `retention-purge` | Daily at 03:30 UTC | Bounded retention sweep for errors, notifications, multipart uploads, mastra traces, soft-deleted posts/files, AI Designer sessions, and IP/agent columns |
| `digest-email-daily` | Daily at 09:00 America/New_York | Fans out one `digest/send-one` event per target for daily digests |
| `digest-email-weekly` | Mondays at 09:00 America/New_York | Fans out one `digest/send-one` event per target for weekly digests |
| `agent-digest` | Mondays at 07:00 America/New_York | Fans out one `agent/digest-org` event per org (disabled unless `AGENT_DIGEST_ENABLED=true`) |

### Event-triggered functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `analytics-sync-org` | `analytics/sync-org` | Per-org channel/post snapshots, rollup/prune, anomaly detection, watched-account probes, short-link snapshots, weekly summary |
| `analytics-sync-integration` | `analytics/sync-integration` | Per-integration channel snapshot |
| `comments-sync-org` | `comments/sync-org` | Per-org comment sync, webhook dispatch, pruning, notifications |
| `post-publish-<queue>` | `post/publish` | Publish a post to one or more channels, including first comment, plugs, repeats, and webhooks. One function is generated per provider task queue |
| `autopost-process` | `autopost/process` | Recurring autopost schedules; re-enqueues itself every hour |
| `refresh-token` | `integration/refresh-token` | Refresh OAuth tokens before expiry; re-enqueues itself with a **unique** idempotency id per cycle (`refresh_<integrationId>_<uuid>`; a constant id would be dedup-dropped for 24h and black-hole the chain). Cancelled by `integration/refresh-token/cancel` (emitted on channel delete and before every (re)start). A chain terminates on channel deletion, when the integration is flagged `refreshNeeded`, or after 5 consecutive failed refresh cycles (5-minute sleep floor between retries) — bounding failure notifications per dead chain |
| `streak-tracker` | `streak/start` | Update posting-streak gamification and send reminders |
| `analytics-backfill` | `analytics/backfill` | On-demand historical backfill for one integration |
| `send-email` | `email/send` | Transactional email delivery (global 1/sec rate limit) |
| `digest-send-one` | `digest/send-one` | Send a single daily/weekly digest email |
| `agent-digest-org` | `agent/digest-org` | Generate and notify the weekly headless AI digest for one org |
| `media-render` | `media/render` | Local video render (Designer timeline + clip-merge), capped at `VIDEO_RENDER_CONCURRENCY` |
| `media-jobs-poll-job` | `media/poll-job` | Poll a single external media job |

## Retention and data lifecycle

### Analytics data

| Configuration | Default | Effect |
|---------------|---------|--------|
| Channel lookback | 7 days | Analytics sweep fetches 7 days of channel metrics per run |
| Post lookback | 30 days | Analytics sweep fetches 30 days of post metrics per run |
| `ANALYTICS_DAILY_RETENTION_DAYS` | 548 days (~18 months) | Daily `AnalyticsSnapshot` rows older than this are rolled into weekly rows |
| `ANALYTICS_POST_RETENTION_DAYS` | 90 days | `PostAnalyticsSnapshot` rows older than this are pruned |
| `ANALYTICS_ANOMALY_Z` | 3 | Z-score threshold for anomaly detection on fresh channel snapshots |
| `ANALYTICS_ANOMALY_COOLDOWN_DAYS` | 3 | Suppress repeat anomaly notifications for the same (channel, metric) |

Rollup behaviour:

- **Flow metrics** (likes, comments, views) — **summed** within each ISO week.
- **Stock metrics** (follower count, reach) — keep the **latest** value in the week.

### Comment data

| Configuration | Default | Effect |
|---------------|---------|--------|
| `POST_DAYS_BACK` | 30 days | Comments fetched for posts published within this window |
| `SOCIAL_COMMENT_RETENTION_DAYS` | 90 days | Comments soft-deleted after this age |
| `COMMENTS_SWEEP_INTERVAL_MINUTES` | 30 minutes | Interval between comment collection sweeps |

### Retention purge

| Configuration | Default | Effect |
|---------------|---------|--------|
| `ERRORS_RETENTION_DAYS` | 90 days | `Errors` rows hard-deleted |
| `NOTIFICATIONS_RETENTION_DAYS` | 180 days | Notifications and `NotificationRead` rows hard-deleted |
| `MULTIPART_UPLOAD_RETENTION_DAYS` | 7 days | Abandoned multipart uploads hard-deleted |
| `MASTRA_TRACE_RETENTION_DAYS` | 30 days | Mastra traces/scorers hard-deleted |
| `SOFT_DELETE_RETENTION_DAYS` | 30 days | Soft-deleted posts/files hard-purged |
| `AI_DESIGNER_SESSION_RETENTION_DAYS` | 90 days | AI Designer chat sessions hard-deleted |
| `IP_RETENTION_DAYS` | 90 days | `User`/`Session` IP and user agent nulled |

### Campaign tags

| Configuration | Default | Effect |
|---------------|---------|--------|
| `CAMPAIGN_PURGE_DAYS` | 30 days | `CampaignItem` tags purged after this many days past `endDate` |

## Local development

Start the Inngest dev server:

```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

The dev server UI is available at `http://localhost:8288`. Run the backend with `INNGEST_DEV=1` and `INNGEST_BASE_URL=http://localhost:8288`.

## Verifying jobs

In the Inngest dashboard (Cloud or local dev server) you should see scheduled runs for:

- `analytics-collection` — daily
- `comments-collection` — every minute (then sleeps 30 minutes)
- `missing-post-finder` — hourly
- `media-jobs-poll` — every minute
- `campaign-tag-purge` — daily
- `retention-purge` — daily
- `digest-email-daily` — daily
- `digest-email-weekly` — weekly
- `agent-digest` — weekly (only when enabled)

Event-triggered functions (`post-publish-*`, `autopost-process`, `refresh-token`, `streak-tracker`, `send-email`, `digest-send-one`, `analytics-backfill`, `media-render`, `media-jobs-poll-job`, `agent-digest-org`) appear as they are triggered.

If scheduled functions are not running, check that `USE_INNGEST=true` is set and that the backend `/api/inngest` endpoint returns HTTP 200.

## Agent digest

The weekly agent digest (`agent-digest` → `agent/digest-org`) is **disabled by default**.

| Variable | Purpose |
|----------|---------|
| `AGENT_DIGEST_ENABLED` | Set to `true` to enable the Monday 07:00 ET agent digest cron |

Behaviour:

- The main cron fans out one `agent/digest-org` event per organisation.
- The per-org handler (`concurrency: 2`) runs only if at least one organisation member has enabled the **Agent briefs** notification category in Settings → Notifications.
- The run is skipped if the organisation's AI budget is exhausted.
- The agent runs in **headless, read-only mode** (`access.mode: 'headless'`): it can only call analytics/comments/read tools and cannot schedule posts or create media jobs.
- A finished digest creates a thread and sends an in-app notification linking to `/agents/<threadId>`.

Enable in `.env`:

```bash
AGENT_DIGEST_ENABLED=true
```

> Verified against v1.0.0
