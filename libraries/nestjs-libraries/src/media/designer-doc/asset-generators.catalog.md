# Asset-generation catalog for the AI designer

> Reference for the future agent skill layer. Every row maps a capability to the
> existing service method or HTTP route that should be called, its sync/async
> nature, and its input/output shape.

| Capability | Surface | Sync / Async | Input | Output |
| --- | --- | --- | --- | --- |
| Text → image (persisted) | `POST /media/generate-image-with-prompt` | Sync (provider call is async, response waits) | `{ prompt: string }` | `{ id: string, path: string, name: string }` — a `/files` row whose `path` is a usable image `src`. |
| Text → image (raw base64) | `POST /media/generate-image` | Sync | `{ prompt: string }` | `{ output: <base64 dataUrl> }` — not persisted; use `-with-prompt` for placement. |
| Remove background | `AiMediaService.removeBackground` (`ai/governance/media.service.ts:200`) | Sync | `{ url: string }` | `{ url: string }` to a processed image; ingest via `FileService.importFromUrl`. |
| Upscale image | `AiMediaService.upscaleImage` | Sync | `{ url: string }` | `{ url: string }` |
| Inpaint image | `AiMediaService.inpaintImage` | Sync | `{ url: string, mask: string, prompt: string }` | `{ url: string }` |
| Detect focal point | `AiMediaService.detectFocalPoint` | Sync | `{ url: string }` | `{ x: number, y: number }` |
| Text → speech | `AiMediaService.textToSpeech` | Sync | `{ text: string, voiceId?: string }` | Audio bytes / URL; ingest via `FileService.importFromUrl`. |
| Text → video | `MediaStudioService.generate` (studio kit) | Async (webhook-first, poll fallback) | `{ provider, operation:'video', model?, prompt, input? }` | `AIMediaJob` id; poll `/media/studio/:provider/jobs`. |
| Image → video | `MediaStudioService.generate` | Async | `{ provider, operation:'video', model?, mediaInputs:{image:fileId}, input? }` | `AIMediaJob` id |
| Audio → video / talking video | `MediaStudioService.generate` (avatar studios) | Async | `{ provider, operation:'video', mediaInputs:{audio?:fileId, image?:fileId} }` | `AIMediaJob` id |
| Text → image (hub) | `MediaStudioService.generate` | Sync | `{ provider, operation:'image', model, prompt, input? }` | `File` row via inline completion. |
| Text → music | `MediaStudioService.generate` (Suno) | Async | `{ provider:'suno', operation:'audio', prompt, input? }` | `AIMediaJob` id; yields MP3 `/files`. |
| Video → captions | `DeepgramService.transcribe` (`/media/deepgram/transcribe`) | Sync | `{ fileId: string }` (source video) | `{ text: string, words: WordTiming[], segments: PhraseSegment[] }` |
| Place an asset into a doc | `DesignService.placeAsset` | Sync | `{ orgId, doc, url, outputIndex, name?, box? }` | `{ doc: DesignerDoc, fileId: string }` — the returned `doc` contains a renderable `image` element with `src = file.path` and `fileId`. |
| Import any public URL to `/files` | `FileService.importFromUrl(orgId, { url, name, folderId?, source?, attribution? })` | Sync | `{ url, name, ... }` | `File` row `{ id, path, ... }` — SSRF-safe, MIME-allowlisted, quota-checked. |
| Persist a buffer as a `/files` row | `StorageService.getLocalAdapterForOrg(orgId, true).writeBuffer(buffer, mime)` then `FileService.saveFile(orgId, fileName, path, fileName)` | Sync | `Buffer`, MIME type | `File` row — used for image-preview persistence. |

## Usage notes for the agent skill

- For **text-to-image** that must be placed in a design, always prefer
  `/media/generate-image-with-prompt` because its returned `path` is a managed,
  servable `src`.
- For **stock or third-party URLs**, route through `DesignService.placeAsset` (or
  `FileService.importFromUrl` first, then `placeAsset`) so the file is owned by
  the org and the element carries both `src` (renders) and `fileId` (library
  link).
- For **long-running media generation** (video, music), create a job and poll the
  studio jobs endpoint; the artifact lands in `/files` and can then be placed.
- For **captions**, `DeepgramService.transcribe` reads the source file bytes
  directly from storage, so it works for both local and cloud storage backends.
