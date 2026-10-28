# Bulk Import

The bulk import tool lets you schedule many posts at once by uploading a CSV file. Open it from the
**+** create menu → **Bulk Import**; it submits to `POST /posts/bulk`. Each row is created
independently, and the batch returns per-row results so individual failures don't block the rest.

## Data format

Bulk import accepts a CSV file (up to 5 MB) whose first line is a header row. Headers are matched
case-insensitively by name, so column order doesn't matter. Quoted fields may contain commas and
line breaks.

### Supported columns

| Column | Required | Description |
|--------|----------|-------------|
| `content` | Yes | The post body text. |
| `schedule_at` (or `date`) | Yes | Scheduled publish date and time as an ISO 8601 date string. |
| `channel` | Yes | One or more channels, separated by semicolons (e.g. `x;linkedin`). Each value is a channel ID or a provider identifier; a provider identifier matches your first connected channel of that provider. Up to 50 channels per row. |
| `media_url` | No | A public `https://` URL of one image or video. It is downloaded into your media library and attached to every channel post for that row. See [Media](#media) for limits. |
| `campaign_id` | No | ID of an existing campaign to assign the post to. |

A single request accepts up to 100 rows.

## Preview

After you pick a file, the tool shows a **Preview** table (content, channels, schedule) of the
parsed rows. A missing required header, an empty file, or a file with no data rows is reported
before anything is sent. Click **Import All** to submit.

## Media

When a row has a `media_url`, Postmill downloads the file once, saves it to your organisation's
media library (it appears there like any other upload), and attaches it to each of the row's posts.

- The URL must be `https://` and point to a public host — `http://`, private/internal addresses, and
  URLs that redirect to them are rejected.
- Supported types: images (JPEG, PNG, GIF, WebP, AVIF, BMP, TIFF) and video (MP4, WebM,
  QuickTime). Audio and other file types are rejected.
- Maximum size is 512 MB, and the file counts toward your organisation's storage quota.
- If the download fails for any reason (bad URL, the source returns an error, unsupported type, too
  large, quota exceeded), the **whole row fails** with an error starting "Could not import
  media_url" — no posts are created for it, so you never end up with posts silently missing their
  media.

## Campaign targeting

If you specify a `campaign_id` column, posts are assigned to that campaign during import. The
campaign must already exist in your Postmill organisation. See [Campaigns](./campaigns.md) for
creating and managing campaigns.

## Validation

Each row is checked as it is imported:

- **Date** — a scheduled date in the past fails the row ("Cannot schedule a post in the past").
- **Media** — a `media_url` that cannot be imported fails the row (see [Media](#media)).
- **Channels** — a channel that is not connected, or is disabled, is skipped with a warning; the
  row still succeeds for its other channels.
- **Channel rules** — each post is checked against the same per-channel rules the composer applies
  (required channel settings, each channel's media requirements, character
  limits). A post that breaks them is not created and is reported as a warning for that channel
  (e.g. `Failed to create post for "x": post is too long, please fix it`); the row still succeeds
  for its other channels. Because bulk import sends no channel-specific settings, channels that
  require them (for example a Pinterest board or a YouTube title) fail this check — schedule those
  from the composer.
- **Post quota** — when billing is enabled, the whole batch (rows × channels) is checked against
  your plan's monthly post limit before any row is created.

Rows that fail are reported but do *not* halt the import.

## Results view

After processing, the bulk import shows a per-row **Results** table:

| Result column | Meaning |
|---------------|---------|
| **Status** | **Success** or **Failed**. |
| **Details** | **Created**, or the warnings (e.g. a skipped channel or a channel-rule failure) and the error that failed the row. |

A row succeeds when at least one post was created for it. Failed rows are skipped entirely — fix
the issues, re-upload just those rows, and re-run.

## Batch integrity

The batch import does not use a database transaction across all rows. Each row is an independent
creation. This means:

- A failed row never prevents successful rows from being created.
- There is no rollback — if you need to remove successfully created posts from a partially failed
  batch, use the calendar to delete them individually.

## Usage tips

- **Test with a small batch first** — upload 3-5 rows to verify your columns and content format
  before importing hundreds.
- **Use the campaign column** for imports that are part of a campaign launch.
- **Pre-flight channels** — verify all target channels are connected and healthy before importing;
  unknown or disabled channels are skipped.
- **Date formats** — ISO 8601 (`2026-06-09T14:30:00Z`) is required. Include timezone offsets to
  avoid ambiguity.

> Verified against v1.4.0
