# MiniMax

**MiniMax** (`/media/minimax`) runs Hailuo, MiniMax's AI video generator, known for cinematic motion and strong prompt following from text or a single image. It also supports character-consistent subject-reference video and prompt-optimizer refinement.

## Where to configure

Configure your MiniMax API key in **Settings → Media**. The studio needs a paid MiniMax API key; there is no environment-variable fallback. See [Settings](../settings.md) for provider setup.

## Tabs / operations

| Tab | Operation | Key fields | Output |
|---|---|---|---|
| **Text → Video** | Video | Model (`video-01` or `T2V-01-Director`), prompt, prompt optimizer toggle | MP4 video clip |
| **Image → Video** | Video | Model (`I2V-01`, `I2V-01-Director`, or `I2V-01-live`), source image, prompt, prompt optimizer toggle | MP4 video clip |
| **Subject Reference** | Video | Subject image, prompt, prompt optimizer toggle (fixed `S2V-01` model) | MP4 video keeping the reference character consistent |

The **Director** models accept camera-direction tokens such as `[Pan left]` or `[Zoom in]` in the prompt.

## Generation flow

Video jobs submit to MiniMax and appear in the **Render Queue**. When a job completes, the artifact is saved to `/files`, where you can **Edit in Designer** or **Post** it. See [Media Studios overview](./index.md) for the shared flow.

## Caveats

- All three tabs produce **video**; generations are asynchronous and complete via polling.
- The **Subject Reference** tab's `subject_image` field is folded into MiniMax's `subject_reference` array by the adapter.
- MiniMax returns a `task_id`, then a separate `file_id` once rendering succeeds; the adapter handles the extra retrieve step before the final download URL is available.
- Native parameters such as `prompt_optimizer` ride straight through to the provider request body.

---
> Verified against v1.0.0
