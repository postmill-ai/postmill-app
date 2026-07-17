# Composer

The composer is Postmill's post creation and scheduling interface. It supports multi-channel
publishing with platform-specific editing, media attachment, polls, first comments, short links,
per-channel overrides, and a preflight validation panel.

## Opening the Composer

The composer lives on dedicated pages:

- **`/posts/post`** — create a new post. From the **Posts** page (`/posts`), the
  **New Post** button navigates here; clicking a calendar slot prefills the slot's date and time
  (in your timezone).
- **`/posts/post/<post-id>`** — edit an existing post. The edit action on a calendar card
  opens this page.

Create and edit share the same composer form.

## Channel Multi-Select

The top section lists all channels you have connected. Select one or more channels to publish
across multiple platforms simultaneously. Each selected channel shows its icon in the multi-select
bar. The 36 supported providers are:

X, LinkedIn, LinkedIn Page, Reddit, Instagram Business, Instagram Standalone, Facebook Page,
Threads, YouTube, Google My Business, TikTok, Pinterest, Dribbble, Discord, Slack, Kick, Twitch,
Mastodon, Bluesky, Lemmy, Farcaster, Telegram, Nostr, VK, Medium, Dev.to, Hashnode, WordPress,
ListMonk, Moltbook, Whop, Skool, MeWe, Tumblr, Pixelfed, PeerTube.

## Text Editor

The main text area accepts rich content. Each provider defines its editor type — most use the
`normal` editor, which supports plain text with optional AI generation. The editor adapts to each
platform's content model:

- **Short-form platforms** (X, Bluesky, Mastodon) show character counts and enforce per-platform
  limits.
- **Long-form platforms** (LinkedIn, Medium, Dev.to, Hashnode, WordPress) provide full rich-text
  editing.
- **Chat platforms** (Discord, Slack, Telegram) strip HTML to plain text on publish.

AI tools are integrated into the composer toolbar — see [AI Tools](./ai-tools.md) for details on
generation, linting, and hashtag suggestions.

## Media Attachment

Drag and drop files into the upload area, or click to browse your media library. Postmill
validates:

- **Max media count per platform**: Ranges from 0 (text-only platforms like Kick, Twitch, Nostr)
  to 20 (LinkedIn).
- **File format compatibility**: Video support varies by platform — consult the
  [Supported Channels](./supported-channels.md) matrix.
- **File size limits**: Enforced per platform.

Each attached media item shows a preview thumbnail with a remove button.

## Scheduling

### Date/Time Picker

Select a date and time for publication. The picker uses a calendar widget and time dropdown.
The time is displayed and edited **in your timezone** and saved as UTC (the picker is
timezone-aware end-to-end, including dates prefilled from a calendar slot).

### Brand Picker

If your organisation has [brands](./settings.md#brands-tab) configured, a brand picker in the
composer selects which brand voice AI generation uses for this post. Leaving it unset uses the
organisation's default brand.

### Scheduling Options

- **Publish Now**: Sends the post immediately.
- **Schedule**: Queues the post for the selected date/time.
- **Save as Draft**: Saves the post without scheduling it.

## Per-Channel Overrides

By default, the composer edits content in **Global** mode: one text and media set is applied to all
selected channels. Switch a channel to **Internal** mode to write channel-specific content and
attach channel-specific media. This is useful when a platform needs a different caption, image
crop, or media count.

- Select a channel from the channel bar to edit its internal version.
- Deselecting a channel discards its internal customisations.
- In edit mode, existing per-channel content is loaded into the internal values for that channel.

## First Comment

The first-comment feature auto-posts an additional comment immediately after the main post is
published. This is commonly used for:

- X/Twitter: Posting a follow-up thread or link in the first reply.
- LinkedIn: Adding a call-to-action comment.
- Threads/Bluesky: Appending context that exceeded the character limit.

### Capability Gating

The first-comment textarea only appears when all selected channels support the feature.

### Behavior

- **Idempotent**: Once a first comment is posted, the `firstCommentPostedAt` timestamp is
  recorded. Retries or workflow replays will not double-post.
- **Non-fatal**: If the first comment fails to post, the main post remains published. You receive
  an in-app notification about the failure.
- The first comment is posted only after the main post publishes successfully.

## Polls

Poll posts are supported on three providers: **X**, **LinkedIn**, and **LinkedIn Page**.

### Creating a Poll

When all selected channels support polls, the poll options panel appears below the text editor:

- **Options**: Enter 2 to 4 poll choices. Each option field has a character limit enforced by the
  platform.
- **Duration**: Set how long the poll stays open (e.g., 1 day, 3 days, 7 days).

### Validation

Polls are validated both client-side (in the preflight panel) and server-side before publishing.
Validation checks:

- Minimum 2 options, maximum 4 options.
- Option length within platform limits.
- Duration within allowed range.

If a poll is requested but a selected channel does not support it, the preflight panel shows a
blocker and the post cannot be published to that channel.

## Short Links

A footer pill controls whether URLs in the post are shortened:

- **No short links** — URLs are published unchanged.
- **Active provider** — if your org has a configured short-link provider, selecting it shortens
  links in the published post and activates that provider org-wide. The pill shows the provider
  name or custom domain.
- **Connect short-link** — if no provider is configured, the pill is a shortcut to
  [Settings → Shortlinks](./settings.md#shortlinks-tab).

The short-link choice is applied per post in the composer. No global ASK/YES/NO preference is
stored in Settings.

## Preflight Panel

Before publishing, the preflight panel runs validation checks across all selected channels. Checks
are categorized as **warnings** (informational, does not block publishing) or **blockers**
(publishing is prevented until resolved).

### Character Limits

Each platform has a character limit. The preflight panel shows:
- Current character count per channel
- Whether the content exceeds the limit
- The excess amount if over the limit

### Alt Text

Alt text is supported on platforms with `altText: true`: Slack, Mastodon, Bluesky, Tumblr, and
Pixelfed. The preflight panel warns if you attach images to these platforms without providing alt
text. You can add alt text per image in the media attachment section.

### Media Format Compatibility

Channels that do not support video (`video: false`) show a warning if a video is attached. The
preflight panel lists which channels accept each media type.

### Link Validation

URLs in post content are validated for reachability. Broken links generate a warning.

### AI Compliance Checks

If AI governance is configured, the preflight panel runs compliance checks on AI-generated
content, flagging potential issues with brand guidelines, prohibited keywords, or content policy
violations.

## Unsupported Controls

Controls that are not supported by all selected channels are hidden. For example:

- If you select X (supports polls) and LinkedIn (supports polls), the poll panel is visible.
- If you also select Facebook (does not support polls), the poll panel is hidden and the preflight
  panel notes the incompatibility.
- The first-comment textarea and poll options follow the same capability-gating logic.

For the full capability matrix, see [Supported Channels](./supported-channels.md).

## Bulk Import

You can import multiple posts at once via CSV. The bulk import flow uses the same preflight
validation as the composer — each row is validated individually, and per-row successes, warnings,
and errors are reported. Failed rows do not block successful rows. See [Bulk Import](./bulk-import.md)
for details.

> Verified against v1.0.0
