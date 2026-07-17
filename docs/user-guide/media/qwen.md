# Qwen

**Qwen** (`/media/qwen`) serves Alibaba's Qwen-Image and Wan2.x video models through the DashScope / Model Studio API. It handles long prompts and produces native 2K images plus text-to-video and image-to-video clips.

## Where to configure

The Qwen media key is **shared with the Qwen LLM provider**. Configure your DashScope API key in **Settings → AI** (or **Settings → Media**) and both surfaces work. See [Settings](../settings.md) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Output |
|---|---|---|---|
| **Text → Image** | Image | Model (`qwen-image-plus`/`qwen-image`), prompt, negative prompt, size, prompt-extend toggle, watermark toggle, optional seed | Still image |
| **Text → Video** | Video | Model (Wan 2.2/2.1 T2V variants), prompt, negative prompt, resolution, duration, prompt-extend toggle | MP4 video clip |
| **Image → Video** | Video | Model (Wan 2.2/2.1 I2V variants), source image, prompt, negative prompt, prompt-extend toggle | MP4 video clip |

## Generation flow

Completed artifacts land in `/files` via the **Render Queue**. Images finish synchronously (with brief internal polling); videos run asynchronously and are picked up by the media-jobs poll cron. From the queue card you can **Edit in Designer** or **Post**. See [Media Studios overview](./index.md) for the shared flow.

## Caveats

- Uses the DashScope async task API (`X-DashScope-Async: enable` on creation, then `GET /tasks/{id}`).
- The adapter routes `prompt`, `negative_prompt`, and `img_url` into DashScope's `input` object; every other parameter goes into `parameters`.
- There is no completion webhook; video jobs rely on the poll cron.
- 1080p resolutions require a Plus Wan model.
- Qwen-Image handles long prompts (up to roughly 1,000 tokens), so detailed scene descriptions are supported.

---
> Verified against v1.0.0
