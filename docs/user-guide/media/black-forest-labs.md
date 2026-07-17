# Black Forest Labs

**Black Forest Labs** (`/media/black-forest-labs`) is the Studio Kit interface to the FLUX model family — a frontier image lab known for state-of-the-art photorealism, precise prompt control, and production-grade character and style consistency.

## Where to configure

Configure your Black Forest Labs API key at **Settings → Media**. Postmill stores the key encrypted at rest; there is no environment-variable fallback.

See [Settings](../settings) for provider setup and the media capability matrix.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Image** | `image` | Prompt, model, width/height, aspect ratio (Ultra only), output format, prompt upsampling, safety tolerance, seed | A single FLUX still image |

Available models include FLUX 1.1 Pro, FLUX 1.1 Pro Ultra, FLUX Pro, and FLUX Dev. **FLUX 1.1 Pro Ultra** ignores width/height and uses the dedicated **Aspect ratio (Ultra)** field instead.

## Generation flow

After you click **Generate**, the image is produced synchronously (the adapter polls the Black Forest Labs submit internally) and lands directly in `/files`. From there you can open it in the [Designer](./designer) or pre-fill it in the composer via **Post**. See [Media Studios](./index) for the shared flow.

## Caveats

- **Image-only:** this provider does not generate video or audio.
- **Synchronous contract:** FLUX generation is submit-and-poll under the hood, but the page waits for the result so the card appears in the render queue as completed.
- **Model-specific sizing:** width and height are applied to all models except FLUX 1.1 Pro Ultra, which uses its own aspect-ratio control.
- **Safety tolerance:** the 0–6 slider maps to FLUX's native moderation setting.

## Related docs

- [Media Studios](./index) — the shared render-queue/hand-off flow used by other studios.
- [Designer](./designer) — the target of every "Edit in Designer" hand-off.
- [Settings](../settings) — configuring the Black Forest Labs media provider.

---
> Verified against v1.0.0
