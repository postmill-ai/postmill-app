# Deepgram

**Deepgram** (`/media/deepgram`) is a bespoke, non-generation studio. It transcribes speech in an
audio or video file from your [Media Library](../media-library) into text, word timings, and
caption segments. It does not produce an image/video/audio artifact, so it does not follow the
standard [Studio Kit](./index) generation flow.

Configure your Deepgram API key at **Settings → Media**. There is no environment-variable fallback;
if the provider is not configured, the studio shows the standard "isn't configured" empty state.

## Pick a source

1. Click **Pick audio / video** and choose a file already in `/files`.
2. The source must be a library file (the backend needs a `fileId`). External URLs are not accepted.
3. Accepted containers/extensions include `mp3`, `m4a`, `aac`, `wav`, `ogg`, `flac`, `webm`, `mp4`,
   `mov`, and `m4v`.

## Transcription options

- **Model** — `nova-2` (default), `nova-3`, or `whisper`.
- **Language** — optional BCP-47 code (for example `en`, `es`, `de`). Leave blank to let Deepgram
  auto-detect.

## How transcription works

When you click **Transcribe**, the backend reads the source file's **bytes directly from storage**
(local or cloud adapter). The audio never leaves the deployment as an outbound HTTP URL, so there is
no SSRF surface for this step.

The request is sent to Deepgram's `/v1/listen` endpoint. Smart formatting and punctuation are
enabled by default; a language code is passed only when you supply one. Sources larger than
**250 MB** are rejected before transcription starts.

The response returned to the panel is:

```json
{
  "text": "the full transcript",
  "words": [{ "word": "the", "start": 0.12, "end": 0.18 }, ...],
  "segments": [{ "start": 0.12, "end": 2.45, "text": "the full transcript" }, ...]
}
```

`segments` are phrase-chunked on sentence-ending punctuation or after 12 words, matching the
grouping used by the [Designer](./designer) timeline's auto-caption feature.

## After transcribing

The result panel shows an editable transcript and a timecoded segment list. The action bar offers:

- **Copy** — copy the transcript text.
- **Download .srt** / **Download .vtt** / **Download .txt** — client-side exports; nothing is
  written to `/files`.
- **Save to Files** — persists the transcript as a completed `stt` `AIMediaJob` via
  `POST /media/deepgram/save-transcript`. Because it is created already complete, it never enters
  the async poll path. In the render queue it appears as a **text card** with **Copy** and
  **To composer** buttons only — no preview, no Edit-in-Designer/Post handoff.
- **Send to composer** — opens the composer pre-filled with the transcript text.
- **Edit in Designer** — for a **video** source, stashes `{ url, fileId, width, height, words }` and
  opens `/media/designer?captions=1`. The Designer builds a video project from the clip and burns
  in a caption track from the word timings, with no re-transcription. For an **audio** source, the
  clip is opened directly on the timeline's audio track instead.

## Related docs

- [Media Studios](./index) — where this studio fits relative to the standard generation flow.
- [Designer](./designer) — manual canvas and video timeline editor.
- [Media Library](../media-library) — `/files` upload and folder management.
- [Settings](../settings) — configuring the Deepgram media provider.

---

> Verified against v1.0.0
