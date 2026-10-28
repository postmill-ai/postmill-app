# OpenAI

**OpenAI** (`/media/openai`) generates still images through `gpt-image-1` and DALL·E 3, plus text-to-speech voice clips. It uses the same API key as the OpenAI LLM provider.

## Where to configure

Configure your OpenAI API key in **Settings → AI**. The same credential is reused for media generation — a key saved on either surface is mirrored to the other (it also appears under **Settings → Content → AI Media**). See [Settings](../settings.md) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Output |
|---|---|---|---|
| **GPT Image** | Image | Prompt, size, quality, background, output format (`png`/`jpeg`/`webp`), number of images | Still image(s) |
| **DALL·E 3** | Image | Prompt, size, quality (`standard`/`hd`), style (`vivid`/`natural`) | Still image |
| **Text → Speech** | Audio | Text, model (`gpt-4o-mini-tts`/`tts-1`/`tts-1-hd`), voice, output format (`mp3`/`wav`), speed | Audio clip |

## Generation flow

Image and audio generations complete synchronously and land directly in `/files` via the **Render Queue**. From the queue card you can **Edit in Designer** or **Post**. See [Media Studios overview](./index.md) for the shared flow.

## Caveats

- `gpt-image-1` returns base64-encoded images inline; DALL·E 3 returns hosted URLs when available.
- DALL·E 3 is no longer offered to newer OpenAI API keys (the API returns 404). Use **GPT Image** unless your key still has DALL·E access.
- Selecting **Transparent** background in GPT Image only works when the output format is set to **PNG** or **WebP**.
- TTS audio is returned as an inline `data:` URL and saved as an audio file in `/files`.
- The OpenAI studio does not generate video (OpenAI has retired its Sora video API).
- The model and native parameter names in each tab are passed straight to the OpenAI API, so the available options match the provider's current API.
- **Test connection is free:** Settings → Content → AI Media → **Test connection** lists your available models (`/v1/models`); no image or audio is billed.

---
> Verified against v1.4.0
