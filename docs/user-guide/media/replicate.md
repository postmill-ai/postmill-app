# Replicate

**Replicate** (`/media/replicate`) is a bespoke, native generative media workspace — not built on
the generic Studio Kit — that runs models on [Replicate](https://replicate.com) using your own API
token. It covers 19 generation categories across image, video, and audio in one page, plus a
speech-to-text mode and two native editors (mask painting, video merge) and a canvas meme tool.

## Categories

| Category | Medium | Execution | Typical use |
|---|---|---|---|
| Text to Image | Image | Sync | Generate photos, illustrations, or concept art from a prompt. |
| Image to Image | Image | Sync | Transform or restyle an existing image. |
| Remove Background | Image | Sync | Remove the background of an image. |
| Upscale | Image | Sync | Increase resolution of an existing image. |
| Restore | Image | Async | Restore an old or degraded photo. |
| Inpaint | Image | Sync | Edit a painted region of an image with a mask. |
| Meme Generator | Image | Local (canvas) | Add draggable text layers to an image and export a PNG. |
| Text to Video | Video | Async | Generate a video from a prompt. |
| Image to Video | Video | Async | Animate an existing image into a video. |
| Video to Video | Video | Async | Transform an existing video with a style or effect. |
| Video Upscale | Video | Async | Increase resolution of an existing video. |
| Video Background | Video | Async | Remove/replace a video's background (matting). |
| Caption Video | Video | Async | Add burned-in captions/subtitles to a video. |
| Merge Videos | Video | Local (server-side ffmpeg) | Combine up to 6 clips with transitions into one MP4. |
| Text to Speech | Audio | Async | Convert text to spoken audio. |
| Text to Music | Audio | Async | Generate music from a prompt. |
| Music to Music | Audio | Async | Transform or extend an existing music clip. |
| Voice Clone | Audio | Async | Clone a voice from a short audio sample. |
| Speech to Text | Audio → Text | Sync | Transcribe an audio file to text. |

Every run uses the org's own Replicate token, configured in **Settings → Media**. The category and
model allowlist is curated server-side — Replicate hosts far more models than are exposed here.

---

## Warm vs community models and cost badges

Each category lists **warm** official models by default. Warm models are pre-loaded by Replicate
and start faster; the cost shown in the badge is fixed per run.

- **Warm** models are output-priced — the cost bar shows a fixed estimate before you click
  **Generate**.
- **Community** models are priced by compute time. Turn on the **Show community models** toggle to
  see them; they may cold-start, and the cost bar shows a usage-based estimate instead.

Select a model to reveal its dynamic input form, generated from the model's own schema. Required
fields are marked; optional fields can be left at their defaults.

---

## Save-folder requirement for async jobs

Every category marked **Async** above runs in the background. Before generating, choose a **Save
folder** in the Files library — the finished asset imports into that folder automatically when the
job completes. If no folder is selected, **Generate** stays disabled.

**Sync** categories (image generations, plus Speech to Text) complete immediately. If Replicate
ends up queuing a sync prediction anyway, the studio silently falls back to registering an async
job and polling until completion — the same save-folder rule applies.

---

## Speech to Text — Copy + Download only

**Speech to Text** runs synchronously and returns the transcript inline. You can:

- **Copy** the full text to the clipboard.
- **Download** the transcript as `.txt` or `.srt`.

Transcripts are not saved to Files and do not consume media credits.

---

## Inpaint mask painter

The inpaint workflow has two inputs:

1. **Source image** — pick an image from Files or provide a public `https` URL.
2. **Mask** — paint over the area you want to change with the brush tool. Use the eraser to refine.
   The exported mask is a black-and-white PNG where white pixels are the region to regenerate.

Adjust the brush size, then click **Use this mask** to return to the generation form. The source
and mask are sent together to the selected inpainting model.

---

## Video merge

The merge editor combines up to 6 clips into one MP4:

1. Click **Add clip** and choose a video from Files or paste a public `https` URL.
2. Re-order clips by dragging the list items.
3. Pick a transition and duration for each gap between clips.
4. Select a save folder and click **Merge**.

The job runs server-side via ffmpeg. When it completes, the merged video appears in the selected
Files folder and can be opened directly from the result panel.

---

## Meme generator

The meme editor is a native canvas tool:

1. Pick a base image from Files or a public `https` URL.
2. Add draggable text layers, each with its own font, size, color, outline, and style
   (bold/italic).
3. Drag text to position it on the canvas.
4. Click **Export** to save the meme as a PNG to Files, then **Open in Designer** to refine it
   further.

---

## Related docs

- [Media Studios](./index) — the shared render-queue/hand-off flow used by other studios.
- [Media Library](../media-library) — folder tree, uploads, and storage routing.
- [AI Tools](../ai-tools) — text generation, brand voice, and spend controls.
- [Settings](../settings) — configuring the Replicate media provider.

---
> Verified against v1.0.0
