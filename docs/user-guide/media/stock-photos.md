# Stock Photos

**Stock Photos** (`/media/stock-photos`) is a browse/search tool in the **Content Pack** section of
`/media`. It does not generate media; it lets you find a photo and save it straight into your
[Media Library](../media-library).

## Source catalogs

The free default catalog is **Unsplash**, gated by the operator environment variable
`UNSPLASH_ACCESS_KEY`.

If your organization has an active [Content Pack](../settings) that declares `photos` — currently
**Magnific**, **Vecteezy**, **Adobe Stock**, or **Envato Elements** — that premium catalog is shown
first for the same search. If the pack is absent, does not cover photos, or errors, Postmill falls
back to Unsplash. A Content Pack daily-cap error is surfaced as a 402 instead of silently falling
back.

## Search and filters

- **Search** — debounced text search. An empty query shows Unsplash's curated `/photos` list.
- **Orientation** — `landscape`, `portrait`, or `squarish`.
- **Color** — a swatch palette (black & white, black, white, gray, red, orange, yellow, green, blue,
  purple, brown).

Results are shown in a masonry grid, 20 items per page, with infinite scroll.

## Result cards

Each card shows the photo thumbnail, author credit, and source badge. Clicking a card opens the
preview modal with a larger view, dimensions, author link, source, and any required attribution.

## Preview actions

- **Open in Designer** — opens the photo on the [Designer](./designer) static canvas, ready for
  cropping, text, or export.
- **Save to Files** — imports the photo into `/files` via `POST /files/import`. For Unsplash assets,
  this also triggers the required download-location ping back to `api.unsplash.com` using the
  deployment's access key. For Content Pack assets, Postmill first mints a licensed download URL
  from the item id and then imports the resulting file.

Saved files carry `source` and `attribution` metadata so the original creator stays traceable.

## Related photos

The preview modal for a photo can show a **Related** row of similar Unsplash photos; selecting one
replaces the current preview.

## Related docs

- [Media Studios](./index) — how stock browsers differ from generative studios.
- [Designer](./designer) — static canvas editor.
- [Media Library](../media-library) — `/files` folder tree and uploads.
- [Settings](../settings) — Content Pack configuration.

---

> Verified against v1.0.0
