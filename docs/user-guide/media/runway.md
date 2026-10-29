# Runway

**Runway** (`/media/runway`) is a cinematic generative-video platform. Its Gen-4 family produces high-fidelity video from images and text, with strong motion control and consistent characters and scenes.

## Where to configure

Add your Runway API key in **Settings → Content → AI Media → Runway**. This is an own-key provider — there is no environment fallback.

See [Settings](../settings) for provider setup.

## Tabs

| Tab | Operation | Key fields | Output |
|---|---|---|---|
| **Image → Video** | Video | Model (Gen-4 Turbo / Gen-3 Alpha Turbo), source image, prompt, duration, ratio, seed | Video clip |
| **Text → Image** | Image | Prompt, ratio | Still image |

## Generation flow

The studio follows the standard Studio Kit flow: pick inputs, click **Generate**, track progress in the **Render Queue**, and open the finished asset in the [Designer](./designer) or the composer. See [Media Studios overview](./index.md) for details.

## Caveats

- **Image → Video requires a source image** — there is no raw text-to-video tab.
- Video jobs are async and complete via polling; Runway does not send a webhook.
- **Text → Image** runs on Runway's task API, but the studio polls internally so the result appears synchronous.
- Requests are pinned to Runway API version `2024-11-06`.
- **Test connection is free** — Settings → Content → AI Media → **Test connection** reads your organization's credit/tier info; no task is billed.

---
> Verified against v1.4.0
