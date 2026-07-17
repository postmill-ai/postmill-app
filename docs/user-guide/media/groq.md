# Groq

**Groq** (`/media/groq`) runs speech generation on Groq's LPU-backed inference stack. The media studio currently exposes text-to-speech using PlayAI and Orpheus voices through the OpenAI-compatible `/audio/speech` endpoint.

## Where to configure

This is a **universal-credential** provider: it reuses the Groq API key configured under **Settings → AI → Groq**. No separate media credential is required. See [Settings](../settings) for AI provider setup.

## Tabs

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Speech** | Audio | Model (PlayAI TTS / Arabic / Orpheus), text, voice, format (WAV/MP3) | Audio file |

## Generation flow

Audio generations complete synchronously and land in `/files` through the standard [Media Studios flow](./index.md). Once ready, the clip can be opened in the [Designer](./designer) timeline or posted via the composer.

## Caveats

- **TTS only.** Groq's media surface is currently limited to text-to-speech; Whisper STT is not exposed in this studio.
- **Synchronous generation.** Results appear immediately without a background poll.
- The model list is curated; Groq's `/models` endpoint does not reliably tag TTS models, so the studio exposes the known PlayAI and Orpheus options directly.

---
> Verified against v1.0.0
