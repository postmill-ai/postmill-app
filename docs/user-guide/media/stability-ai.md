# Stability AI

**Stability AI** (`/media/stability-ai`) brings the Stable Image family of models into Postmill — open, enterprise-grade generative media for still-image creation. Its tagline is *“Open generative media for everyone.”*

## Where to configure

Configure your Stability AI API key under **Settings → Media**. This is an own-key provider; there is no environment-variable fallback. See [Settings](../settings) for credential setup.

## Tabs / operations

| Tab | Operation | Output | Key fields |
|---|---|---|---|
| **Text → Image** | Image | Still image | Prompt, engine (Stable Image Core / Ultra / SD3), aspect ratio, negative prompt, style preset, output format, seed. |

The **Engine** select chooses the Stable Image endpoint. Remaining parameters are native Stability API options and ride straight into the request body.

## Generation flow

Stable Image completes **synchronously**, so the generated image appears in the Render Queue almost immediately and is saved to `/files`. From the queue card you can open it in the [Designer](./index.md) or pre-fill a post. For the standard pick-source → generate → queue → hand-off flow, see [Media Studios overview](./index.md).

## Caveats

- The descriptor currently exposes only the **Text → Image** tab, even though the adapter also supports image-to-video and audio under the hood.
- **Style presets** are supported by Core and Ultra; selecting a preset with SD3 may be ignored by the provider.
- Output can be **PNG**, **JPEG**, or **WebP**.

## Related docs

- [Media Studios overview](./index)
- [Media Library](../media-library)
- [Settings](../settings)

---
> Verified against v1.0.0
