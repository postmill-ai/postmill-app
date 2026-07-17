# Icons

**Icons** (`/media/stock-icons`) is a browse/search tool in the **Content Pack** section of `/media`.
It finds SVG icons and lets you save a chosen icon into your [Media Library](../media-library). It
is not a generation studio.

## Source catalogs

The free default catalog is **Iconify**, which uses a public API and requires no operator key.

If your organization has an active [Content Pack](../settings) that declares `icons` — currently
**Magnific** — that premium catalog is shown first. Otherwise Postmill falls back to Iconify. A
Content Pack daily-cap error is surfaced as a 402.

## Search

- **Search** — debounced text search. Iconify requires a non-empty query, so an empty query shows an
  empty state instead of errors.
- No orientation, size, or color filters are exposed.

Results are shown in a grid, 32 icons per page, with infinite scroll. Icons are rendered using a
theme-aware mask so they remain visible in both light and dark modes.

## Result cards and preview

Each card shows the icon, its set prefix, and author/set credit. The preview modal displays a larger
icon preview, dimensions, author, source badge, and the per-set license. CC-BY licenses are flagged
with **Attribution required**.

## Preview actions

- **Open in Designer** — opens the SVG on the [Designer](./designer) static canvas.
- **Save to Files** — `/files/import` rejects raw SVG for security reasons, so the icon is
  rasterized client-side to a 512×512 PNG before being uploaded. The saved file is a PNG, not an
  SVG.

Saved files carry `source` and `attribution` metadata.

## Related docs

- [Media Studios](./index) — how stock browsers differ from generative studios.
- [Designer](./designer) — static canvas editor.
- [Media Library](../media-library) — `/files` folder tree and uploads.
- [Settings](../settings) — Content Pack configuration.

---

> Verified against v1.0.0
