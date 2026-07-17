# ElevenLabs

**ElevenLabs** (`/media/elevenlabs`) generates natural-sounding text-to-speech voiceovers. Pick a voice, tune stability and style settings, and turn a script into an audio clip.

## Where to configure

Configure your ElevenLabs API key under **Settings → Media**. See [Settings](../settings) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Speech** | Audio / TTS | Text, model, voice, stability, similarity boost, style exaggeration, speaker boost | Voiceover audio |

## Generation flow

ElevenLabs TTS is **synchronous**. The audio is returned inline and appears in the render queue immediately, already saved to `/files`. From the queue card you can play the clip, open it in the [Designer](./designer) timeline, or post it. See [Media Studios overview](./index) for the shared hand-off flow.

## Caveats

- No background job or webhook is needed; generation completes in the request itself.
- Field names are native ElevenLabs params (`voice_id`, `model_id`, `voice_settings`) and ride straight into the request body.
- The default voice is Rachel; the dropdown includes a curated set of premade voices, but any valid `voice_id` from your ElevenLabs account works.
- ElevenLabs does not support image, video, or standalone avatar generation here.

## Related docs

- [Media Studios overview](./index) — the shared render-queue and hand-off flow.
- [Deepgram](./deepgram) — speech-to-text and captions.
- [Settings](../settings) — configuring media providers.

---
> Verified against v1.0.0
