# Leonardo.ai

**Leonardo.ai** (`/media/leonardo`) is a creative image-generation platform powered by its foundational Phoenix model, known for high-resolution output, coherent text, and strong prompt adherence.

## Where to configure

Configure your Leonardo.ai API key at **Settings → Media**. Postmill stores the key encrypted at rest; there is no environment-variable fallback.

See [Settings](../settings) for provider setup and the media capability matrix.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Image** | `image` | Model (Leonardo UUID), prompt, negative prompt, width, height, number of images | One or more generated images |

Available models include Leonardo Phoenix 1.0/0.9, Leonardo Lightning XL, Kino XL, Vision XL, Diffusion XL, and AlbedoBase XL. The model dropdown displays friendly names, but each maps to a Leonardo model UUID under the hood.

## Generation flow

Leonardo's API is asynchronous (create → `generationId` → poll), but the adapter polls internally so the page shows a synchronous result. The finished image(s) land in `/files` and can be opened in the [Designer](./designer) or posted from the queue card. See [Media Studios](./index) for the shared flow.

## Caveats

- **Image-only:** this provider does not generate video or audio.
- **Async-then-poll:** the Leonardo API creates a generation job and returns results on poll; the adapter handles this internally, with a bounded retry loop.
- **Multi-image output:** `Number of images` can be set from 1 to 8. When more than one image is returned, the queue card exposes the first as primary and the rest as extras.
- **Model UUIDs:** the model selector shows readable names, but the value sent to Leonardo is the underlying model UUID.

## Related docs

- [Media Studios](./index) — the shared render-queue/hand-off flow used by other studios.
- [Designer](./designer) — the target of every "Edit in Designer" hand-off.
- [Settings](../settings) — configuring the Leonardo.ai media provider.

---
> Verified against v1.0.0
