# Amazon Bedrock

**Amazon Bedrock** (`/media/bedrock`) exposes AWS-managed foundation models for image generation — including Amazon Nova Canvas and Titan Image Generator — using your org's existing Bedrock AI credentials.

## Where to configure

Configure the Bedrock AI provider once under **Settings → AI**. Bedrock is a universal-credential provider, so the same AWS credentials serve both LLM and media generation; no separate **Settings → Media** entry is required. The credential form asks for **AWS Region**, **Access Key ID**, **Secret Access Key**, and an optional **Session Token**. See [Settings](../settings) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Produces |
|---|---|---|---|
| **Text → Image** | Image | Model (Nova Canvas / Titan v2), prompt, size, number of images | PNG/JPEG image(s) in `/files` |

## Generation flow

Images are generated synchronously through the AI-SDK Bedrock bridge and saved to the [Media Library](../media-library). The Render Queue card shows the result with **Edit in Designer** and **Post** hand-offs. See [Media Studios overview](./index) for the shared flow.

## Caveats

- **Image only.** The Bedrock media adapter covers Nova Canvas and Titan image models; video and audio are not exposed.
- Authentication is **SigV4** through the matching AI-SDK provider; the studio does not use a simple Bearer token.
- Models are discovered from the Bedrock AI adapter's catalog. If a model is missing from the dropdown, your AWS account may not have it enabled in the chosen region.

## Related docs

- [Media Studios overview](./index) — shared render-queue and hand-off flow.
- [Media Library](../media-library) — where finished images are saved.
- [Settings](../settings) — configuring AI providers.

---
> Verified against v1.0.0
