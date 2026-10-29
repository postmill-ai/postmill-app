# Kling AI

**Kling AI** (`/media/kling-ai`) is Postmill's direct integration with the official Kling AI API by Kuaishou. It is independent of the fal-hosted Kling models available in the [fal.ai studio](./fal).

The legacy `/media/kling` studio used the `fal` provider and now redirects to `/media/fal`. It did not use direct Kling AI credentials.

## Where to configure

Configure your official Kling AI API key at **Settings → Content → AI Media → Kling AI** (paste the key from `kling.ai/dev/api-key`; it is sent as a Bearer token to `api-singapore.klingai.com`). The provider card opens `/media/kling-ai`; it uses the preserved `kling` provider identifier and does not share the fal.ai API key. **Test connection** is free — it lists one page of your image tasks instead of generating anything.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Video** | `video` | Model, prompt, duration (5/10 s), aspect ratio (16:9 / 9:16 / 1:1), resolution (720p / 1080p), audio (Silent / Native audio) | A direct Kling video clip |
| **Image → Video** | `video` | Model, **First frame** (required), **Last frame** (optional), prompt, duration, resolution, audio | A Kling clip animated from source frames |
| **Text → Image** | `image` | Model, prompt, negative prompt, aspect ratio (eight options from 16:9 to 21:9), resolution (1K / 2K), images (1–9) | A Kling image |

Video models: **Kling 3.0 Turbo** (default), **3.0**, **2.6**, and **2.5 Turbo**. Image models: **Kling V3** (default) and **V2.1**. The **Audio** choice is only sent for Kling 3.0 and 2.6 (3.0 Turbo always renders native audio; for 2.5 Turbo the setting is ignored), and Kling 2.6 requires **1080p** when native audio is on — the resolution field narrows to that option automatically and the request is rejected otherwise.

## Generation flow

Video jobs are submitted to the official Kling API (`/text-to-video/<model>` or `/image-to-video/<model>`) and tracked in the **Render Queue**. When the backend has a public HTTPS URL the submission carries a `callback_url`; otherwise (and as a fallback) the media-jobs poll completes the job. Image generation is a Kling task too, but the studio polls it inline (up to about a minute) so images appear in the queue like a synchronous result. Completed media is saved to `/files` and can be opened in the [Designer](./designer) or posted directly. Kling AI is also registered as a compact generation provider in Designer picker dialogs.

## Related docs

- [fal.ai](./fal) — fal-hosted Kling, Pika, Flux, and Stable Audio models.
- [Media Studios](./index) — the shared generation flow.
- [Settings](../settings) — configuring direct Kling AI credentials.

---
> Verified against v1.4.0
