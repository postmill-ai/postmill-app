# OpenRouter

**OpenRouter** (`/media/openrouter`) is a unified gateway to image models from many providers through a single OpenRouter API key. The studio exposes one text-to-image tab and discovers available image models live.

## Where to configure

Configure your OpenRouter API key in **Settings → AI**. The media studio reuses the same OpenRouter LLM credential (universal-credential reuse), so configuring it once enables both AI chat and image generation. See [Settings](../settings.md) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Output |
|---|---|---|---|
| **Text → Image** | Image | Model (searchable combobox populated from OpenRouter's live catalog), prompt, number of images, aspect ratio, resolution, output format, optional seed | Still image(s) |

## Generation flow

Image generation is synchronous. The finished image lands in `/files` via the **Render Queue**, where you can **Edit in Designer** or **Post**. See [Media Studios overview](./index.md) for the shared flow.

## Caveats

- **Image only** — OpenRouter does not expose video or audio generation through this studio.
- The model picker is populated live from `GET /api/v1/models`, filtered to models that advertise image output. If the live catalog fails or a model is missing, the picker falls back to a static list and still allows you to type a model id directly.
- Generation uses OpenRouter's dedicated `POST /api/v1/images` endpoint, which returns `b64_json` data. Each request waits up to 120 seconds (slow models such as `gpt-image-1` often need over a minute); a timeout or upstream failure is reported as an OpenRouter error naming the cause.
- Because the credential is shared with the LLM provider, the studio is marked configured as soon as the OpenRouter AI key is present and enabled; disabling the key under **Settings → AI** also switches the studio off.
- **Test connection is free** — Settings → Content → AI Media → **Test connection** reads the OpenRouter model catalog; no image is billed.
- The studio itself is text-to-image only. When OpenRouter is your workspace's **image-to-image** model default, [AI Designer](./ai-designer.md) can condition generation on a reference image — supported for the Gemini image models (e.g. `google/gemini-2.5-flash-image`), sent through OpenRouter's chat-completions endpoint; other models fall back to text-to-image.

## Related docs

- [Media Studios overview](./index.md) — shared render-queue and hand-off flow.
- [Settings](../settings.md) — configuring AI and media providers.

---
> Verified against v1.4.0
