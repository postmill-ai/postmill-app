# fal.ai

**fal.ai** (`/media/fal`) is the canonical studio for Postmill's fal.ai integration. It exposes every fal-hosted model currently implemented by the adapter: FLUX images, Stable Audio, Kling video, Pika video, and Pikaffects.

The legacy `/media/kling` URL redirects here. That URL previously showed only fal-hosted Kling models; direct Kling API access remains separate at [Kling AI](./kling) (`/media/kling-ai`).

## Where to configure

Configure one fal.ai API key at **Settings → Media → fal.ai**. The fal.ai provider card opens `/media/fal`. The same configured connection also powers the branded [Pika](./pika) studio; there is no separate Pika provider card or credential. Postmill encrypts the key at rest and has no environment-variable fallback.

## Tabs / operations

| Tab | Operation | Model(s) | Produces |
|---|---|---|---|
| **Text → Image** | `image` | `fal-ai/flux/schnell` | FLUX.1 Schnell images |
| **Kling Text → Video** | `video` | Kling 1.6 Standard / Pro and 2.0 Master | Text-conditioned Kling clips |
| **Kling Image → Video** | `video` | Kling 1.6 Standard / Pro and 2.0 Master | Kling clips animated from a source image |
| **Pika Text → Video** | `video` | `fal-ai/pika/v2.2/text-to-video` | Pika 2.2 clips |
| **Pika Image → Video** | `video` | `fal-ai/pika/v2.2/image-to-video` | Pika 2.2 clips from a source image |
| **Pikaffects** | `video` | `fal-ai/pika/v1.5/pikaffects` | One-click Pika visual effects |
| **Text → Music** | `audio` | `fal-ai/stable-audio` | Stable Audio music and audio |

## Generation flow

Flux images use fal.ai's synchronous generation endpoint. Kling, Pika, Pikaffects, and Stable Audio jobs use the fal.ai queue and appear in the **Render Queue**. Completed artifacts are saved to `/files` and can be opened in the [Designer](./designer) or posted directly. When webhooks are unavailable, the shared media-jobs poll cron provides completion fallback.

## Related docs

- [Pika](./pika) — the branded Pika studio using the same fal.ai connection.
- [Kling AI](./kling) — the independent official Kling API integration.
- [Media Studios](./index) — the shared render-queue and handoff flow.
- [Settings](../settings) — provider credential setup.

---
> Verified against v1.3.0
