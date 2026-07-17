# Recraft

**Recraft** (`/media/recraft`) is an AI design tool with visual taste. It is best known for generating editable vector/SVG graphics and icons alongside photoreal images, with reusable brand styles that need no training.

## Where to configure

Add your Recraft API key in **Settings → Media → Recraft**. This is an own-key provider — there is no environment fallback.

See [Settings](../settings) for provider setup.

## Tabs

| Tab | Operation | Key fields | Output |
|---|---|---|---|
| **Text → Image** | Image | Model (Recraft V3/V2), prompt, style (realistic/vector/icon/etc.), size, number of images | Raster or vector image saved to `/files` |

## Generation flow

The studio follows the standard Studio Kit flow: fill the form, click **Generate**, track the job in the **Render Queue**, and open the finished image in the [Designer](./index.md) or the composer. See [Media Studios overview](./index.md) for details.

Image generation is synchronous, so results usually appear immediately.

## Caveats

- **Image only** — Recraft does not generate video or audio.
- Choose **Vector illustration** or **Icon** in the **Style** field for SVG-style outputs.
- Extra native Recraft parameters (for example `substyle` or `response_format`) ride through automatically when supplied by the descriptor defaults; the visible form covers the common cases.

---
> Verified against v1.0.0
