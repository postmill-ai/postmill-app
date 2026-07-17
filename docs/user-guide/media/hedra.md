# Hedra

**Hedra** (`/media/hedra`) generates expressive character videos from a single portrait keyframe and a text prompt, powered by Hedra's Character-3 model.

## Where to configure

Configure a Hedra API key under **Settings → Media → Hedra**. This is an own-key provider and does **not** reuse an AI key. See [Settings](../settings) for credential setup.

## Tabs

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Character Video** | Video | Portrait image, prompt, aspect ratio | MP4 character video |

## Generation flow

Jobs follow the standard [Media Studios flow](./index.md): submit the form, track progress in the Render Queue, and the finished video lands in `/files`. From there you can open it in the [Designer](./designer) or post it.

## Caveats

- **Portrait is required.** The source image (`start_keyframe`) is resolved server-side to a provider-reachable URL before generation starts.
- **Asynchronous.** Completion is delivered by webhook when available; the `media-jobs-poll` cron acts as a fallback.
- Only one tab/operation is exposed: character video from a keyframe.

---
> Verified against v1.0.0
