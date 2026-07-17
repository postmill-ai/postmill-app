# Luma

**Luma** (`/media/luma`) is Luma AI's Dream Machine, which turns text and images into realistic, fluid video. Its Ray models are known for natural motion, strong physics, and fast creative iteration.

## Where to configure

Configure your Luma API key at **Settings → Media**. Postmill stores the key encrypted at rest; there is no environment-variable fallback.

See [Settings](../settings) for provider setup and the media capability matrix.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Video** | `video` | Model, prompt, aspect ratio, resolution, duration, loop | A Luma Dream Machine video clip |
| **Image → Video** | `video` | Start frame, optional end frame, model, prompt, aspect ratio, resolution, duration, loop | A video clip animated between keyframes |

Available models are Ray 2, Ray Flash 2 (faster), and Ray 1.6. Aspect ratios include 16:9, 9:16, 1:1, 4:3, 3:4, and 21:9. Resolutions are 540p, 720p, and 1080p; durations are 5s or 9s.

## Generation flow

Luma video generation is async. After submission, the job appears in the **Render Queue** and polls until Luma reports `completed`; the finished MP4 is saved to `/files`. From there you can open it in the [Designer](./designer) or post directly. See [Media Studios](./index) for the shared flow.

## Caveats

- **Video-only:** this provider does not generate still images or audio.
- **No webhook:** completion relies on the shared media-jobs poll cron, so queue updates happen on the polling interval.
- **Keyframe handling:** `start_image_url` and `end_image_url` are folded into Luma's nested `keyframes` structure by the adapter.
- **Loop option:** the loop toggle produces a seamlessly looping clip when enabled.

## Related docs

- [Media Studios](./index) — the shared render-queue/hand-off flow used by other studios.
- [Designer](./designer) — the target of every "Edit in Designer" hand-off.
- [Settings](../settings) — configuring the Luma media provider.

---
> Verified against v1.0.0
