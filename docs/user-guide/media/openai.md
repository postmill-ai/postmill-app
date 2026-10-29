# OpenAI

**OpenAI** (`/media/openai`) generates still images through `gpt-image-1`, plus text-to-speech voice clips. It uses the same API key as the OpenAI LLM provider.

## Where to configure

Configure your OpenAI API key in **Settings → AI**. The same credential is reused for media generation — a key saved on either surface is mirrored to the other (it also appears under **Settings → Content → AI Media**). See [Settings](../settings.md) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Output |
|---|---|---|---|
| **GPT Image** | Image | Prompt, size, quality, background, output format (`png`/`jpeg`/`webp`), number of images | Still image(s) |
| **Text → Speech** | Audio | Text, model (`gpt-4o-mini-tts`/`tts-1`/`tts-1-hd`), voice, output format (`mp3`/`wav`), speed | Audio clip |

## Generation flow

Image and audio generations complete synchronously and land directly in `/files` via the **Render Queue**. From the queue card you can **Edit in Designer** or **Post**. See [Media Studios overview](./index.md) for the shared flow.

## Caveats

- `gpt-image-1` returns base64-encoded images inline.
- The DALL·E 3 tab was removed in v1.4.0 — the model 404s for newer OpenAI API keys. Organizations already configured for DALL·E 3 keep working (the adapter still honors it); everyone else should use **GPT Image**.
- Selecting **Transparent** background in GPT Image only works when the output format is set to **PNG** or **WebP**.
- TTS audio is returned as an inline `data:` URL and saved as an audio file in `/files`.
- The OpenAI studio does not generate video (OpenAI has retired its Sora video API).
- The model and native parameter names in each tab are passed straight to the OpenAI API, so the available options match the provider's current API.
- **Test connection is free:** Settings → Content → AI Media → **Test connection** lists your available models (`/v1/models`); no image or audio is billed.

---
> Verified against v1.4.0
