# Fireworks AI

**Fireworks AI** (`/media/fireworks`) runs high-throughput open image models — including FLUX and Stable Diffusion XL — on Fireworks' inference-optimized infrastructure using your org's existing Fireworks AI key.

## Where to configure

Configure the Fireworks AI provider once under **Settings → AI**. Fireworks is a universal-credential provider, so the same API key serves both LLM and media generation; no separate **Settings → Media** entry is required. See [Settings](../settings) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Image** | Image | Model (FLUX schnell/dev FP8, SDXL), prompt, aspect ratio, steps, guidance scale, seed | PNG image(s) in `/files` |

## Generation flow

The studio calls Fireworks' workflow endpoint with `Accept: application/json` and receives base64-encoded images, which are decoded and saved to the [Media Library](../media-library). The Render Queue shows the result with **Edit in Designer** and **Post** options. See [Media Studios overview](./index) for the shared flow.

## Caveats

- **Image only.** Fireworks does not expose video or audio generation in this studio.
- Fireworks has no image-model catalog endpoint, so the model dropdown uses a curated list plus a free-entry field.
- Audio support was deprecated by Fireworks in mid-2026 and is not offered here.

## Related docs

- [Media Studios overview](./index) — shared render-queue and hand-off flow.
- [Media Library](../media-library) — where finished images are saved.
- [Settings](../settings) — configuring AI providers.

---
> Verified against v1.0.0
