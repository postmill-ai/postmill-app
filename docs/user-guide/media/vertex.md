# Google Vertex

**Google Vertex** (`/media/vertex`) is the enterprise GCP path to Google's generative media models — Veo for text-to-video and Imagen for text-to-image. Its tagline is *“Enterprise generative media on Google Cloud.”*

## Where to configure

Configure under **Settings → Media**. Vertex uses **GCP service-account credentials**, not a single API key. You must provide:

- GCP Project ID
- GCP Location (e.g. `us-central1`)
- GCP Service Account JSON

Postmill mints a short-lived OAuth token from the service-account JSON on every request. The same three fields are used by the AI Vertex adapter. See [Settings](../settings).

## Tabs / operations

| Tab | Operation | Output | Key fields |
|---|---|---|---|
| **Text → Video** | Video | Veo video clip | Model (Veo 2 / Veo 3 / Veo 3 Fast), prompt, negative prompt, aspect ratio, duration. |
| **Text → Image** | Image | Imagen image | Model (Imagen 3 / Imagen 3 Fast), prompt, negative prompt, aspect ratio, number of images. |

## Generation flow

**Text → Image** completes **synchronously** and appears immediately. **Text → Video** is **asynchronous** and tracks through the Render Queue until Veo finishes. Completed artifacts are saved to `/files` and can be opened in the [Designer](./index.md) or pre-filled in a post. For the shared flow, see [Media Studios overview](./index.md).

## Caveats

- Vertex has **no completion webhook** for Veo; jobs finish via the `media-jobs-poll` cron.
- The service-account JSON must have access to the Vertex AI scope. Invalid JSON, missing project, or `invalid_grant` are treated as terminal config errors.
- If Veo returns a `gs://` URI, Postmill downloads it with the minted token and inlines the video as a data URL so it can be imported safely.

## Related docs

- [Media Studios overview](./index)
- [Media Library](../media-library)
- [Settings](../settings)

---
> Verified against v1.0.0
