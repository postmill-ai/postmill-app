# Stock Audio

**Stock Audio** (`/media/stock-audio`) is a browse/search tool in the **Content Pack** section of
`/media`. It finds music and sound effects and lets you save a chosen track into your
[Media Library](../media-library). It is not a generation studio.

## Source catalogs

The free default catalog is **Jamendo**, gated by the operator environment variable
`JAMENDO_CLIENT_ID`.

If your organization has an active [Content Pack](../settings) that declares `audio` — currently
**Envato Elements** — that premium catalog is shown first. Otherwise Postmill falls back to Jamendo.
A Content Pack daily-cap error is surfaced as a 402.

## Search

- **Search** — debounced text search. An empty query sorts by total popularity.
- No genre, duration, or mood filters are exposed.

Results are shown as a list of playable rows, 20 tracks per page, with infinite scroll. Each row
includes the track name, author, an inline audio player, and a **Save** button.

## Save behavior

Jamendo returns two URLs: a streaming URL with an expiring token (used for the preview player) and a
stable `audiodownload` URL used for saving. When you save, Postmill imports the stable URL into
`/files`. The importer also sniffs the content type because Jamendo sometimes serves MP3s with a
`text/html` label.

In select mode (for example, picking audio for the Designer timeline), the row shows **Use** and
returns the streaming URL and track name.

## Content Pack tracks

For Envato Elements audio, a licensed preview URL is minted from the item id before import.

## Related docs

- [Media Studios](./index) — how stock browsers differ from generative studios.
- [Media Library](../media-library) — `/files` folder tree and uploads.
- [Settings](../settings) — Content Pack configuration.

---

> Verified against v1.0.0
