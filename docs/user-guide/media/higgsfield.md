# Higgsfield

**Higgsfield** (`/media/higgsfield`) is an AI-native creative suite for social content: Soul for text-to-image, DoP for cinematic image-to-video, and Speak for audio-driven talking video.

## Where to configure

Configure Higgsfield under **Settings → Media → Higgsfield**. It uses a **two-part credential** — API Key ID and API Key Secret — rather than a single key. See [Settings](../settings) for credential setup.

## Tabs

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Image** | Image | Prompt, size, quality, batch size, optional reference image, enhance prompt, seed | Still image(s) |
| **Image → Video** | Video | DoP model (Standard/Turbo/Lite), source image, prompt, enhance prompt, seed | MP4 video clip |
| **Speak** | Video | Portrait image, audio clip, prompt, quality, duration, seed | Talking-head video |

## Generation flow

All three tabs follow the standard [Media Studios flow](./index.md): jobs appear in the Render Queue and land in `/files` when complete. Images and videos can be edited in the [Designer](./designer) or posted.

## Caveats

- **Two-part auth.** Credentials are sent as `Authorization: Key <id>:<secret>`. As a fallback, a single string in `KEY_ID:KEY_SECRET` form is accepted.
- **Image is synchronous.** Soul completes via bounded internal polling; `batch_size: 4` returns multiple images, and each is saved as its own file.
- **Video is asynchronous.** DoP and Speak rely on the `media-jobs-poll` cron — Higgsfield provides no completion webhook.
- **NSFW filter.** A generation flagged as `nsfw` is reported as failed.
- Source image and audio media fields are resolved server-side to provider-reachable URLs.

---
> Verified against v1.0.0
