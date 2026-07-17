# Kling

**Kling** (`/media/kling`) is a next-generation AI video studio by Kuaishou, known for long, cinematic clips with strong realism and physics. Recent models add native audio, voiceovers, and sound in a single pass.

## Where to configure

Kling runs through the **fal.ai** adapter, so you configure a single fal.ai API key at **Settings → Media**. The registry/config identifier is `fal`, but the studio title and nav remain "Kling." Postmill stores the key encrypted at rest; there is no environment-variable fallback.

See [Settings](../settings) for provider setup and the media capability matrix.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Video** | `video` | Model, prompt, negative prompt, duration (5s or 10s), aspect ratio, CFG scale | A Kling video clip |
| **Image → Video** | `video` | Source image, model, prompt, negative prompt, duration, CFG scale | A Kling video clip animated from the image |

Available models include Kling 1.6 Standard, Kling 1.6 Pro, and Kling 2.0 Master for both text-to-video and image-to-video.

## Generation flow

Video jobs are submitted to the fal.ai queue and appear in the **Render Queue** as pending/processing. The queue polls while a job is active; when completed, the video is saved to `/files` and can be opened in the [Designer](./designer) or posted directly from the queue card. See [Media Studios](./index) for the shared flow.

## Caveats

- **fal.ai-backed:** the adapter is shared with other fal-hosted providers (Pika and the generic fal image/audio path), but the Kling descriptor uses Kling-specific model endpoints.
- **No webhook:** Kling completions rely on the shared media-jobs poll cron, so the queue updates on its polling interval.
- **Namespaced job ids:** fal queue jobs are stored as `<model>::<request_id>` so the poller can route status checks to the correct model endpoint.

## Related docs

- [Media Studios](./index) — the shared render-queue/hand-off flow used by other studios.
- [Designer](./designer) — the target of every "Edit in Designer" hand-off.
- [Settings](../settings) — configuring the fal.ai media provider used by Kling.

---
> Verified against v1.0.0
