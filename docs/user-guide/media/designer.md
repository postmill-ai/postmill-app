# Designer

The **Designer** (`/media/designer`) is Postmill's manual canvas editor, built on **Konva /
react-konva** — it is not Polotno. It's the one Platform-section tool with no header in the nav
rail, and it's the target every other studio's **Edit in Designer** button hands off to.

## Two modes

| Mode | Use | Output |
|---|---|---|
| **Static canvas** | Images, text, shapes on a single frame. | PNG / JPEG / WebP / transparent PNG / PDF / SVG. |
| **Video timeline** | Multi-track video composition. | MP4 / WebM / GIF / animated WebP. |

Animated **GIF and animated WebP export only exist in video mode** — static mode flattens the
canvas to a single frame, so those two formats aren't offered there.

A new session always opens a required **Start a design** dialog (no silent blank-canvas default):
open something from **Recent Designs** or **Templates**, or start fresh. **New Photo** lets you pick
one or more channel-preset sizes (or a **Custom size…**) — each becomes a linked output tab.
**New Video** takes one format to start; more video formats can be added later as output tabs.
Untitled designs are saved automatically on your first edit — an untouched blank canvas is never
saved.

## Formats, pages and versions

- **Output tabs** — a design can carry several formats (sizes) at once. **Add format** adds another
  size; linked elements stay in sync across formats unless you choose **Edit Format Only**.
- **Pages** — image outputs can hold multiple pages (up to 20 per output), managed in the **Pages**
  panel (add, duplicate, rename, delete). PDF export combines an output's pages into one file.
- **Versions** — **File ▸ Save Version…** snapshots the design; the **Versions** panel lists manual
  and automatic snapshots and can restore or delete them.
- **Templates** — **Save as Template** stores the current design (image or video) as a template;
  **Browse Templates…** filters templates by category and organises them into folders. Applying a
  video template switches the design to video mode (and vice versa).

## Video timeline

The timeline supports eight track types: **video, image, text, shape, paint, caption, audio, and
sticker**, up to 40 tracks, with a composition limit of **180 seconds**. Audio waveforms and video
filmstrips are drawn client-side so you can see content while trimming. Rendering runs server-side
via headless Chromium + FFmpeg.

- **Tracks** — add tracks with **+ Track**, or drag a clip below the last track to create a new one.
  Tracks can be renamed, muted, locked, and hidden. A dropped clip snaps into the nearest free gap on
  the target track; if there is no room it is rejected rather than overlapping (hold **Alt** to keep
  an intentional overlap).
- **Editing** — split at the playhead (**S**), trim, duplicate, freeze frame (**Ctrl+F**), ripple
  delete (**Shift+Delete**), multi-select (Shift-click or marquee) with copy/paste, snapping,
  timeline markers, zoom, and loop playback.
- **Transitions** — cut, fade, dissolve, slide, wipe, zoom, and blur between clips.
- **Clip inspector** — speed and speed ramps, reverse, volume (keyframable), fade in/out, auto-duck
  under voice, **Looks** presets, filters, blend modes, motion blur, Ken Burns presets, and
  per-property keyframes with a graph editor. **Animations** presets apply to text, shape, image,
  and sticker clips; text clips also get a **Typewriter** reveal. Audio clips can detect beats.
- **Captions** — **CC** auto-generates captions from every audio-bearing clip (needs a
  speech-to-text provider such as Deepgram), imports `.srt`/`.vtt` files, and exports the caption
  tracks as `.srt`.
- **AI generation** — the timeline can generate an **AI Video**, **Music**, a **Voiceover**
  (generated, or recorded with your microphone), an **Avatar** video, or a **Slideshow**, and can
  transform, upscale, remove the background of, or regenerate a segment of a selected clip. Each
  generate dialog has a **Provider:** picker: **Default** uses your workspace's media default, or
  pick a configured provider to use its compact studio inline. **AI Video → Include voiceover**
  creates a faceless product video with independent visual and narration tracks; the visual and
  voice providers can be selected separately.

## Canvas tools

Beyond layers, shapes, text, and pen/paint tools, the **Tools** menu carries the AI image
actions — **Generate Image…**, **Inpaint…**, **Remove Background**, and **Expand Image (AI)…**,
which extends an image beyond its borders (zoom out 1.5×/2×, make square, or extend left, right, up,
or down) and requires [Replicate](./replicate). The color picker supports alpha; fills include
patterns (with a noise preset) and output backgrounds can carry grain or paper textures. The font
picker includes **Upload font** for your own `.ttf`, `.otf`, or `.woff2` files (WOFF2 fonts are not
used in server-rendered exports).

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

- **Static canvas**: PNG, JPEG, transparent PNG, WebP, PDF, SVG.
- **Video timeline**: MP4, WebM, GIF, animated WebP.

Video exports also take a resolution (720p / 1080p / 4K shorthands or a free scale), frame rate,
**Platform presets** (TikTok, Reels, Shorts, YouTube), optional **Normalize loudness** (-14 LUFS /
-1.5 dBTP, the social-platform target), and a poster/thumbnail. Video renders run asynchronously;
progress shows in the dialog.

GIF and animated WebP are deliberately excluded from the static-canvas format list — a single-frame
Konva snapshot can't produce real animation, so those two only exist as video-mode exports.

Exports can save back into `/files` (with folder selection) or post directly into the composer.
After a static-canvas export, the done step also lists each exported file as a download link so you
can save a copy to your computer.

---
> Verified against v1.3.0
