# Designer

The **Designer** (`/media/designer`) is Postmill's manual canvas editor, built on **Konva /
react-konva** — it is not Polotno. It's the one Platform-section tool with no header in the nav
rail, and it's the target every other studio's **Edit in Designer** button hands off to.

## Two modes

| Mode | Use | Output |
|---|---|---|
| **Static canvas** | Images, text, shapes on a single frame. | PNG / JPEG / WebP / transparent PNG / PDF. |
| **Video timeline** | Multi-track video composition. | MP4 / WebM / GIF / animated WebP. |

Animated **GIF and animated WebP export only exist in video mode** — static mode flattens the
canvas to a single frame, so those two formats aren't offered there.

A new session always opens a required start dialog (no silent blank-canvas default): choose
**Open** (an existing design or template) or **New**, and for New, pick image or video mode plus
one or more channel-preset sizes (or a custom size).

## Video timeline tracks

The video timeline supports six track types: **video, image, text, caption, audio, and sticker**.
Audio waveforms are decoded client-side (canvas) so you can see levels while trimming. Rendering
runs server-side via headless Chromium + FFmpeg.

## Opening the Designer

The Designer accepts a few different entry points, all via the `/media/designer` route:

| Entry point | How it arrives | What loads |
|---|---|---|
| **Single asset** | `?url=&type=&w=&h=` query params (from a studio's Edit in Designer, or a stock browser's Open in Designer). | An image drops onto the static canvas as a thumbnail; audio/video route to the timeline handoff below. |
| **Bulk handoff** | Files → select multiple → **Open all in Designer** stashes the selection in `sessionStorage` and navigates to `?bulk=1`. | All selected assets load onto the static canvas at once. |
| **Timeline handoff** | Any studio's render-queue **Edit in Designer** for audio/video stashes `{ type, url, fileId }` in `sessionStorage` and opens `?timeline=1`. | The asset loads directly onto the video timeline. |
| **Caption handoff** | [Deepgram](./deepgram)'s **Edit in Designer** button (video sources only) stashes `{ url, fileId, width, height, words }` and opens `?captions=1`. | The video loads onto the timeline **and** a caption track is built from the word timings — no re-transcription. |

The caption handoff is the only path (together with the general timeline handoff) that puts a real
video clip on the timeline from a URL — a plain `?url=&type=video` single-asset open only drops a
static thumbnail, not a timeline clip.

## Menu bar and shortcuts

The full action set — file, edit, insert, format, and export commands — lives in one registry that
drives both the top menu bar and the `⌘K` command palette, so every action is reachable both ways.
Keyboard shortcuts are scoped to canvas focus. On mobile, the menu bar collapses to four grouped
menus plus a `☰` overflow.

## Exporting

The **Export** dialog offers different formats per mode:

- **Static canvas**: PNG, JPEG, transparent PNG, WebP, PDF.
- **Video timeline**: MP4, WebM, GIF, animated WebP.

GIF and animated WebP are deliberately excluded from the static-canvas format list — a single-frame
Konva snapshot can't produce real animation, so those two only exist as video-mode exports.

Exports can save back into `/files` (with folder selection) or post directly into the composer.

---
> Verified against v1.0.0
