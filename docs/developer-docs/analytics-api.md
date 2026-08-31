# Analytics API

The Analytics API serves persisted multi-channel analytics from daily snapshots collected by the Inngest `analytics-collection` cron function.

There is one analytics surface: every route lives under `/public/v1/analytics/*` and is consumed by the dashboard (session cookie), integrators (API key), and MCP/OAuth clients (`pos_` tokens) alike, through the dual-auth public middleware. All endpoints are scoped to the org resolved from the credential or session. Public share report endpoints are unauthenticated and token-gated.

## Authorization

Three credential types reach the same routes:

| Credential | Presented as | Gates | Throttle |
|------------|--------------|-------|----------|
| API key (`pm_live_`) | `Authorization` header | No entitlement/RBAC gate — throttled read parity | 60/min per route |
| OAuth token (`pos_`) | `Authorization` header | No entitlement/RBAC gate — throttled read parity | 60/min per route |
| Dashboard session cookie | Cookie | RBAC + entitlement enforced; `x-csrf-token` required on mutations | App-route limits |

- **Cookie-authenticated reads** are org routes. `/narrate` additionally requires the `analytics:read` RBAC permission.
- **Cookie-authenticated mutating routes** (`POST /public/v1/analytics/share`, `DELETE /public/v1/analytics/share`, `POST /public/v1/analytics/alert-rules`, `PUT/DELETE /public/v1/analytics/alert-rules/:id`, `POST /public/v1/analytics/anomalies/:id/dismiss`, `POST /public/v1/analytics/refresh/:integrationId`, and all `/public/v1/analytics/watchlist*` writes) require the `analytics:update` RBAC permission and the `x-csrf-token` header.
- **API-key/OAuth callers** get throttled, ungated read parity (the pre-existing public posture). The RBAC permissions listed in the tables below apply to cookie-authenticated callers only.
- **Public read route** (`/public/analytics-report/:token`) is unauthenticated and token-gated.

## Date validation

All date-range endpoints validate:

- `from` and `to` are required (400 if missing).
- Both must be valid dates parsable by dayjs.
- `to` must be greater than or equal to `from`.
- The window is capped at **400 days**.

`integrations` is a comma-separated list of integration ids. `campaigns` is a comma-separated list of campaign UUIDs; malformed ids return 400.

## Overview

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/public/v1/analytics/overview` | Dashboard overview |

Params: `from`, `to`, `integrations?`, `compare?`, `campaigns?`

Returns aggregated metrics across all or filtered integrations for a date range with optional period-over-period comparison. Results are **cached in Redis for 60s** using key `analytics:overview:{orgId}:{sha256(JSON params)}`. No cache in dev mode.

## Channel analytics

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/public/v1/analytics/channel/:integrationId` | Single channel analytics |
| GET | `/public/v1/analytics/channel/:integrationId/metric/:metric` | Specific metric for a channel |

Params: `from`, `to`, `compare?`

Returns channel-level analytics with daily breakdowns. The metric detail variant returns data for a single metric (e.g. `views`, `likes`, `comments`) across the date range.

## Post analytics

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/public/v1/analytics/posts` | Paginated post list with metrics |
| GET | `/public/v1/analytics/post/:postId` | Single post detail |

Params (`posts`): `from`, `to`, `integrations?`, `campaigns?`, `sort?`, `dir?`, `page?`, `limit?`  
Params (`post`): `date?`

- **Posts list**: paginated list of posts with aggregated metrics. Sort by engagement, views, date, etc. Max 100 per page.
- **Post detail**: returns post KPI header plus daily metric breakdown. Has a **live fallback** — if no `PostAnalyticsSnapshot` exists for the post, it fetches from the live provider using the `checkPostAnalytics()` path.

## Metric and day detail

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/public/v1/analytics/metric/:metric` | Metric detail across date range |
| GET | `/public/v1/analytics/day` | Day-level detail |

Params (`metric`): `from`, `to`, `integrations?`, `compare?`, `campaigns?`  
Params (`day`): `date`, `metric`, `integrations`, `campaigns?`

The metric endpoint provides cross-channel detail for a single metric. The day endpoint provides a per-channel breakdown for one metric on one date.

## Insights

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/public/v1/analytics/best-time` | Best-time-to-post heatmap |
| GET | `/public/v1/analytics/recommendations` | AI-powered recommendations |
| GET | `/public/v1/analytics/content-insights` | Content-attribute intelligence |
| POST | `/public/v1/analytics/narrate` | LLM-narrated summary |

- **Best time**: `?integrations=&integration=&tz=` returns a structured day × hour engagement heatmap plus a list of `bestSlots`. Pass `tz` as an IANA timezone; without it, post dates are interpreted as UTC.
- **Recommendations**: returns prioritized actions (underperforming channels, top patterns, best-time opportunities, missing coverage, comment backlog), each deep-linking to the relevant view.
- **Content insights**: surfaces which post attributes are correlated with performance.
- **Narrate**: budget-gated (returns 429 if AI budget exceeded). Requires `analytics:read` for cookie callers. The no-provider rule is enforced in the service.

## Health and refresh

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/public/v1/analytics/health` | — | Data-health panel |
| POST | `/public/v1/analytics/refresh/:integrationId` | `analytics:update` | On-demand live channel refresh (~6/hour) |

## Export

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/public/v1/analytics/export` | CSV/JSON export |

Params: `from`, `to`, `integrations?`, `format?` (`csv` or `json`), `compare?`, `campaigns?`

Returns a file download with `Content-Disposition: attachment`.

## Short links

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/public/v1/analytics/shortlinks` | Short-link aggregate stats |
| GET | `/public/v1/analytics/shortlinks/timeseries` | Short-link click time series |

Both accept `from?` and `to?` and default to the last 30 days.

## Anomalies

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/public/v1/analytics/anomalies` | — | List detected anomalies |
| POST | `/public/v1/analytics/anomalies/:id/dismiss` | `analytics:update` | Dismiss an anomaly |

`GET /public/v1/analytics/anomalies` returns stored `AnalyticsAnomaly` rows with `integrationId`, `metric`, `date`, `value`, `baseline`, signed `deviation`, `direction` (`spike` | `drop`), and optional `topPostId`. `includeDismissed=true` includes already-dismissed rows.

## Alert rules

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/public/v1/analytics/alert-rules` | — | List user-defined alert rules |
| POST | `/public/v1/analytics/alert-rules` | `analytics:update` | Create a rule |
| PUT | `/public/v1/analytics/alert-rules/:id` | `analytics:update` | Update a rule |
| DELETE | `/public/v1/analytics/alert-rules/:id` | `analytics:update` | Delete a rule |

Rule body:

| Field | Type | Notes |
|-------|------|-------|
| `integrationId` | string? | cuid; omit for "all channels". |
| `metric` | string | Must be a known metric. |
| `comparator` | string | `gte`, `lte`, or `change_pct`. |
| `threshold` | number | 0 to 1,000,000,000. |
| `direction` | string? | `up` or `down`; required for `change_pct`. |
| `enabled` | boolean? | Defaults true. |

`gte`/`lte` compare the latest snapshot value against `threshold`. `change_pct` compares trailing-7-day sum vs prior-7-day sum and fires when the signed percentage change crosses `threshold` in the specified `direction`.

## Watchlist

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/public/v1/analytics/watchlist` | — | List watched accounts |
| POST | `/public/v1/analytics/watchlist` | `analytics:update` + competitors | Add account |
| GET | `/public/v1/analytics/watchlist/:id/series` | — | Watched-account series + own follower series |
| PUT | `/public/v1/analytics/watchlist/:id` | `analytics:update` | Update account |
| DELETE | `/public/v1/analytics/watchlist/:id` | `analytics:update` | Remove account |

Body (`POST`): `{ provider, handle, displayName? }` where `provider` is one of `twitter`, `linkedin`, `instagram`, `facebook`, `youtube`, `tiktok`.

Body (`PUT`): `{ displayName?, enabled? }`

Watched accounts have their public metrics probed during the analytics collection sweep. Probe failures (403/unsupported) auto-disable the capability and record `lastError` without crashing the sweep.

## Public share

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/public/v1/analytics/share` | cookie + `analytics:update` | Get current share token |
| POST | `/public/v1/analytics/share` | cookie + `analytics:update` | Mint or rotate share token |
| DELETE | `/public/v1/analytics/share` | cookie + `analytics:update` | Disable sharing |
| GET | `/public/analytics-report/:token` | none | Read-only public share report |

`POST /public/v1/analytics/share` body: `{ integrations?: string[], rangePreset?: '7d' | '30d' | '90d' }`.

`GET /public/analytics-report/:token` returns the org's public analytics report if sharing is enabled and the token is valid; otherwise `404`.

## Campaign analytics

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/campaigns/:id/analytics` | Campaign-scoped analytics (cookie-authed campaign hub) |
| GET | `/public/v1/analytics/campaign/:id` | Campaign-scoped analytics (unified surface) |

Params: `from?`, `to?` (default to the last 90 days, clamped to snapshot retention).

Campaign scoping runs only over `PostAnalyticsSnapshot` rows for posts belonging to the campaign. The live provider fallback is skipped, so a campaign view never fans out to live platform queries. Channel-level metrics (e.g. `followers`) are omitted.

Because `PostAnalyticsSnapshot.value` is a **cumulative lifetime level**, campaign totals are computed as `lastLevelInWindow − baseline(post)` per post, summed across posts. Series are per-day deltas. This makes a campaign KPI equal to the window delta, not the running total.

## Collection and anomaly pipeline

Analytics are collected by the Inngest `analytics-collection` cron function (`apps/backend/src/inngest/functions/analytics-collection.ts`, daily 02:00 UTC — requires `USE_INNGEST=true`). Each sweep runs snapshot collection, prune/rollup, and anomaly detection.

Anomaly detection (`AnalyticsActivity.detectAnomalies`):

1. Loads ~35 days of channel snapshots.
2. Per `(integration, metric)` series, tests the latest day against a trailing 28-day baseline (mean/σ).
3. Flow metrics test the raw value; stock metrics are day-over-day differenced first.
4. A point fires when both the z-test (`|z| ≥ ANALYTICS_ANOMALY_Z`) and an absolute per-kind floor pass.
5. Fired points are persisted idempotently on `(integrationId, metric, date)`.
6. Notifications are cooldown-deduped (`ANALYTICS_ANOMALY_COOLDOWN_DAYS`) and capped at **3 per org per day**, dispatched via `NotificationService.notifyAnalyticsAnomaly`.
7. Detection never throws; a failure logs and returns without failing the sweep.

### Backfill on connect

Connecting a new social channel emits an `analytics/backfill` Inngest event, gated on `isInngestEnabled()` (`USE_INNGEST=true`), so a fresh channel gets ~90 days of history immediately. The send is non-fatal.

### Rollup and retention

- Daily `AnalyticsSnapshot` rows older than `ANALYTICS_DAILY_RETENTION_DAYS` (default 548) are rolled into one weekly row per `(integration, metric, ISO week)`. Flow metrics are summed; stock metrics keep the week's latest.
- Daily `PostAnalyticsSnapshot` rows older than `ANALYTICS_POST_RETENTION_DAYS` (default 90) are pruned after weekly rollup. Because post-snapshot values are cumulative levels, weekly rows keep the week's latest level so read-time level-differencing works unchanged across the daily→weekly seam.

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `ANALYTICS_ANOMALY_Z` | `3` | z-score threshold for anomaly detection |
| `ANALYTICS_ANOMALY_COOLDOWN_DAYS` | `3` | Cooldown between anomaly notifications for the same `(channel, metric)` |
| `ANALYTICS_DAILY_RETENTION_DAYS` | `548` | Keep raw daily channel snapshots this long before weekly rollup |
| `ANALYTICS_POST_RETENTION_DAYS` | `90` | Prune per-post daily snapshots older than this |

> Verified against v1.0.0
