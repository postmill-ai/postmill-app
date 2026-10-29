# Together AI

**Together AI** (`/media/togetherai`) is an AI-hub studio that reuses your existing Together AI LLM key to generate images, videos, and speech through one inference cloud. Its tagline is *“The AI-native cloud for open-source models.”*

## Where to configure

This studio uses **universal-credential reuse**: it reads the Together AI key you already configured under **Settings → AI**. No separate **Settings → Content → AI Media** credential is needed, but the provider only appears as configured when that key exists. See [Settings](../settings).

## Tabs / operations

| Tab | Operation | Output | Key fields |
|---|---|---|---|
| **Text → Image** | Image | Still image | Model, prompt, width, height, steps, number of images, seed. |
| **Text → Video** | Video | Video clip | Model (typed id), prompt, negative prompt, aspect ratio, duration, generate-audio toggle, seed. |
| **Image → Video** | Video | Video clip | Model (typed id), source image, prompt, aspect ratio, duration. |
| **Text → Speech** | Audio | Voiceover | Model, text, voice, response format (MP3/WAV). |

The image and TTS tabs use Together's OpenAI-compatible endpoints. The video tabs use Together's native `/v1/videos` async API.

## Generation flow

Image and TTS generations are **synchronous** and appear immediately. Video generations are **asynchronous** and finish through the Render Queue. All completed artifacts are saved to `/files` and can be opened in the [Designer](./designer) or posted. For the shared flow, see [Media Studios overview](./index.md).

## Caveats

- Video has **no webhook**; completion relies on the `media-jobs-poll` cron.
- The **Text → Image** model dropdown is populated live from Together's `/v1/models` catalog, with a curated FLUX fallback list; **Text → Speech** has a curated Cartesia Sonic list only (no live lookup). Because Together does not reliably tag every modality, the combobox also lets you type a model id directly — the video tabs have no curated list, so you type the video model id there.
- The source image for **Image → Video** is resolved server-side to a provider-reachable URL before submission.
- **Test** on the settings card calls Together's free `/v1/models` catalog — no generation is billed.

## Related docs

- [Media Studios overview](./index)
- [Media Library](../media-library)
- [Settings](../settings)

---
> Verified against v1.4.0
