# Reel.Farm

**Reel.Farm** (`/media/reelfarm`) turns a single natural-language prompt into a finished TikTok-style slideshow video. Slide text, layout, fonts, and pacing are all generated from the prompt, and you can optionally supply background images from your library.

## Where to configure

Add your Reel.Farm API key in **Settings → Media → Reel.Farm**. This is an own-key provider — there is no environment fallback.

See [Settings](../settings) for provider setup.

## Tabs

| Tab | Operation | Key fields | Output |
|---|---|---|---|
| **Prompt → Slideshow** | Video | Prompt, optional background images 1–4 from `/files` | TikTok-style slideshow video |

## Generation flow

The studio follows the standard Studio Kit flow: fill the form, click **Generate**, and the job appears in the **Render Queue**. When it completes, the video is saved to `/files` and can be opened in the [Designer](./index.md) or posted directly. See [Media Studios overview](./index.md) for details.

## Caveats

- **Async only** — slideshows render as background jobs.
- Reel.Farm does not send a completion webhook, so completion is driven by the media-jobs poll cron.
- Optional `image_N` fields are resolved to provider-reachable URLs from your selected `/files` assets.
- Background images must already be saved in `/files`; the Media Selector validates that each pick is an image.
- Reel.Farm is video-only — it does not generate images or audio.

---
> Verified against v1.0.0
