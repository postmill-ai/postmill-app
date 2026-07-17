# Pika

**Pika** (`/media/pika`) is a playful AI video platform best known for **Pikaffects**, one-tap surreal effects that transform a photo into shareable video. It also supports standard text-to-video and image-to-video generation.

## Where to configure

Pika's official API is hosted on **fal.ai**, so the studio rides the fal adapter. Configure your fal.ai API key in **Settings → Media**. See [Settings](../settings.md) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Output |
|---|---|---|---|
| **Text → Video** | Video | Prompt, negative prompt, aspect ratio, resolution (`720p`/`1080p`), duration (`5`/`10`s), optional seed | MP4 video clip |
| **Image → Video** | Video | Source image, prompt, negative prompt, resolution, duration, optional seed | MP4 video clip |
| **Pikaffects** | Video | Source image, effect (e.g. `Cake-ify`, `Melt`, `Inflate`), optional prompt, optional seed | MP4 video with the chosen one-click VFX |

## Generation flow

Video jobs are submitted to the fal.ai queue and tracked in the **Render Queue**. When complete, the artifact is saved to `/files` and can be **Edited in Designer** or **Posted**. See [Media Studios overview](./index.md) for the shared flow.

## Caveats

- The studio uses the **fal.ai** key and queue infrastructure; Pika itself is identified by the full fal endpoint id (e.g. `fal-ai/pika/v2.2/text-to-video`).
- fal job ids are namespaced as `<model>::<request_id>` so the poll path can route back to the correct model endpoint.
- Video completions rely on polling; there is no provider webhook.
- The `model` field is lifted out of `input` by the shared Studio Kit backend; all other native fal/Pika parameters ride through unchanged.
- **Pikaffects** do not require a prompt; the effect alone drives the transformation, with an optional prompt for extra guidance.

---
> Verified against v1.0.0
