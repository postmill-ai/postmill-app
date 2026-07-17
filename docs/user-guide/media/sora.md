# Sora

**Sora** (`/media/sora`) is OpenAI's flagship text-to-video model. Sora 2 produces realistic, physically accurate video with synchronized dialogue and sound effects from a simple text prompt, and can animate a source image into video.

## Where to configure

Sora rides the OpenAI provider, so it reuses the OpenAI key configured in **Settings → AI** or **Settings → Media**. No separate Sora credential is needed.

See [Settings](../settings) for provider setup.

## Tabs

| Tab | Operation | Key fields | Output |
|---|---|---|---|
| **Text → Video** | Video | Prompt, model (Sora 2 / Sora 2 Pro), resolution, duration | Video clip |
| **Image → Video** | Video | Source image, prompt, model, resolution, duration | Video clip |

## Generation flow

The studio follows the standard Studio Kit flow: fill the form, click **Generate**, track the job in the **Render Queue**, and open the finished video in the [Designer](./index.md) or the composer. See [Media Studios overview](./index.md) for details.

## Caveats

- **Async only** — Sora uses OpenAI's async Videos API without a webhook, so completion is driven by the media-jobs poll cron.
- The finished MP4 is auth-only and is downloaded server-side as a data URL; there is no public download link.
- Videos are capped at 512 MB; larger renders fail before buffering.
- Image-to-video uploads the source frame as a multipart file.

---
> Verified against v1.0.0
