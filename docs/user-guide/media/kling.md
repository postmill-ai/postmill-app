# Kling AI

**Kling AI** (`/media/kling-ai`) is Postmill's direct integration with the official Kling AI API by Kuaishou. It is independent of the fal-hosted Kling models available in the [fal.ai studio](./fal).

The legacy `/media/kling` studio used the `fal` provider and now redirects to `/media/fal`. It did not use direct Kling AI credentials.

## Where to configure

Configure your official Kling AI credentials at **Settings → Media → Kling AI**. The provider card opens `/media/kling-ai`; it uses the preserved `kling` provider identifier and does not share the fal.ai API key.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Video** | `video` | Model, prompt, duration, aspect ratio, resolution, audio | A direct Kling video clip |
| **Image → Video** | `video` | First/last frame, model, prompt, duration, resolution, audio | A Kling clip animated from source frames |
| **Text → Image** | `image` | Model, prompt, negative prompt, aspect ratio, resolution, image count | A Kling image |

Video models include Kling 3.0 Turbo, 3.0, 2.6, and 2.5 Turbo. Image models include Kling V3 and V2.1.

## Generation flow

Video jobs are submitted to the official Kling API and tracked in the **Render Queue**. Completed media is saved to `/files` and can be opened in the [Designer](./designer) or posted directly. Kling AI is also registered as a compact generation provider in Designer picker dialogs.

## Related docs

- [fal.ai](./fal) — fal-hosted Kling, Pika, Flux, and Stable Audio models.
- [Media Studios](./index) — the shared generation flow.
- [Settings](../settings) — configuring direct Kling AI credentials.

---
> Verified against v1.3.0
