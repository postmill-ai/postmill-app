# Calendar & Posts

The Calendar & Posts page (`/posts`) is your primary workspace for viewing, managing, and scheduling
social media posts. It provides a visual timeline of all your content across channels.

## Views

The schedule supports three view modes, toggled from the view selector in the toolbar:

### Month View

A traditional month grid. Each day cell shows up to 3 post cards with the channel icon and a
content preview. Days with more posts display a "+N more" indicator. Navigate between months with
the arrow buttons or jump to a specific month via the date picker.

### Week View

A horizontal week layout with time-of-day columns. Posts are positioned vertically according to
their scheduled time, giving you a clear picture of publishing density throughout each day. Drag
posts vertically to reschedule them within the day.

### Day View

A single-day detailed view showing all posts scheduled for that day. Posts are listed in
chronological order with full content previews. The day view is ideal for reviewing the day's
publishing plan at a glance.

## Navigation

- **Date picker** in the toolbar jumps to any past or future date.
- **Today button** returns to the current date.
- **Arrow buttons** move forward/backward by one unit (month, week, or day depending on active
  view).
- **Channel filter** narrows the schedule to show posts for specific channels.

## Card Anatomy

Each post card on the schedule provides at-a-glance information:

### Status Pill

A color-coded pill at the top of the card shows the post's current state:

- **Scheduled** (blue): The post is queued and will publish at the scheduled time.
- **Published** (green): The post has been successfully published.
- **Draft** (amber): The post is saved as a draft and not yet scheduled.
- **Error** (red ring): The post failed to publish. An error badge with a "!" icon appears; hover
  to see the error message.
- **Unread comments** (red badge, top-right): Shows the count of unread social comments on this
  post.

### Content Preview

The body of the card displays a truncated one-line preview of the post content. HTML formatting is
stripped for readability. Posts with no content show "no content."

### Channel Indicator

The top-left of the card body shows the channel icon (e.g., X logo, LinkedIn logo) and the
platform provider icon overlay, so you can identify the target platform at a glance.

### Stats Footer

Published posts display a footer row with performance metrics:

- **Views** (eye icon)
- **Likes** (heart icon)
- **Comments** (speech bubble icon)

Numbers are formatted compactly (e.g., 1.2K, 3.4M). Metrics are sourced from
`PostAnalyticsSnapshot` when available; if no snapshot exists yet (e.g., a just-published post), a
live-fallback enrich provides the latest data from the platform.

Card stats (views/likes/comments) populate from collected analytics snapshots; for very recent
posts or instances without background jobs configured, stats are fetched live on a best-effort
basis and may lag.

### Post Time

In day and week views, the post's scheduled time is shown on the right side of the card in your
local timezone (12h or 24h format depending on your locale).

### Hover Actions

Hovering over the card's top strip reveals action icons:

- **Edit** (gear icon): Opens the post edit page at `/posts/post/<post-id>`
- **Copy Debug JSON**: Copies post data for debugging (admin feature)
- **Duplicate**: Creates a copy of the post
- **Preview**: Opens a live preview of how the post renders
- **Statistics**: Links to the published post on the platform
- **Delete**: Removes the post from the schedule

## Post Detail Modal

Clicking the **card body** (not the top strip) opens the post detail modal, which provides a
comprehensive view of a single post:

### KPI Header

The header displays key performance indicators sourced from `/analytics/v2/post/:postId`:

- Total views, likes, and comments across all channels
- Per-channel breakdown
- Engagement rate

If no analytics snapshot exists for the post (e.g., it was just published), the system falls back
to live platform data where available.

### Full Post Thread

The modal displays the complete post content and any threaded replies using `getPostsRecursively`.
This is especially useful for X/Twitter threads, Reddit text posts, or multi-part content.

### Comments Section

A comments panel shows social comments received on the post, with reply and like actions available
for platforms that support them. Unread comments are highlighted. See [Social Comments](./social-comments.md) for
details on the unified comments inbox.

## Timezone Handling

All dates and times in the schedule respect the timezone configured in your **Settings →
Profile**. The `timezones-list` library provides the list of available timezones, and the Day.js
timezone plugin handles all conversions. When you schedule a post for "9:00 AM," it means 9:00 AM
in your configured timezone.

When viewing the schedule, the grid displays dates in your local timezone. The current time
indicator (a red line in week/day views) also follows your timezone. Clicking an empty calendar
slot opens the create-post page (`/posts/post`) with the slot's date and time prefilled in
your timezone; the post is saved in UTC.

> Verified against v1.0.0
