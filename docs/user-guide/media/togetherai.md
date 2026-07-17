# Together AI

**Together AI** (`/media/togetherai`) is an AI-hub studio that reuses your existing Together AI LLM key to generate images, videos, and speech through one inference cloud. Its tagline is *“The AI-native cloud for open-source models.”*

## Where to configure

This studio uses **universal-credential reuse**: it reads the Together AI key you already configured under **Settings → AI**. No separate **Settings → Media** credential is needed, but the provider only appears as configured when that key exists. See [Settings](../settings).

## Tabs / operations

| Tab | Operation | Output | Key fields |
|---|---|---|---|
| **Text → Image** | Image | Still image | Model, prompt, width, height, steps, number of images, seed. |
| **Text → Video** | Video | Video clip | Model (live catalog or typed id), prompt, negative prompt, aspect ratio, duration, generate-audio toggle, seed. |
| **Image → Video** | Video | Video clip | Model (live catalog or typed id), source image, prompt, aspect ratio, duration. |
| **Text → Speech** | Audio | Voiceover | Model, text, voice, response format (MP3/WAV). |

The image and TTS tabs use Together's OpenAI-compatible endpoints. The video tabs use Together's native `/v1/videos` async API.

## Generation flow

Image and TTS generations are **synchronous** and appear immediately. Video generations are **asynchronous** and finish through the Render Queue. All completed artifacts are saved to `/files` and can be opened in the [Designer](./index.md) or posted. For the shared flow, see [Media Studios overview](./index.md).

## Caveats

- Video has **no webhook**; completion relies on the `media-jobs-poll` cron.
- The model dropdown is populated live from Together's `/v1/models` catalog for image models, with curated fallbacks for video and audio. Because Together does not reliably tag every modality, the combobox also lets you type a model id directly.
- The source image for **Image → Video** is resolved server-side to a provider-reachable URL before submission.

## Related docs

- [Media Studios overview](./index)
- [Media Library](../media-library)
- [Settings](../settings)

---
> Verified against v1.0.0
