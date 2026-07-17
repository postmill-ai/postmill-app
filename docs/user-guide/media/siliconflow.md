# SiliconFlow

**SiliconFlow** (`/media/siliconflow`) is a fast OpenAI-compatible inference platform serving hundreds of open and commercial models. Its media studio covers image generation, Wan2.x video, and text-to-speech in one place.

## Where to configure

SiliconFlow reuses your org's existing **Settings → AI** SiliconFlow key as a universal credential, so no separate **Settings → Media** entry is required. You can still add a dedicated media credential there if you prefer.

See [Settings](../settings) for provider setup.

## Tabs

| Tab | Operation | Key fields | Output |
|---|---|---|---|
| **Text → Image** | Image | Model (live catalog/curated list), prompt, negative prompt, size, steps, batch size, seed | Still image(s) |
| **Text → Video** | Video | Model (Wan2.x), prompt, negative prompt, resolution, seed | Video clip |
| **Image → Video** | Video | Model (Wan2.x), source image, prompt, resolution | Video clip |
| **Text → Speech** | Audio | Model (Fish-Speech / CosyVoice), text, voice, format (MP3/WAV) | Audio file |

## Generation flow

The studio follows the standard Studio Kit flow: fill the form, click **Generate**, track the job in the **Render Queue**, and open the finished asset in the [Designer](./index.md) or the composer. See [Media Studios overview](./index.md) for details.

## Caveats

- **Image and Text → Speech are synchronous** — results appear almost immediately.
- **Video is async** and has no webhook; completion is driven by the media-jobs poll cron.
- Image-to-video base64-encodes the source frame before sending it to SiliconFlow.
- Image models are discovered from the provider catalog; video/audio models use a curated fallback list.

---
> Verified against v1.0.0
