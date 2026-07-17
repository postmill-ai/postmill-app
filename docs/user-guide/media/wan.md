# Wan

**Wan** (`/media/wan`) is Alibaba's Wan creative platform on Model Studio (DashScope). It generates images and videos with the Wan2.x model family, including text-to-image, text-to-video, and image-to-video.

## Where to configure

Configure a dedicated Wan key under **Settings → Media**. Wan is an own-key provider — it does not reuse the Qwen AI credential, even though both use DashScope. See [Settings](../settings) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Image** | Image | Model, prompt, negative prompt, size, number of images, prompt rewrite | Still image(s) |
| **Text → Video** | Video | Model, prompt, negative prompt, size, duration, prompt rewrite | Video clip |
| **Image → Video** | Video | Model, source image, prompt, negative prompt, resolution, duration | Video clip |

## Generation flow

Image generations complete synchronously via bounded internal polling, so the result appears in the render queue almost immediately. Video generations submit an async DashScope task and complete through the shared poll cron. Finished artifacts land in `/files` and can be opened in the [Designer](./designer) or posted directly. See [Media Studios overview](./index) for the common flow.

## Caveats

- Wan points at the **international** DashScope host (`dashscope-intl.aliyuncs.com`).
- There is **no completion webhook**; video jobs rely on the `media-jobs-poll` cron, like Runway and Qwen video.
- The model dropdown is curated because DashScope has no clean per-modality catalog; the combobox also accepts any typed model id.
- Field names are native DashScope params: `negative_prompt` and `img_url` route into `input`, while size, resolution, duration, `n`, and `prompt_extend` ride into `parameters`.
- Wan does not support audio or avatar generation.

---
> Verified against v1.0.0
