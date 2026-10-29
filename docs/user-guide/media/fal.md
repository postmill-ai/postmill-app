# fal.ai

**fal.ai** (`/media/fal`) is the canonical studio for Postmill's fal.ai integration. It exposes every fal-hosted model currently implemented by the adapter: FLUX images, Stable Audio, Kling video, and Pika video.

The legacy `/media/kling` URL redirects here. That URL previously showed only fal-hosted Kling models; direct Kling API access remains separate at [Kling AI](./kling) (`/media/kling-ai`).

## Where to configure

Configure one fal.ai API key at **Settings → Content → AI Media → fal.ai**. The fal.ai provider card opens `/media/fal`. The same configured connection also powers the branded [Pika](./pika) studio; there is no separate Pika provider card or credential. Postmill encrypts the key at rest and has no environment-variable fallback. **Test connection** is free — it reads fal's model catalog (`GET https://api.fal.ai/v1/models`) and never triggers a billed render.

## Tabs / operations

| Tab | Operation | Model(s) | Produces |
|---|---|---|---|
| **Text → Image** | `image` | `fal-ai/flux/schnell` | FLUX.1 Schnell images (image size, 1–12 inference steps, JPEG/PNG, seed, safety checker) |
| **Kling Text → Video** | `video` | Kling 2.5 Turbo Pro (default) and 2.6 Pro | Text-conditioned Kling clips — prompt, negative prompt, 5/10 s, 16:9 / 9:16 / 1:1 |
| **Kling Image → Video** | `video` | Kling 2.5 Turbo Pro (default) and 2.6 Pro | Kling clips animated from a source image — prompt, negative prompt, 5/10 s |
| **Pika Text → Video** | `video` | `fal-ai/pika/v2.2/text-to-video` | Pika 2.2 clips |
| **Pika Image → Video** | `video` | `fal-ai/pika/v2.2/image-to-video` | Pika 2.2 clips from a source image |
| **Text → Music** | `audio` | `fal-ai/stable-audio` | Stable Audio music and audio (1–47 s, CFG scale, seed) |

The two Kling models expose different extras: **CFG scale** (0–1, default 0.5) appears only for Kling 2.5 Turbo Pro, and the **Generate audio** toggle appears only for Kling 2.6 Pro. The adapter strips whichever field the chosen model does not accept, and maps the 2.6 image-to-video source image onto fal's `start_image_url`.

## Generation flow

Flux images use fal.ai's synchronous generation endpoint. Kling, Pika, and Stable Audio jobs use the fal.ai queue and appear in the **Render Queue**. Kling 2.6 can optionally generate native audio; it is off by default to avoid unexpected audio charges. Completed artifacts are saved to `/files` and can be opened in the [Designer](./designer) or posted directly. When the backend has a public HTTPS URL the submit request carries a `fal_webhook` callback; otherwise (and as a fallback) the shared media-jobs poll cron completes the job.

## Related docs

- [Pika](./pika) — the branded Pika studio using the same fal.ai connection.
- [Kling AI](./kling) — the independent official Kling API integration.
- [Media Studios](./index) — the shared render-queue and handoff flow.
- [Settings](../settings) — provider credential setup.

---
> Verified against v1.4.0
