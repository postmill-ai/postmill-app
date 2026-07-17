# DeepInfra

**DeepInfra** (`/media/deepinfra`) is a cost-optimized inference hub for open generative models. The studio covers image, video, and text-to-speech generation through DeepInfra's native per-model inference endpoint.

## Where to configure

Configure your DeepInfra AI provider once under **Settings → AI**. DeepInfra is a universal-credential provider: the same API key drives both LLM and media generation, so no separate **Settings → Media** entry is needed. See [Settings](../settings) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Image** | Image | Model (FLUX.1 schnell/dev), prompt, width, height, steps, seed | Image(s) in `/files` |
| **Text → Video** | Video | Model (Veo 3.1 / PixVerse V6), prompt | MP4 clip in `/files` |
| **Text → Speech** | Audio | Model (Kokoro 82M), text, voice preset | Audio file in `/files` |

## Generation flow

All three tabs post to DeepInfra's synchronous `/v1/inference/{model}` endpoint. The artifact returns inline, is saved to the [Media Library](../media-library), and appears in the Render Queue with **Edit in Designer** and **Post** hand-offs. See [Media Studios overview](./index) for the shared flow.

## Caveats

- Because DeepInfra has no clean per-modality model catalog, the model dropdown uses curated lists plus a free-entry field; type any DeepInfra model path if yours is not listed.
- The adapter probes common response keys (`images`, `image`, `audio`, `video_url`, `output`) to extract the artifact. Unusual model response shapes may need adjustment against a live key.
- All operations complete synchronously; there is no webhook or background poll path.

## Related docs

- [Media Studios overview](./index) — shared render-queue and hand-off flow.
- [Media Library](../media-library) — where finished images, video, and audio are saved.
- [Settings](../settings) — configuring AI providers.

---
> Verified against v1.0.0
