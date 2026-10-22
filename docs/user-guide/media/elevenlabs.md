# ElevenLabs

**ElevenLabs** (`/media/elevenlabs`) generates natural-sounding text-to-speech voiceovers, still images, and short video clips. Pick a voice and tune stability for voiceovers, or prompt Gemini / GPT Image / Veo models for visuals.

## Where to configure

Configure your ElevenLabs API key under **Settings → Media**. See [Settings](../settings) for provider setup.

> **Image & Video requires an ElevenLabs Pro plan.** The Flows API (image + video generation) rejects keys on lower tiers with `402 paid_plan_required`. TTS works on any plan.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Speech** | Audio / TTS | Text, model, voice, stability, similarity boost, style exaggeration, speaker boost | Voiceover audio |
| **Text → Image** | Image | Model (Gemini 3.1 Flash Image, Gemini 3 Pro Image), prompt, aspect ratio, resolution | Still image |
| **Text → Image (GPT)** | Image | Model (GPT Image 2, GPT Image 1), prompt, aspect ratio, quality | Still image |
| **Text → Video** | Video | Model (Veo 3.1 Fast, Veo 3.1), prompt, duration (4/6/8 s), aspect ratio, resolution, generate audio | Video clip (MP4) |

TTS models offered: Multilingual v2 (default), Eleven v3, Flash v2.5, and Turbo v2.5 (legacy — Flash is recommended over it). The retired `eleven_monolingual_v1` / `eleven_multilingual_v1` models are no longer listed; ElevenLabs rejects them with `unsupported_model`.

## Generation flow

- **TTS is synchronous.** The audio is returned inline and appears in the render queue immediately, already saved to `/files`.
- **Images** are submitted to the ElevenLabs Flows API and polled inside the request (a few seconds); the finished image lands in `/files` before the studio returns.
- **Videos** are queued: the studio returns immediately and the clip appears in the render queue when ElevenLabs finishes — expect minutes, not seconds. No webhook is required; the media-jobs poll drives completion.

From the queue card you can play or preview the result, open it in the [Designer](./designer) timeline, or post it. See [Media Studios overview](./index) for the shared hand-off flow.

## Caveats

- The Image & Video API is **Pro-plan gated** by ElevenLabs; a `402 paid_plan_required` error means the workspace needs an upgrade, not a Postmill misconfiguration.
- ByteDance models (Seedream / Seedance) are not offered — ElevenLabs disables them by default and requires explicit approval (`model_access_denied`).
- Each Flows model accepts only its own parameters; the studio only sends the fields valid for the selected model.
- Failed generations report ElevenLabs' `failure_reason` (e.g. `moderated`, `model_error`) on the job card; failed generations are not charged by ElevenLabs.
- Field names are native ElevenLabs params (`voice_id`, `model_id`, `voice_settings`, `aspect_ratio`, `duration_secs`, …) and ride straight into the request body.
- The default voice is Rachel; the dropdown includes a curated set of premade voices, but any valid `voice_id` from your ElevenLabs account works.
- ElevenLabs does not support standalone avatar generation here.

## Related docs

- [Media Studios overview](./index) — the shared render-queue and hand-off flow.
- [Deepgram](./deepgram) — speech-to-text and captions.
- [Settings](../settings) — configuring media providers.

---
> Verified against v1.3.0
