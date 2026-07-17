# xAI Grok

**xAI Grok** (`/media/xai`) generates images with xAI's Aurora image model. Because it reuses the same API key as the Grok chat models, the studio becomes available automatically once the xAI LLM provider is configured.

## Where to configure

Configure xAI under **Settings → AI**. The media studio is a universal-credential surface: it reuses the org's existing Grok API key, so no separate Settings → Media config is needed. See [Settings](../settings).

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Image** | Image | Model, prompt, number of images | Still image(s) |

## Generation flow

xAI image generation is synchronous. The studio posts to the OpenAI-compatible `/v1/images/generations` endpoint, and the resulting images appear in the render queue right away. Finished assets are saved to `/files` and can be opened in the [Designer](./designer) or posted. See [Media Studios overview](./index) for the shared hand-off flow.

## Caveats

- The image API accepts only `model`, `prompt`, and `n`; size/quality/style parameters are ignored by xAI, so the form stays minimal.
- The model list is discovered live from xAI's `/image-generation-models` endpoint; if the live catalog is empty, the fallback default is `grok-2-image-1212`.
- xAI does not support video or audio generation.

## Related docs

- [Media Studios overview](./index) — the shared render-queue and hand-off flow.
- [AI Tools](../ai-tools) — the xAI Grok chat/provider configuration.
- [Settings](../settings) — configuring AI and media providers.

---
> Verified against v1.0.0
