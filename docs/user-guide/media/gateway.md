# Vercel AI

**Vercel AI Gateway** (`/media/gateway`) routes image and video generation through Vercel's unified gateway, giving you access to hundreds of models behind a single API key with automatic provider failover.

## Where to configure

Configure the Vercel AI Gateway provider once under **Settings → AI**. Gateway is a universal-credential provider, so the same API key drives both LLM and media generation; no separate **Settings → Media** entry is needed. See [Settings](../settings) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Image** | Image | Model (discovered live), prompt, size, number of images | Image(s) in `/files` |
| **Text → Video** | Video | Model (discovered live), prompt, duration, aspect ratio | MP4 clip in `/files` |
| **Image → Video** | Video | Source image, model, prompt, duration | MP4 clip in `/files` |

## Generation flow

Images are delegated to the matching AI-SDK provider and complete synchronously. Video uses AI SDK v6's experimental `generateVideo` and is also completed inline, with the Undici timeout extended to 15 minutes to accommodate long renders. Finished artifacts land in the [Media Library](../media-library) and appear in the Render Queue with **Edit in Designer** and **Post** hand-offs. See [Media Studios overview](./index) for the shared flow.

## Caveats

- Models are discovered live from the Gateway catalog (`/v1/models`) and filtered by modality. If the catalog call fails, the dropdown falls back to the descriptor's defaults plus free entry.
- **Video is synchronous and long-running**; large renders are rejected before base64 inflation if they would exceed the 512 MB artifact limit.
- **Audio/speech is not exposed** by the Gateway AI-SDK provider, so the studio offers image and video only.

## Related docs

- [Media Studios overview](./index) — shared render-queue and hand-off flow.
- [Media Library](../media-library) — where finished images and video are saved.
- [Settings](../settings) — configuring AI providers.

---
> Verified against v1.0.0
