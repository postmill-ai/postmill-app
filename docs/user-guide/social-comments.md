# Social Comments

The Social Comments system (v3.5.0) provides a unified inbox for managing comments from all your
connected social channels. Comments from supported platforms are synced periodically and available
for triage, reply, and assignment.

## Comment Sync

Comments are collected by a background Inngest function (`commentsCollection`). The backend must
have `USE_INNGEST=true` and valid Inngest Cloud credentials (or `INNGEST_DEV=1` for local
development). The function periodically fetches comments from each connected channel that supports
the comments capability and syncs them into the `SocialComment` table.

Comment data includes the comment text, author information, timestamp, and platform-specific
metadata. Per-user read state is tracked in the `PostCommentRead` table so each team member sees
their own unread count.

For operational setup details, see [Inngest and Cron](../operations-guide/inngest-and-cron.md).

## Unified Inbox (`/comments`)

The comments page provides a single view of all incoming comments across channels.

### Filters

Use the filter bar at the top of the inbox to narrow the view:

- **Status**: Filter by comment status (`open`, `in_progress`, `resolved`, `closed`, `spam`).
- **Assignee**: Show comments assigned to a specific team member.
- **Unread Only**: Show only comments you have not yet read.
- **Cursor Pagination**: Navigate through comment history with ISO 8601 cursor-based pagination.

### Comment Cards

Each comment card displays:

- **Author**: The commenter's name and avatar (when available from the platform).
- **Platform Icon**: The source channel (e.g., X, Facebook, LinkedIn).
- **Comment Text**: The full comment body.
- **Timestamp**: When the comment was posted (in your local timezone).
- **Status Badge**: Color-coded status indicator (open, in progress, resolved, closed, spam).
- **Sentiment/Priority Badge**: When AI sentiment analysis is enabled.
- **Unread Indicator**: A highlight for comments you haven't viewed.

### Bulk Mark-Read

Select multiple comments and click **Mark as Read** to clear them from your unread queue. The bulk
operation accepts up to 1,000 comment IDs per request.

### Quick Replies

Reply to a comment directly from the inbox. The reply is posted to the original platform (when the
provider supports it) and recorded in the comment thread. Supported platforms for replies are
those with `comments: true` in the provider capability matrix.

### Assignment

Assign comments to team members for triage:

- Click **Assign** on any comment card and select a team member.
- Set the assignee to `null` to unassign.
- Filter the inbox by assignee to see your assigned comments.

### Status Updates

Update the status of a comment as you triage it:

- **Open**: New, unreviewed comment.
- **In Progress**: Being worked on.
- **Resolved**: Addressed successfully.
- **Closed**: No longer needs attention.
- **Spam**: Marked as spam or irrelevant.

## Per-Post Comments in Post Detail

When viewing a post detail modal (from the schedule), the comments section is **capability-aware**:

- **Reply and Like actions** are only shown for providers that support them (`comments: true`).
- **Unread comments** are highlighted.
- **Mark as Read** marks all comments on that post as read for you.
- **Unread count** is available per post.

Providers with `comments: true`: X, LinkedIn, LinkedIn Page, Reddit, Instagram, Instagram
Standalone, Facebook Page, Threads, YouTube, TikTok, Discord, Slack, Mastodon, Bluesky, Telegram,
Medium, Dev.to, Hashnode, WordPress.

Providers **without** comments: Google My Business, Pinterest, Dribbble, Kick, Twitch, Lemmy,
Farcaster, Nostr, VK, ListMonk, Moltbook, Whop, Skool, MeWe, Tumblr, Pixelfed, PeerTube.

## First-Comment Auto-Post

When you include a first comment in the composer, Postmill automatically posts it after the main
post publishes successfully. This behavior is defined in the publish function v1.0.6:

1. The main post is published to the selected channels.
2. If a first comment is configured and the channel supports it (`firstComment: true`), the
   comment is posted immediately after.
3. **Idempotent**: The `firstCommentPostedAt` timestamp and `firstCommentId` are recorded in the
   post settings. If the workflow retries or replays, the first comment is not posted again.
4. **Non-fatal**: If the first comment fails, the main post remains published. You receive an
   in-app notification explaining the failure (e.g., "First comment could not be posted on X").

24 providers support first comments. See [Composer](./composer.md) for the full list and capability
gating details.

## AI Reply Drafting

If AI is configured for your organization, you can generate draft replies using AI. From the
comment card or the reply form, click the AI button to suggest a response based on the comment
context. You can review and edit the suggestion before posting.

For AI setup and configuration, see [AI Tools](./ai-tools.md).

## Schedule Integration

Schedule post cards display an unread comment badge (red circle, top-right corner) when a post
has comments you haven't read. The badge shows the count up to "99+." Clicking the card body opens
the post detail modal with the comments section.

See [Schedule](./calendar.md) for details on post cards and the post detail modal.

> Verified against v1.0.0
