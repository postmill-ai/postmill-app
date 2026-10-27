# HeyGen

**HeyGen** (`/media/heygen`) is a bespoke AI avatar-video studio built on the AI Media provider
stack — a `HeyGenAdapter`, a per-org `MediaProviderConfig`, and the async `AIMediaJob` job
pipeline. Configure your HeyGen API key at **Settings → Media** (no environment-variable fallback).

For shared visual-generation routing, HeyGen is **avatar-only**: it supports avatar and talking-photo
workflows, not ordinary text-to-video or image-to-video generation. It therefore does not appear
as an ordinary visual provider in the Designer. HeyGen is also available as a voiceover provider,
including for faceless product videos with separate visual and narration tracks.

## Four tabs

| Tab | What it does |
|---|---|
| **Storyboard** | Multi-scene avatar video. Each scene picks an avatar, a voice, a script, and an optional background (a solid color, or an image/video from `/files`). Scenes can be reordered, and every scene needs an avatar, voice, and script before you can generate. |
| **Talking Photo** | Upload a portrait from `/files`; HeyGen mints a `talking_photo_id` and animates it speaking a script you provide, with a chosen voice and output dimension (16:9, 9:16, or 1:1). |
| **Translate** | Submits a source video from `/files` for AI dubbing into one or more target languages, picked from HeyGen's live list of supported languages. The source must be a HeyGen-reachable URL. One `AIMediaJob` is created per target language. |
| **Voiceover** | Text-to-speech only — generates a voiced audio clip (no avatar) from a script and voice, saved into your audio files. |

## In the Designer

The Designer's **Generate Avatar Video** dialog can use HeyGen as its provider. It embeds a compact
Talking Photo flow — portrait, HeyGen voice, and dimension — while the dialog's own script box
supplies the script; the finished clip lands on the video timeline.

For a faceless product ad, open **AI Video**, enable **Include voiceover**, and select HeyGen as
the voice provider. The visual provider generates the product footage without an avatar, while
HeyGen generates the narration as a separate editable timeline track.

## Render queue

A live **Render queue** (polling `GET /media/heygen/jobs`) tracks every submission across all four
tabs. HeyGen internally namespaces the provider job reference by operation (`video:`, `tts:`,
`translate:`) so the poller can route status checks to the right HeyGen endpoint per job type.

## Output

Every finished render lands in `/files` through the same `MediaJobLifecycleService` → cron/webhook
pipeline every other media provider uses, then offers the same two hand-offs as the rest of
`/media`:

- **Edit in Designer** — opens the video in the [Designer](./designer)'s video timeline (or, for
  Talking Photo/Voiceover audio, the appropriate timeline track).
- **Post** — opens the composer pre-filled with the finished asset.

See [Media Studios](./index) for the render-queue/hand-off flow shared across studios.

## Related docs

- [Media Studios](./index) — the shared render-queue/hand-off flow used by other studios.
- [Designer](./designer) — the target of every "Edit in Designer" hand-off.
- [Settings](../settings) — configuring the HeyGen media provider and its storage destination.

---
> Verified against v1.3.0
