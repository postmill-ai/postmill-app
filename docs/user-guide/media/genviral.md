# Genviral

**Genviral** (`/media/genviral`) is a Studio AI video generator that routes prompts to underlying video models such as Sora and Seedance. Provide a prompt and a model from the live catalog, and it returns a short-form video.

## Where to configure

Configure your Genviral Partner API key under **Settings → Media**. The key is a single `public_id.secret` Bearer token. See [Settings](../settings) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Prompt → Video** | Video | Model, prompt, source image (optional), audio track (optional), negative prompt, aspect ratio, duration, fps, generate audio | Short-form video |

## Generation flow

Genviral video generation is **async**. The studio submits the job to Genviral's Partner API and the render queue polls for completion via the shared poll cron. When the status becomes `succeeded`, the video lands in `/files` and can be opened in the [Designer](./designer) or posted. See [Media Studios overview](./index) for the common flow.

## Caveats

- A **model is required**. The model dropdown is populated live from Genviral's `/studio/models` catalog; the combobox also accepts any typed model id, so the catalog never blocks a render.
- There is **no completion webhook**; jobs rely on the `media-jobs-poll` cron, like Runway.
- Resolution, duration, fps, aspect ratio, and `generate_audio` are nested under a `params` object server-side; optional media inputs (`image_url`, `audio_url`) and `negative_prompt` ride at the top level.
- Genviral supports video only — no image or audio-only generation.

## Related docs

- [Media Studios overview](./index) — the shared render-queue and hand-off flow.
- [Settings](../settings) — configuring media providers.

---
> Verified against v1.0.0
