# D-ID

**D-ID** (`/media/did`) turns a portrait image into a talking-head video. Upload or pick a source face, provide a script, and D-ID animates the face to speak it.

## Where to configure

Configure your D-ID API key under **Settings → Media**. See [Settings](../settings) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Talking Avatar** | Video / Avatar | Portrait image, script, voice provider, voice id, stitch blending | Talking-head video |

## Generation flow

D-ID creates a `talk` job and returns a talk id. The job renders in the background and the render queue polls for completion. When the status becomes `done`, the MP4 lands in `/files` and can be opened in the [Designer](./designer) timeline or posted. See [Media Studios overview](./index) for the common flow.

## Caveats

- A **portrait image** is required. The source image is resolved server-side to a provider-reachable URL before being sent to D-ID.
- Completion is **webhook-first** with a poll-cron fallback; transient poll errors are retried automatically.
- D-ID uses **Basic** authorization (`Authorization: Basic <apiKey>`), not Bearer.
- Voice provider and voice id are optional; when blank, D-ID uses its default voice. Supported providers are Microsoft, Amazon, and ElevenLabs.
- The `stitch` toggle blends the generated head back into the source frame.

## Related docs

- [Media Studios overview](./index) — the shared render-queue and hand-off flow.
- [HeyGen](./heygen) — another avatar-video studio.
- [Settings](../settings) — configuring media providers.

---
> Verified against v1.0.0
