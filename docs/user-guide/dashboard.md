# Dashboard

The **Dashboard** (`/dashboard`) is the post-login landing page. It is designed as a command center that answers "what needs my attention now?" first and shows performance second.

> Verified against v1.0.0

## Layout

The page is a single responsive column of cards:

1. **Daily Brief** — on-demand AI summary of yesterday's performance, today's schedule, and recommended next actions (collapsed by default; only visible when your org has an active AI provider).
2. **Setup Checklist** — for new orgs: connect AI, media, storage, channels, create a first post, invite a team member. Dismissed automatically when all steps are complete.
3. **Needs Attention** — priority feed of issues across your org.
4. **Next 7 Days** — a scrollable day-by-day schedule with gap-fill shortcuts.
5. **At a Glance** — KPI tiles (published, scheduled, engagement, unread replies, channels).
6. **7-Day Engagement** — a sparkline of your primary engagement metric.
7. **Inbox** — unread comments that need replies.
8. **Active Campaigns** — running campaigns with post-state counts and goal progress.
9. **Media Queue** — in-flight and recently failed AI-media jobs.
10. **Usage & Budget** — plan limits for posts, channels, and members, plus AI spend.
11. **Recommendations** — top analytics-driven actions from the Insights engine.

On desktop the cards sit in a 12-column grid; on mobile they stack in the same priority order.

## Customizing the dashboard

Click the **gear icon** in the header to show or hide sections. Your choices are saved in this browser's `localStorage` (`dashboard_prefs`), so they persist across reloads but are per-device for now.

Sections you do not have permission for are hidden automatically and do not appear in the Customize list.

## Attention feed

The feed groups signals into three severity levels:

- **Critical** — failed posts, channel health issues, budget overruns.
- **Warning** — pending draft approvals, unread comments, schedule gaps, failed media jobs, analytics anomalies.
- **Info** — anything else that needs a look.

Each row links to the relevant surface:

| Signal | Link |
|---|---|
| Failed posts | Posts list, with per-post **Retry** |
| Channel health | Settings → Channels |
| Pending approvals | Campaigns |
| Unread comments | Replies |
| Schedule gaps | Composer pre-filled for the gap day |
| Budget | Billing |
| Failed media jobs | Media |
| Analytics anomalies | Analytics → Insights |

When everything is healthy, the feed shows an **All clear** state.

## Daily Brief

The brief is generated on demand by clicking **Daily Brief** in the header. It is cached per org per calendar day (`dashboard:brief:{orgId}:{YYYY-MM-DD}`) so repeated clicks return the same result until midnight local time.

- Requires an active AI provider and the `analytics:read` permission.
- Generation checks the org's AI budget; if the cap is exceeded you will see a 429 message.
- If AI is not configured for your org, the brief card is hidden entirely.

## RBAC and data visibility

Dashboard data is filtered server-side by your effective permissions. If you do not have `billing:read`, the Usage & Budget widget receives no data; if you do not have `media:read`, the Media Queue is omitted. The frontend hides the matching cards so the layout never shows empty permission-gated holes.

## Related pages

- [Analytics](./analytics.md)
- [Campaigns](./campaigns.md)
- [Comment inbox](./social-comments.md)
- [Media library](./media-library.md)
