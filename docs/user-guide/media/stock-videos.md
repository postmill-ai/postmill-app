# Stock Videos

**Stock Videos** (`/media/stock-videos`) is a browse/search tool in the **Content Pack** section of
`/media`. It does not generate media; it lets you find a stock video clip and save it into your
[Media Library](../media-library).

## Source catalogs

The free default catalog is **Pexels**, gated by the operator environment variable `PEXELS_API_KEY`.

If your organization has an active [Content Pack](../settings) that declares `videos` — currently
**Magnific**, **Vecteezy**, **Adobe Stock**, or **Envato Elements** — that premium catalog is shown
first. Otherwise Postmill falls back to Pexels. A Content Pack daily-cap error is surfaced as a 402
instead of silently falling back.

## Search and filters

- **Search** — debounced text search. An empty query shows Pexels' popular videos.
- **Orientation** — `landscape`, `portrait`, or `square`.
- **Size** — `small`, `medium`, or `large`.
- **Color** — the same swatch palette used by Stock Photos.

Results are shown in an aspect-video grid, 15 clips per page, with infinite scroll. Each card
includes a duration badge.

## Result cards and preview

Clicking a card opens the preview modal with a playable video, dimensions, author, source badge,
and attribution.

## Preview actions

- **Open in Designer** — opens the video on the [Designer](./designer) video timeline so you can add
  captions, audio, or additional clips.
- **Save to Files** — imports the MP4 into `/files`. For Content Pack assets, a licensed download URL
  is minted from the item id before import.

Saved files carry `source` and `attribution` metadata.

## Related videos

The preview modal can show a **Related** row of similar Pexels videos; selecting one replaces the
current preview.

## Related docs

- [Media Studios](./index) — how stock browsers differ from generative studios.
- [Designer](./designer) — video timeline editor.
- [Media Library](../media-library) — `/files` folder tree and uploads.
- [Settings](../settings) — Content Pack configuration.

---

> Verified against v1.0.0
