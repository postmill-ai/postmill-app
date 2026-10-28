# Reel.Farm

**Reel.Farm** (`/media/reelfarm`) turns a single natural-language prompt into a finished TikTok-style slideshow video. Slide text, layout, fonts, and pacing are all generated from the prompt, and you can optionally supply background images from your library.

## Where to configure

Add your Reel.Farm API key in **Settings → Content → AI Media → Reel.Farm**. This is an own-key provider — there is no environment fallback. **Test connection** is free: it calls Reel.Farm's `GET /account` endpoint and reports an invalid key (401/403) or the upstream status code on any other failure, without generating anything.

See [Settings](../settings) for provider setup.

## Tabs

| Tab | Operation | Key fields | Output |
|---|---|---|---|
| **Prompt → Slideshow** | Video | Prompt, aspect ratio, image fit, seconds per slide, optional background images 1–4 from `/files` | One playable MP4 slideshow |

## Generation flow

The studio follows the standard Studio Kit flow: fill the form, click **Generate**, and the job appears in the **Render Queue**. Only the prompt (sent as `additional_context`) and the optional background images go to Reel.Farm. Reel.Farm exports an ordered set of slide images (up to 20); Postmill downloads them securely and encodes them locally into **one MP4 on the original job**. The video uses H.264 with silent AAC audio, starts playing quickly on the web (`faststart`), and lands in `/files` ready to open in the [Designer](./designer) or post. The queue card previews the stored file by its actual type — an image if a slideshow somehow lands without a video export — and the same type decides whether **Edit in Designer** opens the timeline or the static canvas.

Choose **4:5** (1080×1350, default), **9:16** (1080×1920), **1:1** (1080×1080), or **16:9** (1920×1080) for the MP4 canvas. By default images are cropped to fill the frame; enable **Fit whole images (letterbox)** to preserve their native aspect ratios instead. **Seconds per slide** controls the slideshow timing (1–30 seconds, default 4). These three settings apply only to Postmill's local conversion and are never sent to Reel.Farm. See [Media Studios overview](./index.md) for details.

## Caveats

- **Async only** — slideshows render as background jobs.
- Reel.Farm does not send a completion webhook, so completion is driven by the media-jobs poll cron (`GET /slideshows/{id}/status`, then `GET /videos/{video_id}` once a video export exists).
- Failures are terminal, not retried forever: a `failed` slideshow, a completed slideshow with no video id or no usable slide images, a failed local encode, or an oversized download (25 MB per slide / 100 MB total) marks the job **Failed** with the upstream message. Only 429/5xx responses from Reel.Farm are treated as transient and retried.
- Optional `image_N` fields are resolved to provider-reachable URLs from your selected `/files` assets.
- Background images must already be saved in `/files`; the Media Selector validates that each pick is an image.
- Reel.Farm is video-only — it does not generate images or audio.
- Reel.Farm's public API creates **slideshow videos only**. Their UGC/avatar and greenscreen videos are generated in the Reel.Farm app — the API can list them (`video_type: "ugc" | "greenscreen"` in `GET /videos`) but cannot create them, so they are not available in this studio.

---
> Verified against v1.4.0
