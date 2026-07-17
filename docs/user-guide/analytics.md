# Analytics

The Analytics dashboard (`/analytics`) provides multi-channel performance metrics, powered by daily
snapshots collected from all connected channels. It replaces the legacy single-channel analytics
with a unified, filterable dashboard.

## Data Population

Analytics data is collected by a background Inngest function (`analyticsCollection`).
The backend must have `USE_INNGEST=true` and valid Inngest Cloud credentials (or `INNGEST_DEV=1`
for local development). The sweep runs once per day, gathering metrics for all connected channels
and storing them as `AnalyticsSnapshot` and `PostAnalyticsSnapshot` records.

Snapshot freshness follows a 24-hour cycle. Data for "today" may be incomplete until the next
sweep.

For setup and operational details, see [Inngest and Cron](../operations-guide/inngest-and-cron.md).
For the underlying API endpoints, see [Analytics API](../developer-docs/analytics-api.md).

## Dashboard Tabs

The analytics page has six tabs, accessible from the tab bar at the top: **Overview**, **Channels**,
**Posts**, **Insights**, **Links**, and **Watchlist**. (Older `?tab=best-time` and
`?tab=recommendations` deep links still work — they now resolve to the Insights tab, scrolled to the
matching section.)

### 1. Overview

The landing tab shows high-level KPIs for your organization:

- **KPI Cards**: Total followers, total engagement, and total posts published in the selected
  period.
- **Period-over-Period Comparison**: Percentage change compared to the previous period of equal
  length (e.g., last 30 days vs. the 30 days before that). Displayed as a green up arrow or red
  down arrow next to each KPI.
- **Anomaly Alerts strip**: When the daily sweep detects an unusual spike or drop, a strip appears
  at the top of the Overview highlighting the affected channel and metric (see
  [Anomaly alerts](#anomaly-alerts) below).
- **Engagement Chart**: A time-series line chart showing engagement (likes + comments + shares)
  over the selected date range.
- **Channel Distribution**: A breakdown of posts and engagement by channel.

Use the date range selector, channel filter, and campaign filter at the top to narrow the view (see
[Filters](#filters)). Overview data is cached in Redis for 60 seconds when the end date is not today.

### 2. Channels

A per-channel breakdown showing:

- **Channel List**: Each connected channel with current follower count, posts this period, and
  engagement total.
- **Slide-Out Detail Panel**: Click a channel to open a detailed view with per-metric time-series
  charts (followers over time, engagement over time, posts per day).

### 3. Posts

A sortable, filterable table of individual posts:

- **Metric Column Picker**: Choose which metrics to display as columns (views, likes, comments,
  shares, clicks).
- **Time-Series Charts**: Toggle a chart view for any post to see its metrics over time.
- **Sorting**: Sort by any metric column or by publish date, ascending or descending.
- **Pagination**: 20 posts per page (configurable, up to 100).

### 4. Insights

The Insights tab merges the former Best time and Recommendations tabs with a new Alerts section into
one place (the old kebab overflow menu is gone). It has three sections:

**Best time** — a day-by-hour heatmap showing when your audience engages most:

- **Heatmap Grid**: Days of the week (rows) vs. hours of the day (columns). Darker cells indicate
  higher average engagement.
- **Best Slots List**: A ranked list of the top time slots (day + hour) with their average
  engagement values.

Use this data to schedule posts during peak engagement windows.

**Recommendations** — action cards that analyze your analytics and suggest improvements:

- **Underperforming Channels**: Channels with declining engagement, with a link to review their
  recent posts.
- **Top Patterns**: Content patterns (post type, time of day, media usage) correlated with high
  engagement.
- **Best-Time Opportunities**: Time slots where your audience is active but you are not publishing.
- **Missing Coverage**: Days of the week or hours where you have no scheduled posts.
- **Comment Backlog**: Channels with unanswered comments, with a link to the comments inbox.

Each card includes a deep link to the relevant view (e.g., clicking "Comment Backlog" opens the
comments inbox filtered to that channel).

**Alerts** — the list of detected anomalies (spikes and drops) with the ability to dismiss each one.
See [Anomaly alerts](#anomaly-alerts).

### 5. Links

Short-link click analytics for the org's active short-link provider — total clicks and a click
time-series per shortened link. Empty when no short-link provider is configured (see
[Settings → Shortlinks](settings.md)).

### 6. Watchlist

Competitor tracking, integrated into the dashboard as a tab. Watched accounts are probed during the
daily sweep and their public metrics appear alongside your own channels. See
[Watchlist](watchlist.md) for setup and configuration.

## Filters

The filter bar at the top of the dashboard narrows every tab at once:

- **Date range** — pick the period to analyze.
- **Channels** — restrict to one or more connected channels (empty = all).
- **Campaign** — scope the dashboard to a single campaign's posts. This is a true server-side
  scope: metrics are aggregated only from the posts that belong to the selected campaign.

  When a campaign is selected, a **"Post metrics only"** banner appears — channel-level metrics
  such as followers are not campaign-scoped (they belong to the channel, not the post), so only
  post-attributable metrics (views, likes, comments, shares, clicks) reflect the campaign filter.

## Anomaly alerts

Each daily sweep runs anomaly detection over your channel snapshots. For every
`(channel, metric)` series it compares the latest day against a trailing 28-day baseline (mean and
standard deviation); a point is flagged only when it clears both a z-score threshold **and** an
absolute floor, so low-volume channels do not fire on tiny wobbles. Flagged points are stored and
surfaced in two places:

- The **Overview alerts strip** (a summary of recent spikes/drops).
- The **Insights → Alerts** section (the full list; each alert can be dismissed).

Anomalies also generate notifications under the **Analytics alerts** category. You can toggle this
category per channel (email / push / in-app) at **Settings → Notifications** — email and in-app are
on by default. Notifications are cooldown-deduped and capped at three per organization per day so a
noisy day cannot flood your inbox.

## Export

Download analytics data for external reporting via the **Export** button on the dashboard:

- **Format**: Choose CSV or JSON.
- **Date Range**: Select the period to export.
- **Channel Filter**: Export data for specific channels or all channels.
- **Comparison**: Include period-over-period comparison data (`compare=true`).

The export returns a downloadable file with the appropriate content type and filename
(`analytics-export.csv` or `analytics-export.json`).

## Legacy Fallback

Analytics are primarily sourced from `AnalyticsSnapshot` and `PostAnalyticsSnapshot` tables.
However, for posts or channels that do not yet have snapshots, Postmill falls back to live
platform queries through the provider integration layer. This ensures you always see the most
current available data.

## Watchlist

Competitor tracking integrates with the analytics dashboard. Watched accounts are probed during
the analytics collection sweep, and their metrics appear in the analytics views alongside your own
channel data. Watched-account metrics also appear in the **Insights → Recommendations** section,
compared against channel performance for competitive insights. See [Watchlist](watchlist.md) for
setup and configuration.

> Verified against v1.0.0
