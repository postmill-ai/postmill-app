# Pika

**Pika** (`/media/pika`) supports Pika 2.2 text-to-video and image-to-video generation through Postmill's fal.ai integration.

## Where to configure

Pika's official API is hosted on **fal.ai**, so the studio uses your configured fal.ai connection and API key from **Settings → Content → AI Media → fal.ai**. There is no separate Pika provider card or Pika credential to configure, and the studio only appears in the `/media` sidebar once fal.ai is configured and enabled. The same models are also available in the canonical [fal.ai studio](./fal) (as the **Pika Text → Video** / **Pika Image → Video** tabs). See [Settings](../settings.md) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Output |
|---|---|---|---|
| **Text → Video** | Video | Prompt, negative prompt, aspect ratio (16:9, 9:16, 1:1, 4:5, 5:4, 3:2, 2:3), resolution (`720p`/`1080p`), duration (`5`/`10`s), optional seed | MP4 video clip |
| **Image → Video** | Video | Source image, prompt, negative prompt, resolution, duration, optional seed | MP4 video clip |

## Generation flow

Video jobs are submitted to the fal.ai queue and tracked in the **Render Queue**. When complete, the artifact is saved to `/files` and can be **Edited in Designer** or **Posted**. See [Media Studios overview](./index.md) for the shared flow.

## Caveats

- The studio uses the **fal.ai** key and queue infrastructure; Pika itself is identified by the full fal endpoint id (e.g. `fal-ai/pika/v2.2/text-to-video`).
- fal job ids are namespaced as `<model>::<request_id>::<poll base>` so the poll path can route back to the queue endpoint fal returned at submit time (older `<model>::<request_id>` ids are still understood).
- When your backend has a public HTTPS URL, fal.ai calls back on completion (`fal_webhook`); otherwise (and as a fallback) completions rely on the shared media-jobs poll cron.
- The `model` field is lifted out of `input` by the shared Studio Kit backend. Pika 2.2 durations are converted from the studio's string values to the numeric seconds required by fal; other native fal/Pika parameters ride through unchanged.

---
> Verified against v1.4.0
