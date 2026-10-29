# Recraft

**Recraft** (`/media/recraft`) is an AI design tool with visual taste. It is best known for generating editable vector/SVG graphics and icons alongside photoreal images, with reusable brand styles that need no training.

## Where to configure

Add your Recraft API key in **Settings → Content → AI Media → Recraft**. This is an own-key provider — there is no environment fallback.

See [Settings](../settings) for provider setup.

## Tabs

| Tab | Operation | Key fields | Output |
|---|---|---|---|
| **Text → Image** | Image | Model (Recraft V3/V2), prompt, style (realistic/vector/icon/etc.), size, number of images | Raster or vector image saved to `/files` |

## Generation flow

The studio follows the standard Studio Kit flow: fill the form, click **Generate**, track the job in the **Render Queue**, and open the finished image in the [Designer](./designer) or the composer. See [Media Studios overview](./index.md) for details.

Image generation is synchronous, so results usually appear immediately.

## Caveats

- **Image only** — Recraft does not generate video or audio.
- Choose **Vector illustration** or **Icon** in the **Style** field for SVG-style outputs.
- The visible form covers model, style, size, and image count; other native Recraft parameters (for example `substyle` or `response_format`) are not exposed in the studio.
- **Test connection is free** — Settings → Content → AI Media → **Test connection** reads your Recraft profile (`/users/me`); no image is billed.

---
> Verified against v1.4.0
