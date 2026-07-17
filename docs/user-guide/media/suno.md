# Suno

**Suno** (`/media/suno`) is a generative-AI music studio that turns a text prompt — or your own lyrics, style, and title — into complete songs with vocals or instrumental tracks. This integration uses the sunoapi.org gateway.

## Where to configure

Configure your Suno API key under **Settings → Media**. This is an own-key provider; there is no environment-variable fallback. See [Settings](../settings) for credential setup.

## Tabs / operations

| Tab | Operation | Output | Key fields |
|---|---|---|---|
| **Song** | Audio | Vocal song | Prompt/lyrics, style, title, model version, vocal gender, style weight, instrumental toggle. |
| **Instrumental** | Audio | Instrumental track | Prompt, style, title, model version, style weight, instrumental toggle. |

The **Song** tab defaults to vocal generation; the **Instrumental** tab defaults to no vocals. If you fill in both **Style** and **Title** on either tab, the adapter switches Suno into custom mode.

## Generation flow

Suno generations are **asynchronous**. After you click **Generate**, the job enters the Render Queue and polls until the tracks are ready. The finished MP3s are saved to `/files` and can be opened in the [Designer](./index.md) or used in a post. For the shared queue and hand-off flow, see [Media Studios overview](./index.md).

## Caveats

- Suno returns **two clips** per generation. The first clip becomes the main job artifact; the second clip lands as a sibling render-queue card, so you get two separate files.
- There is **no completion webhook**; jobs finish via the `media-jobs-poll` cron.
- The integration was built from the sunoapi.org API reference without a live key — exact status strings and field behavior may need a quick smoke test.

## Related docs

- [Media Studios overview](./index)
- [Media Library](../media-library)
- [Settings](../settings)

---
> Verified against v1.0.0
