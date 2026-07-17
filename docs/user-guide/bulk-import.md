# Bulk Import

The bulk import tool at `POST /posts/bulk` lets you schedule dozens or hundreds of posts at once
by uploading a CSV file or pasting data directly. Every row goes through the same preflight
validation as the composer, and the batch returns per-row results so individual failures don't
block the rest.

## Data format

Bulk import accepts a CSV file with columns that map to the post composer fields. The import
process includes a column mapping step so your CSV headers don't need to match exactly.

### Supported columns

| Column | Required | Description |
|--------|----------|-------------|
| `content` | Yes | The post body text. |
| `date` | Yes | Scheduled publish date and time (ISO 8601 or your locale's date format). |
| `time` | No (if date includes time) | Publish time if separate from date column. |
| `channels` | Yes | Channel identifiers, comma-separated (e.g. `x,linkedin,instagram`). |
| `firstComment` | No | Text for an auto-posted first comment (requires provider with `firstComment` capability). |
| `campaign` | No | Campaign name or ID to assign the post to (campaign must already exist). |
| `media` | No | URLs or paths to media files to attach. |

## Column mapping

After uploading your CSV, the bulk import interface presents a column mapping screen where you
match your CSV column headers to the expected Postmill fields. This allows flexibility in how your
CSV is structured — name your columns however your workflow dictates and line them up during
import.

## Campaign targeting

If you specify a `campaign` column, posts are assigned to that campaign during import. The
campaign must already exist in your Postmill organisation. Posts inherit the campaign for grouping
purposes in analytics, the media library, and the comment inbox. See [Campaigns](./campaigns.md)
for creating and managing campaigns.

## Preflight validation

Every row in the import runs through the same preflight check as the composer:

- Content length and format validation per selected channel.
- Provider capability checks — unsupported features (first comment on a channel that doesn't
  support it, polls where unsupported) produce warnings, not errors.
- Media validity — attachment URLs must be accessible and of a supported type.
- Channel availability — all specified channels must be connected and healthy for the
  organisation.
- Date validation — scheduled dates must be in the future.

Rows that fail preflight are marked with errors but do *not* halt the import. Rows with
capability mismatches or soft warnings are imported with warnings noted.

## Results view

After processing, the bulk import shows a per-row results table:

| Result column | Meaning |
|---------------|---------|
| **Row #** | Original CSV row number. |
| **Status** | `success`, `warning`, or `error`. |
| **Post ID** | The created post's ID (success rows only). |
| **Messages** | Human-readable details: what warning was triggered or why the row failed. |

Success rows have their posts created and scheduled. Warning rows are created but may have
soft issues (e.g. first comment not supported on one of the channels). Error rows are skipped
entirely — fix the issues, re-upload just those rows, and re-run.

## Batch integrity

The batch import does not use a database transaction across all rows. Each row is an independent
creation. This means:

- A failed row never prevents successful rows from being created.
- The response summarises total rows processed, succeeded, warned, and failed.
- There is no rollback — if you need to remove successfully created posts from a partially failed
  batch, use the calendar to delete them individually.

## Usage tips

- **Test with a small batch first** — upload 3-5 rows to verify your column mapping and content
  format before importing hundreds.
- **Use the campaign column** for imports that are part of a campaign launch. Grouping in
  analytics and comments is worth the extra column.
- **Pre-flight channels** — verify all target channels are connected and healthy (Settings →
  Channels → Connection Status) before importing.
- **Date formats** — ISO 8601 (`2026-06-09T14:30:00Z`) is the most reliable format. Include
  timezone offsets to avoid ambiguity.

> Verified against v1.0.0
