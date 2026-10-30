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
- **Design files** — **File ▸ Export .pdesign…** bundles the *saved* design and all its assets into
  a portable `.pdesign` file (an async job; save the design first) and downloads it. **File ▸ Import
  Design File…** — or **Import .pdesign** in the Start a design dialog — opens a `.pdesign` or raw
  `.json` design file as a **new** design.

## Video timeline

The timeline supports eight track types: **video, image, text, shape, paint, caption, audio, and
sticker**, up to 40 tracks, with a composition limit of **180 seconds**. Audio waveforms and video
filmstrips are drawn client-side so you can see content while trimming. Rendering runs server-side
via headless Chromium + FFmpeg.

- **Tracks** — add tracks with **+ Track**, or drag a clip below the last track to create a new one.
  Tracks can be renamed, muted, locked, and hidden. A dropped clip snaps into the nearest free gap on
  the target track; if there is no room it is rejected rather than overlapping (hold **Alt** to keep
  an intentional overlap).
- **Editing** — use the transport's **Split clip**, **Duplicate clip**, and **Delete clip** icons,
  or split at the playhead (**S**), trim, freeze frame (**Ctrl+F**), and ripple delete
  (**Shift+Delete**). Split is enabled only inside a selected, unlocked clip with room on both
  sides. The duration stepper beside the timecode sets 1–180 seconds. Multi-select (Shift/Ctrl/Cmd-click
  or marquee, on both canvas and timeline), copy/paste, timeline markers, zoom, and loop playback are
  also available. Canvas drag, resize, rotation, arrow-key nudge, and Delete apply to all selected
  visible clips as one undo step. **Ctrl/Cmd+G** groups selected clips and **Ctrl/Cmd+Shift+G** ungroups
  them; grouped members select and move together, stay grouped after save/reload, and keep their
  relative layout when another format is added. Locked tracks cannot be moved or deleted.
- **Transitions** — cut, fade, dissolve, slide, wipe, zoom, and blur between clips.
- **Clip inspector** — speed and speed ramps, reverse, volume (keyframable), fade in/out, auto-duck
  under voice, **Looks** presets, filters, blend modes, motion blur, Ken Burns presets, and
  per-property keyframes with a graph editor. Image clips can be replaced through the media picker
  or have their background removed when a provider is configured. Shape clips have uniform or
  per-corner radius controls; text clips have Normal, Bold, Italic, and Bold Italic styles.
  **Animations** presets apply to text, shape, image, and sticker clips; text clips also get a
  **Typewriter** reveal. Audio clips can detect beats.
- **Captions** — **CC** auto-generates captions from every audio-bearing clip (needs a
  speech-to-text provider such as Deepgram), imports `.srt`/`.vtt` files, and exports the caption
  tracks as `.srt`.
- **AI generation** — the timeline can generate an **AI Video**, **Music**, a **Voiceover**
  (generated, or recorded with your microphone), an **Avatar** video, or a **Slideshow**, and can
  transform, upscale, remove the background of, or regenerate a segment of a selected clip. Each
  generate dialog has a **Provider:** picker: **Default** uses your workspace's media default, or
  pick a configured provider to use its compact studio inline. **AI Video → Include voiceover
  (faceless video)** creates a faceless product video with independent visual and narration tracks;
  the visual provider and the **Voice provider:** (any TTS-capable provider) are selected separately,
  and the narration lands as its own editable audio clip. A generated video is placed paused — press
  **Play** to start playback.
- **Video background removal** — the clip inspector's **Background removal** section and the
  timeline clip menu's **Remove background** submenu offer three choices: **White background**
  (`lucataco/rembg-video`, general object segmentation — products, pets), **Green screen**
  (`arielreplicate/robust_video_matting`, people only), or **Auto (org default)**, which uses the
  model pinned under **Settings → Content → Media Defaults** (falling back to `rembg-video`). The
  clip is replaced with the background-free render when the job finishes; both models run on
  [Replicate](./replicate), and any other model id is rejected server-side.

### AI Video character references

The **Character references** tray holds up to three ordered images. References are saved with the
video design and reused across scene generations. Once the design has content, they persist across
save/reload, and `.pdesign` export/import carries the images and remaps them in the imported design.
A blank design containing only references is not auto-created.

Provider support is specific:

- **MiniMax S2V-01 Subject Reference** uses the first image.
- **Replicate `google/veo-3.1`** sends the ordered images as `reference_images`; 16:9 and 8 seconds
  are required.
- **ElevenLabs Veo 3.1 Fast/Quality** sends the ordered images as subject references
  `reference_image_1..3`; 8 seconds is required and start/end frames cannot be combined with them.

**Default** fallback and first-frame-only providers do not use saved character references, and the
dialog says so. A first frame is source conditioning, not an equivalent character reference;
references do not guarantee consistency.

## Canvas tools

Beyond layers, shapes, text, and pen/paint tools, the **Tools** menu carries the AI image
actions — **Generate Image…**, **Inpaint…**, **Remove Background**, and **Expand Image (AI)…**,
which extends an image beyond its borders (zoom out 1.5×/2×, make square, or extend left, right, up,
or down) and requires [Replicate](./replicate). The color picker supports alpha; fills include
patterns (with a noise preset) and output backgrounds can carry grain or paper textures. The font
picker includes **Upload font** for one or more of your own `.ttf`, `.otf`, or `.woff2` files.
Batch uploads continue past individual failures and report partial success; WOFF2 fonts are not
used in server-rendered exports.

**Crop** works on both images and visual timeline clips, through canvas handles or the Inspector's
inset sliders. Cropping keeps the selected pixels' aspect ratio. **Cover** fills the frame and crops
around the adjustable focal point, **Fit** letterboxes without cropping, and **Fill** stretches;
video and image clips default to Cover when no fit was saved. Image backgrounds, thumbnails, SVG,
and video exports use the same crop and focal-point geometry as the canvas.

## Opening the Designer

The Designer accepts a few different entry points, all via the `/media/designer` route:

| Entry point | How it arrives | What loads |
|---|---|---|
| **Single asset** | `?url=&type=&w=&h=` query params (from a studio's Edit in Designer, or a stock browser's Open in Designer). | An image drops onto the static canvas as a thumbnail; audio/video route to the timeline handoff below. |
| **Bulk handoff** | Files → select multiple → **Open all in Designer** stashes the selection in `sessionStorage` and navigates to `?bulk=1`. | All selected assets load onto the static canvas at once. |
| **Timeline handoff** | Any studio's render-queue **Edit in Designer** for audio/video. Same-tab opens stash `{ type, url, fileId, width, height, durationMs }` in `sessionStorage` and open `?timeline=1`; new-tab opens (the render-queue default) stash it in `localStorage` under a one-time id that expires after 5 minutes and open `?timeline=1&handoff=<id>`. If storage is unavailable the payload rides as `mediaType`/`mediaUrl` query params instead. | The asset loads directly onto the video timeline. |
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
-1.5 dBTP, the social-platform target), and a poster/thumbnail. Upload a custom image or choose
**Use current timeline frame** to capture the paused playhead; without a frame choice, the midpoint
is used. After rendering, you can switch between the generated and custom poster, and the choice is
saved to the rendered file in Files. Video renders run asynchronously; progress shows in the dialog.

GIF and animated WebP are deliberately excluded from the static-canvas format list — a single-frame
Konva snapshot can't produce real animation, so those two only exist as video-mode exports.

Exports can save back into `/files` (with folder selection) or post directly into the composer.
After a static-canvas export, the done step also lists each exported file as a download link so you
can save a copy to your computer.

---
> Verified against v1.4.0
