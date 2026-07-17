# Campaigns

Campaigns are org-scoped command centers for organising, planning, and reporting on a set of related social posts. A campaign groups posts together with goals, drafts, and a shareable report, and can tag related channels, files, brands, VPNs, AI providers, storage providers, post templates, and signatures.

## Creating a Campaign

1. Navigate to **Campaigns** (`/campaigns`).
2. Click **New Campaign**.
3. Fill in the details:
   - **Name** — a descriptive name (e.g. "Summer Product Launch").
   - **Date Range** (optional) — start and end dates.
   - **Color** — tints campaign cards in the schedule and the report header.
   - **Auto-append UTM tags** — when enabled, links in campaign posts receive `utm_campaign`, `utm_source`, and `utm_medium` before short-linking.
   - **Client / Project** (optional) — free-text labels for internal tracking.
   - **Tags** (optional) — a list of strings shown read-only on the dashboard header.
   - **Goals & Targets** (optional) — add targets for impressions, likes, comments, clicks, posts, or followers; progress appears on the dashboard.

Existing campaigns appear as cards with post count and engagement totals.

## Campaign Dashboard

Click a campaign card to open its dashboard at `/campaigns/:id`. The page is organised into a header, KPIs, an analytics section, a tabbed content area, and a team Discussion thread that is always visible below the tabs.

- **Header** — name, dates, status, colour, and actions (Edit, Copy, Archive, Delete, Export, Share).
- **KPIs** — total views, likes, comments, clicks, state counts, and goal-progress bars. The **Comments** KPI (and a `comments` goal) counts the campaign's synced, replyable comments — the same number shown in the Replies tab — not the platform-reported engagement total.
- **Analytics** — a trend chart plus a per-channel breakdown scoped to the campaign's posts. See [Campaign Analytics](#campaign-analytics) below.

### Tabbed sections

The dashboard has nine tabs:

- **Posts** — a table of all campaign posts with engagement.
- **Channels** — the deduplicated set of channels the campaign's posts publish to, plus explicitly tagged `INTEGRATION` items. Each channel shows its provider icon, name, and post count. Use the menu to **Add Channel** or **Invite Client**; connecting a channel from here automatically tags it to the campaign.
- **Files** — campaign-tagged files rendered in a `/files`-style grid. Upload new files directly into the campaign, preview them, remove the tag, open a file in the Designer, or start a new post draft preloaded with the file.
- **Post Templates** — tagged set/template items.
- **Post Drafts** — drafts with approval status and promote actions.
- **Tagged Items** — remaining entity types: brands, signatures, VPNs, LLMs, and storage providers. Channels, files, and templates have their own tabs and do not appear here.
- **Planning** — the planning workspace and draft-approval flow.
- **Replies** — synced comments across all campaign posts.
- **Activity** — a changelog of recent actions such as added tags, copies, approvals, and promotions.

## Campaign Analytics

The dashboard's **Analytics** section shows how the campaign is performing, scoped to the posts that belong to it:

- **Trend chart** — a headline metric over the campaign's date range.
- **Per-channel breakdown** — engagement split across the channels the campaign publishes to.

Campaign analytics are **post-scoped** — they aggregate only the campaign's posts, so channel-level metrics like followers (which belong to the channel, not the post) are not included. The default window is the campaign's start→end dates. The same trend and per-channel breakdown also appear on the [shareable public report](#reports-and-public-share) when analytics are available.

## Campaign Replies (Comments)

The dashboard's **Replies** tab is a full comment-management surface scoped to the campaign's posts — no need to open each post or the standalone inbox:

- **Filter** by status (All / Needs Reply / Handled / Ignored), by **channel**, by **assignee**, or to **unread only**.
- **Reply** inline (with optional AI draft), **like**, cycle a comment's **status**, **assign** it to a teammate, or **mark handled** — individually or in bulk via row selection.
- Each comment shows its author, channel badge, content, and the post it belongs to.

Replies are posted to the live platform, so a channel must support comment replies for the action to succeed.

## Discussion

Below the tabs, the **Discussion** section is an internal, team-only thread for talking *about* the campaign — separate from the platform **Replies** above (which sync from your social posts). Nothing here is ever published or shown on a public report.

- Write with a **rich-text editor**: bold, italic, underline, strike, headings, bullet/numbered lists, links, and emoji.
- **Embed media** — click the image button to pick a photo or video from your media library and drop it right into the note.
- **@mention** a teammate to notify them (respecting their notification preferences).
- **React** with emoji, **reply** to a note (one level of threading), **pin** an important note to the top, or **resolve** one to grey it out once it's handled.
- **Edit or delete** your own notes; each note shows the author, avatar, and how long ago it was posted (with an "edited" marker when changed).

## Planning Workspace and Draft Approval

Drafts created inside a campaign start with approval status **Pending**. A draft must be marked **Approved** before it can be promoted to the real publishing schedule:

- **Approve / Reject** per draft, or in bulk via row selection.
- **Promote** moves approved drafts from `DRAFT` to `QUEUE`. Promote a single draft from its row actions, or promote many selected drafts with the bulk **Promote Selected** button.
- Rejected drafts stay in the workspace and can be approved later.

## Copy / Clone a Campaign

Use **Copy** on the dashboard header or campaign card to clone a campaign:

- Choose a name for the clone.
- **Shift dates by +1 month** optionally moves the campaign dates and cloned draft publish dates.
- **Reset schedule** drafts the clones for "now" instead of shifting.
- The clone re-tags all non-post items and copies only **draft** posts; published or scheduled posts are not duplicated.

## Reports and Public Share

From the dashboard or `/campaigns/:id/report`:

- **Download CSV** or **Download PDF** (server-side rendered).
- **Share link** — enable a public, read-only report at `/public/campaign-report/:token`. The link exposes only campaign name/dates, KPIs, goals, post titles/content/metrics, channel breakdown, and tagged-item names — no credentials, config, or internal ids. Disable sharing at any time.

## Composer and Bulk Import

- The composer sidebar includes a **Campaign** dropdown. Assigning a post records `campaignId` on the post.
- Bulk import accepts a `campaign` column; rows with an invalid campaign value report a warning but do not block the import. See [Bulk Import](./bulk-import.md).

## Media and Comments Grouping

Campaign-aware filters derive through the post's `campaignId`: the [Media Library](./media-library.md) groups a campaign's uploads, and the dashboard's **Replies** tab manages replies for the campaign in one place (the standalone Comments Inbox covers all channels org-wide).

## Purging Old Tags

A daily cron (`campaign-tag-purge`) deletes a finished campaign's tagged items `CAMPAIGN_PURGE_DAYS` (default 30) after its `endDate`. Ongoing campaigns with no end date are never purged.

> Verified against v1.0.0
