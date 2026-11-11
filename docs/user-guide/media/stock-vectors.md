# Vectors

**Vectors** (`/media/stock-vectors`) is a browse/search tool in the **Content Pack** section of
`/media`. It finds vector illustrations and lets you save a chosen result into your
[Media Library](../media-library). It is not a generation studio.

## Source catalogs

The free default catalog is **Pixabay**, gated by the operator environment variable
`PIXABAY_API_KEY`.

If your organization has an active [Content Pack](../settings) (Settings → Content → Content Packs) that declares `vectors` — currently
**Magnific**, **Vecteezy**, **Adobe Stock**, or **Envato Elements** — that premium catalog is shown
first. Otherwise Postmill falls back to Pixabay. A Content Pack daily-cap error is surfaced as a 402.

## Search and filters

- **Search** — debounced text search. An empty query browses Pixabay's vector catalog.
- **Orientation** — `horizontal` or `vertical`.
- **Color** — Pixabay's palette, including `grayscale`, `transparent`, black, white, gray, red,
  orange, yellow, green, turquoise, blue, lilac, pink, and brown.

Results are shown in a masonry grid, 20 items per page, with infinite scroll. Successful Pixabay
vector searches are cached for 24 hours; a failed request is cached for only 60 seconds.

## Result cards and preview

Each card shows the vector thumbnail, author credit, and source badge. The preview modal displays a
larger view, dimensions, author, and a "Powered by Pixabay" attribution line for free results.

## Preview actions

- **Open in Designer** — opens the vector on the [Designer](./designer) static canvas as an image
  layer.
- **Save to Files** — imports the preview file into `/files`. When Pixabay supplies the original
  SVG, the result points at that SVG; because `/files/import` rejects raw SVG, it is rasterized
  client-side to a 2048×2048 PNG and uploaded instead, so the saved file is a PNG. Content Pack
  assets always go through `/files/import`, which mints a licensed download URL from the item id. The Save to Files dialog
  lets you rename the file, pick or create a destination folder, and choose **Save File** or
  **Save & Post**.

Saved files carry `source` and `attribution` metadata, including rasterized SVG saves.

## Related docs

- [Media Studios](./index) — how stock browsers differ from generative studios.
- [Designer](./designer) — static canvas editor.
- [Media Library](../media-library) — `/files` folder tree and uploads.
- [Settings](../settings) — Content Pack configuration.

---

> Verified against v1.5.0
