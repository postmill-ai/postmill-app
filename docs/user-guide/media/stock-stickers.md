# Stickers

**Stickers** (`/media/stock-stickers`) is a browse/search tool in the **Content Pack** section of
`/media`. It searches animated and static stickers and lets you save a chosen result into your
[Media Library](../media-library). It is not a generation studio and has no render queue.

## Source catalog

The catalog is **GIPHY**, gated by the operator environment variable `GIPHY_API_KEY`. GIPHY's Terms
of Service require the "Powered by GIPHY" attribution, which is shown at the bottom of the results.

Content Packs currently do not cover stickers, so this browser always uses GIPHY.

## Search

- **Search** — debounced text search. An empty query shows GIPHY's trending stickers.
- No orientation, size, or color filters are exposed.

Results are shown in a square grid, 20 items per page, with infinite scroll. Animated stickers that
provide an MP4 fallback are marked with a **GIF** badge.

## Result cards and preview

Each card shows the sticker preview and author credit. Clicking a card opens the preview modal.

## Preview actions

- **Save & Post** — because the [Designer](./designer) flattens animation to frame 1, stickers are
  imported into `/files` and then opened directly in the composer pre-attached to a new post. This
  preserves the animation through publishing.
- **Save to Files** — imports the sticker into `/files` for later use.

When a sticker is selected through a media picker, it returns as `image` by default, or as `video`
when an MP4 fallback is available.

## Related docs

- [Media Studios](./index) — how stock browsers differ from generative studios.
- [Media Library](../media-library) — `/files` folder tree and uploads.
- [Settings](../settings) — general media settings.

---

> Verified against v1.0.0
