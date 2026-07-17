# LTX Studio

**LTX Studio** (`/media/ltx`) by Lightricks is an end-to-end AI video production platform. Powered by the open-source LTX-2 model family, it generates text-to-video, image-to-video, and audio-to-video clips.

## Where to configure

Configure your LTX Studio API key at **Settings → Media**. Postmill stores the key encrypted at rest; there is no environment-variable fallback.

See [Settings](../settings) for provider setup and the media capability matrix.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Video** | `video` | Prompt, model, resolution, duration, FPS, camera motion, generate audio | An LTX-2 video clip, optionally with generated audio |
| **Image → Video** | `video` | Source image, prompt, model, resolution, duration, FPS, camera motion, optional last frame, generate audio | An LTX-2 video clip animated from the image |
| **Audio → Video** | `video` | Audio track, optional reference image, optional prompt, model, resolution, duration | A video clip synchronized to the audio track (Pro models only) |

Available models are LTX-2.3 Pro/Fast and LTX-2 Pro/Fast. Pro models are required for audio-to-video.

## Generation flow

All LTX jobs are async: `POST /v2/<op>` returns an id, then Postmill polls `GET /v2/<op>/{id}` until `status: completed`. The job appears in the **Render Queue** and, when ready, the video is saved to `/files`. From there you can open it in the [Designer](./designer) or post directly. See [Media Studios](./index) for the shared flow.

## Caveats

- **Video-only:** this provider does not generate still images or audio-only output.
- **No webhook:** LTX relies on the shared media-jobs poll cron (like Runway and Wan), so queue updates happen on the polling interval.
- **Namespaced job ids:** job ids are stored as `<op>:<id>` (text-to-video, image-to-video, or audio-to-video) so the poller can hit the correct status endpoint.
- **Operation routing:** the backend chooses the submit endpoint by the media inputs present — `audio_uri` → audio-to-video, `image_uri` → image-to-video, otherwise text-to-video.
- **Resolution strings:** resolution is sent as a native `WxH` string (e.g. `1920x1080`), not as named presets.

## Related docs

- [Media Studios](./index) — the shared render-queue/hand-off flow used by other studios.
- [Designer](./designer) — the target of every "Edit in Designer" hand-off.
- [Settings](../settings) — configuring the LTX Studio media provider.

---
> Verified against v1.0.0
