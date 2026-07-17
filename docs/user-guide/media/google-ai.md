# Google AI Studio

**Google AI Studio** (`/media/google-ai`) exposes Google's Gemini Developer API for media generation — Nano Banana and Imagen image models plus Veo video — using a single Gemini API key. It is the consumer/developer path, distinct from the enterprise GCP path at [Google Vertex](./vertex).

## Where to configure

This is a **universal-credential** provider: it reuses the same Gemini API key you configure under **Settings → AI → Google Gemini**. No separate media credential is required. See [Settings](../settings) for AI provider setup.

## Tabs

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Image** | Image | Model (Nano Banana / Imagen 3/4 variants), prompt, aspect ratio, sample count (Imagen only) | Still image |
| **Text → Video** | Video | Veo model, prompt, negative prompt, aspect ratio, resolution, duration | MP4 video clip |

## Generation flow

Generations follow the standard [Media Studios flow](./index.md): the job enters the Render Queue, completes, and lands in `/files`. Finished images and videos can be opened in the [Designer](./designer) or posted straight to the composer.

## Caveats

- **Image is synchronous.** Nano Banana and Imagen complete inline and appear almost immediately.
- **Video is asynchronous.** Veo uses `:predictLongRunning` and completes via the `media-jobs-poll` cron — Google provides no completion webhook.
- **Auth-only Veo download.** The finished MP4 is downloaded with the key and returned as a data URL so the lifecycle can import it without an unauthenticated re-download failing with 401.
- One Gemini key drives both the LLM and media surfaces; configure it once.

---
> Verified against v1.0.0
