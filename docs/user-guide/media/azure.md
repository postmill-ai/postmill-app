# Azure OpenAI

**Azure OpenAI** (`/media/azure`) brings Microsoft Azure's managed OpenAI service into Postmill, letting you generate images with DALL·E and gpt-image deployments through Azure's enterprise AI infrastructure.

## Where to configure

Configure your Azure AI provider once under **Settings → AI**. Azure is a universal-credential provider: the same key drives both the LLM and media studio, so you do not need a separate **Settings → Media** entry. The credential asks for your **API Key**, **Resource Name**, and an optional **API Version**. See [Settings](../settings) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Image** | Image | Deployment (DALL·E 3 / gpt-image-1), prompt, size, number of images | PNG/WebP image(s) in `/files` |

## Generation flow

The studio posts the job through the shared Studio Kit pipeline. Completed images land in the [Media Library](../media-library) and appear in the Render Queue, where you can **Edit in Designer** or **Post** them. See [Media Studios overview](./index) for the common hand-off flow.

## Caveats

- **Image only.** Azure's AI-SDK bridge currently handles image generation; video and audio are not exposed.
- The **model dropdown shows Azure deployment names**, not raw OpenAI model ids. Enter your deployment name if it differs from the curated defaults.
- Output is returned synchronously through the AI-SDK bridge, so image jobs complete inline rather than through a background poll.

## Related docs

- [Media Studios overview](./index) — shared render-queue and hand-off flow.
- [Media Library](../media-library) — where finished images are saved.
- [Settings](../settings) — configuring AI providers.

---
> Verified against v1.0.0
