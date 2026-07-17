# Ideogram

**Ideogram** (`/media/ideogram`) is an image-only generation studio best known for accurate, legible text rendered inside images — useful for posters, ads, and social graphics.

## Where to configure

Configure an Ideogram API key under **Settings → Media → Ideogram**. This is an own-key provider and does **not** reuse an AI key. See [Settings](../settings) for credential setup.

## Tabs

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Image** | Image | Prompt, aspect ratio, rendering speed, style, magic prompt, negative prompt, number of images | Still image(s) |

## Generation flow

Ideogram follows the standard [Media Studios flow](./index.md): generate, watch the Render Queue, and the image lands in `/files`. From there it can be opened in the [Designer](./designer) or posted.

## Caveats

- **Image only, synchronous.** One POST returns hosted image URLs immediately; there is no video or audio surface and no background poll.
- **Api-Key header.** Ideogram authenticates with an `Api-Key` header, not a Bearer token.
- **Multipart form body.** Native parameters ride as form fields, including `style_type`, `rendering_speed`, and `magic_prompt`.
- The v3 endpoint has no model selector; the studio targets `ideogram-v3/generate` directly.

---
> Verified against v1.0.0
