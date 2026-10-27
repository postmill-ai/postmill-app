# Reel.Farm

**Reel.Farm** (`/media/reelfarm`) turns a single natural-language prompt into a finished TikTok-style slideshow video. Slide text, layout, fonts, and pacing are all generated from the prompt, and you can optionally supply background images from your library.

## Where to configure

Add your Reel.Farm API key in **Settings → Media → Reel.Farm**. This is an own-key provider — there is no environment fallback.

See [Settings](../settings) for provider setup.

## Tabs

| Tab | Operation | Key fields | Output |
|---|---|---|---|
| **Prompt → Slideshow** | Video | Prompt, aspect ratio, image fit, seconds per slide, optional background images 1–4 from `/files` | One playable MP4 slideshow |

## Generation flow

The studio follows the standard Studio Kit flow: fill the form, click **Generate**, and the job appears in the **Render Queue**. Reel.Farm exports an ordered set of slide images; Postmill downloads them securely and encodes them into **one MP4 on the original job**. The video uses H.264 with silent AAC audio, starts playing quickly on the web, and lands in `/files` ready to open in the [Designer](./designer) or post.

Choose **4:5**, **9:16**, **1:1**, or **16:9** for the MP4 canvas. By default images are cropped to fill the frame; enable **Fit whole images (letterbox)** to preserve their native aspect ratios instead. **Seconds per slide** controls the slideshow timing (1–30 seconds, default 4). See [Media Studios overview](./index.md) for details.

## Caveats

- **Async only** — slideshows render as background jobs.
- Reel.Farm does not send a completion webhook, so completion is driven by the media-jobs poll cron.
- Optional `image_N` fields are resolved to provider-reachable URLs from your selected `/files` assets.
- Background images must already be saved in `/files`; the Media Selector validates that each pick is an image.
- Reel.Farm is video-only — it does not generate images or audio.
- Reel.Farm's public API creates **slideshow videos only**. Their UGC/avatar and greenscreen videos are generated in the Reel.Farm app — the API can list them (`video_type: "ugc" | "greenscreen"` in `GET /videos`) but cannot create them, so they are not available in this studio.

---
> Verified against v1.3.0
