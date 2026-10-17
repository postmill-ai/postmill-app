# Video rendering (developer view)

Local video compute for the Designer timeline and clip-merge: a request enqueues a render
job, an Inngest function (concurrency-capped) runs it either in-process (Chromium +
FFmpeg) or in a resource-capped Podman container, and the artifact lands in org storage
with one `video_export` credit charged. Sibling docs: `agents/backend.md`,
`agents/frontend.md`, `agents/jobs.md`, `agents/billing.md`.

## Two render ops

| Op | Job marker | What it does | Entry |
|---|---|---|---|
| `design` | `provider = 'chromium-ffmpeg'` | Encodes a Designer timeline composition (headless Chromium frame capture → FFmpeg) to mp4/webm/gif/animated-webp + thumbnail | `POST /design/render-video` → `VideoRenderService.enqueueRender` |
| `merge` | `model = 'local/ffmpeg-merge'` | FFmpeg trim + xfade merge of stored clips | Replicate-studio clip-merge flow → `ReplicateRunnerService` (~line 450) resolves clips host-side into the workdir, then `VideoRenderService.enqueueMerge` |

## Job flow

1. **HTTP entry** — `apps/backend/src/api/routes/design.controller.ts`:
   `POST /design/render-video` gated by `@CheckPolicies(Create MEDIA, Create VIDEO_EXPORTS)`
   (billing; the `VIDEO_EXPORTS` check counts used credits **plus in-flight renders**) and
   `@RequirePermission('media', 'create')`. Status polling: `GET /design/render-video/:jobId`
   (org-scoped `getJob` — a foreign job id returns null, not data). While a job is
   `processing`, the endpoint reads the real frame-capture progress
   (`video-render:progress:<jobId>`) and returns a true percent; the static 50 midpoint
   remains only as the fallback before the first report lands.
2. **Enqueue** — `libraries/nestjs-libraries/src/media/design-render/video-render.service.ts`
   (`VideoRenderService`):
   - Validates the composition: **180 s duration cap** (`MAX_DURATION_MS`, lockstep with
     `MAX_VIDEO_DURATION_MS` in `media/designer-doc/designer-doc.limits.ts` and the
     frontend store clamp — enforced by `designer-doc.drift.spec.ts`),
     `validateVideoComposition` bounds
     (dims ≤ `MAX_DIMENSION`, fps ≤ 240, `MAX_TRACKS`, `MAX_CLIPS_PER_TRACK` from
     `media/designer-doc/designer-doc.limits.ts`) — a resource-DoS guard on input that
     drives Puppeteer/FFmpeg. The bounds apply to the EFFECTIVE render: the optional
     `scale` (0.5|1|2, resolution multiplier) and `fps` (24|30|60 override) DTO fields
     are folded into the composition copy before validation, and ride the payload +
     `DesignRenderJobSpec.options.scale` through to the encoder. The stored document is
     never mutated; on the render-route path the overrides reach the frame page as
     clamped `scale`/`fps` query params (`renderScale` on the served composition copy).
   - Track-level `muted` (audio tracks) is honored by both the preview engine and the
     FFmpeg mixer — a muted track's clips contribute nothing, not even to the ducking
     sidechain.
   - Clip `volume` is keyframable: keyframes REPLACE the base volume where they span
     (both sides evaluate the shared `volumeAtClipTime`), and the mixer bakes the
     eased curve into `volume='<expr>':eval=frame` sampled at 100 ms steps
     (`design-render/volume-envelope.ts`) — fades stay separate downstream afade
     filters in both engines.
   - Speed (`clip.speed`) is pitch-preserving on both sides: the preview sets
     `playbackRate` with `preservesPitch`/`webkitPreservesPitch`, and the mixer's
     `atempo` is likewise pitch-preserving, so preview and export audio match.
   - Speed ramping (`clip.speedCurve`, optional-additive on doc v7): ≥2
     piecewise-linear `{atMs, speed}` points (atMs relative to the clip's
     TIMELINE start, speeds 0.1–10) REPLACE the constant `speed` in the
     playhead→source mapping — the source time is the integral of the curve
     (trapezoid areas), evaluated by ONE shared module,
     `media/designer-doc/speed-curve.ts` (`sourceTimeForClipTime` /
     `clipTimeForSourceTime` / `sourceTimeForPlayhead`). The preview imports
     it; the frame page is handed it as source (`speedCurveSource()`, injected
     like `keyframesSource`) — a spec pins the injected copy to the module and
     forbids a hand-written `sourceTimeForPlayhead` in the frame script (the
     old mirror had drifted: it never froze a `speed:0` clip). Reverse consumes
     the window from the tail (mirror of the curve time), `speed:0` freeze
     clips ignore the curve. In the editor the clip's timeline length is
     DERIVED from the curve — editing points keeps the consumed source window
     fixed and recomputes `endMs` through the inverse mapping, clamped inside
     the composition (never extends the output). Splitting a ramped clip
     splits the curve at the cut (`splitSpeedCurveForClip`): each side keeps
     the points for the source window it plays, re-based, with trim-in fixed
     for continuity (reversed clips mirror — the second half keeps the
     original trim-in).
   - Ramped AUDIO is approximated: `mixAudio` keeps the constant-rate
     atrim/atempo chain but feeds it the curve's integrated source window and
     the clip's AVERAGE speed (`averageSpeedForClip`), logging a warn per
     ramped clip; the preview plays ramped audio elements at the same average.
     Variable-tempo audio is a separate project; the inspector notes the
     approximation next to the curve editor.
   - Clip `blendMode` (native canvas modes only — the schema's
     `CLIP_BLEND_MODES`) is honored by both renderers: the preview sets it as
     `globalCompositeOperation` on the clip's Konva node and the frame script
     sets it on the 2D context inside `drawClip`, both through the shared
     `canvasCompositeFor` mapping (the injected copy is drift-pinned to it). The
     blend applies to the clip's own layer draw; transition opacity/offset
     compositing is unaffected, and a motion-blurred clip blends its
     accumulation buffer once rather than per sample. Pixel-ops-only modes are
     not offered on clips — neither clip renderer has a per-layer backdrop
     pipeline for them.
   - `MediaJobLifecycleService.createPendingJob({ provider: 'chromium-ffmpeg', creditType: 'video_export' })`
     creates the `AIMediaJob` row.
   - Payload stashed in Redis: `video-render:payload:<jobId>` (design) or
     `video-render:merge:<jobId>` (merge), `EX 24h`.
   - Dispatch: `inngest.send({ name: 'media/render', id: media-render-<jobId>-<minute> })` —
     the deterministic per-minute id dedups the initial dispatch against sweep re-enqueues.
3. **Worker function** — `apps/backend/src/inngest/functions/media-render.ts`: id
   `media-render`, `concurrency: { limit: getRenderConcurrency() }` (default 3). Calls
   `MediaJobsActivity.processRenderJob(jobId)`
   (`libraries/nestjs-libraries/src/inngest/activities/media-jobs.activity.ts`), which:
   - No-ops unless the job is still `pending` (idempotency — guarantees exactly one
     credit charge).
   - Routes merge jobs to `processMergeRender`, design jobs to `processVideoRender`.
   - After a **confirmed-completed** render, charges one credit:
     `SubscriptionService.recordCredit(org, 'video_export')` — a plain insert,
     deliberately **not** transaction-wrapped (a ~5 s interactive-transaction timeout
     would abort a long render and silently skip metering). Failed renders throw before
     this line.
4. **Process** — `VideoRenderService.processVideoRender` / `processMergeRender`:
   - Design renders claim via a non-destructive `GET` of the payload plus an atomic
     `SET NX EX` marker `video-render:claim:<jobId>` (single winner; a losing duplicate
     runner skips silently and must **not** mark the job failed). The payload key must
     survive the render — the `render-frame` route serves it to headless Chromium —
     so it is only `DEL`eted (with the claim key) in `finally` after the encode
     concludes, and only by the claim winner. Merge payloads have no route reader and
     still claim via Redis `GETDEL`.
   - Podman path (`isPodmanRenderEnabled()`): writes the spec into
     `renderWorkDir(jobId)` = `os.tmpdir()/postmill-render-work/<jobId>`, then
     `PodmanRenderService.run(workDir, spec, renderTimeoutMs)`.
   - In-process fallback: `FfmpegVideoEncoderService` (+ `ChromiumFrameCaptureService`)
     under `withTimeout(renderTimeoutMs)`.
   - `renderTimeoutMs` = `max(getRenderTimeoutMs(), frames * 150ms)` where
     `frames = ceil(durationMs/1000 * fps)` — the capture loop spends ~150 ms/frame
     (evaluate + PNG screenshot), so the env floor alone cannot fit long compositions.
   - **Parallel frame capture** (`ChromiumFrameCaptureService.captureFrames`): when
     `totalFrames > PARALLEL_CAPTURE_MIN_FRAMES` (300), capture runs on N pages inside
     ONE Chromium instance — N = `getCapturePageCount()` = `VIDEO_RENDER_CAPTURE_PAGES`
     if set (1 forces sequential), else `min(3, os.availableParallelism())`, hard-capped
     at `MAX_CAPTURE_PAGES` (8). Page i renders the frames where `frameIndex % N === i`;
     files are written under their GLOBAL index (`frame-%05d.png`), so the ffmpeg image2
     pattern sees one contiguous sequence. Each page navigates/preloads independently
     (per-document caches in the frame-renderer script make page state isolated by
     construction); screenshots serialize within a page while the evaluate+screenshot
     pipelines overlap across pages. `onProgress` reports a GLOBAL completed count
     (monotonic). MEMORY: every page loads all clip media, so peak RSS roughly
     multiplies by N — the render pod is cgroup-capped (default 4 CPU / 8g).
   - **Real render progress** (`design-render/render-progress.ts` +
     `render-progress-throttle.ts`): the capture loop's `onProgress` is wired through
     `FfmpegVideoEncoderService` (`VideoEncodeOptions.onProgress`) to a throttled
     writer (every 10 frames or 2 s, whichever first, always the final frame) that
     lands `{frame, total, updatedAt}` at `video-render:progress:<jobId>` (`EX 1h`).
     In-process renders write Redis directly; the container worker (no Redis access)
     POSTs to `POST /media/designs/render-progress/:jobId?token=…` via `safeFetch`
     (same HMAC token guard as `render-frame`; throttled the same way; best-effort —
     a failed report never fails the render). The progress key is `DEL`eted with the
     payload/claim keys after the render concludes.
   - Cross-origin media: the frame page is served from the API origin but clip media
     typically lives on the app/uploads origin. The route sets a page-scoped CSP with
     `media-src`/`img-src https:` (helmet's default `default-src 'self'` would block the
     loads), and the frontend `/api/uploads` serve route sends
     `Access-Control-Allow-Origin: *` (public no-auth bucket) so `crossOrigin='anonymous'`
     canvas draws are not tainted/blocked. Both are required for a render to see its clips.
   - Stores the artifact via `MediaJobLifecycleService.completeJobWithBuffer` (org
     storage, mime/metadata, thumbnail); on error marks the job `failed` (error truncated
     to 1000 chars), reports to Sentry (`subsystem: video-render`), and always removes
     the workdir in `finally`.
5. **Safety-net sweep** — `apps/backend/src/inngest/functions/media-jobs-poll.ts`
   (`media-jobs-poll`, every minute, `concurrency: 1`) →
   `MediaJobsActivity.processPendingMediaJobs`: re-enqueues **stale** still-pending local
   renders (past `STALE_RENDER_MS`, so jobs merely queued behind the concurrency cap are
   left alone), fans out `media/poll-job` events for external-provider jobs, and — when
   Inngest is disabled — renders inline under a host semaphore holding the same 3-cap
   with a per-job timeout.

## Podman worker path

- `libraries/nestjs-libraries/src/media/design-render/podman-render.service.ts`
  (`PodmanRenderService`): writes `<workdir>/job.json`, runs
  `podman run --rm` with the workdir mounted and cgroup caps (cpus/memory), in a shared
  pod for an aggregate cap.
- **Container entrypoint:** `apps/backend/src/media-render-worker.ts` — a DI-light CLI
  (`node media-render-worker.js /work/job.json`), no Nest bootstrap; instantiates
  `FfmpegVideoEncoderService`/`ChromiumFrameCaptureService` directly for `design` and
  calls `mergeLocalFiles` for `merge`; writes artifacts to `<workdir>/out/`. During
  `design` captures it also reports progress over HTTP
  (`POST /media/designs/render-progress/:jobId`, throttled) — the container has no
  Redis access.
- **Job spec contract:** `media/design-render/render-job-spec.ts` —
  `DesignRenderJobSpec` / `MergeRenderJobSpec` (`RenderJobSpec`), `RENDER_OUTPUT_DIR`,
  `RENDER_THUMBNAIL_NAME`, `renderOutputName`. Dependency-free by design; both host and
  worker import it. Keep the two sides in lockstep when changing it.
- **Image:** `docker/Containerfile.render` —
  `podman build -f docker/Containerfile.render -t localhost/postmill-render:latest .`
  (app build + distro Chromium/FFmpeg + the worker CLI as ENTRYPOINT).
- The in-container Chromium resolves the render route/assets against `spec.baseUrl`
  (`NEXT_PUBLIC_BACKEND_URL`/`FRONTEND_URL`); `options.renderToken` comes from
  `mediaJobWebhookToken(jobId, orgId)` (`media/media-job-token.ts`).

## Configuration

`libraries/nestjs-libraries/src/media/design-render/render-config.ts` — read from
`process.env` per call (tunable without rebuild):

| Env | Default | Meaning |
|---|---|---|
| `VIDEO_RENDER_CONCURRENCY` | `3` | Inngest function concurrency cap |
| `VIDEO_RENDER_PODMAN_ENABLED` | off | truthy → container path |
| `VIDEO_RENDER_TIMEOUT_MS` | `120000` | Render wall-clock floor (both paths); scaled up with frame count |
| `VIDEO_RENDER_CAPTURE_PAGES` | auto = `min(3, parallelism)` | Parallel capture pages (one browser) when frames > 300; `1` = force sequential; hard cap 8. Passed through to the render container. |
| `VIDEO_RENDER_PODMAN_BIN` | `podman` | Binary |
| `VIDEO_RENDER_IMAGE` | `localhost/postmill-render:latest` | Worker image |
| `VIDEO_RENDER_POD` | `postmill-render` | Shared pod (aggregate cgroup) |
| `VIDEO_RENDER_CPUS` / `VIDEO_RENDER_MEMORY` | `4` / `8g` | Per-container cgroup caps |
| `VIDEO_RENDER_NETWORK` | `bridge` | `host` is opt-in and defeats the container's network isolation (SSRF surface) |
| `VIDEO_RENDER_SPLIT_FALLBACK` | on | Split-render fallback toggle |

Related: `DEV_DISABLE_VIDEO` (`feature-flags.service.ts`, flag key `video`) skips
video-generation adapter registration at dev boot — it does **not** gate this render
pipeline. `NEXT_PUBLIC_BACKEND_URL` / `FRONTEND_URL` feed `baseUrl()`.

## Key rules

- Render code lives in `libraries/nestjs-libraries/src/media/design-render/` (service,
  encoder, frame capture, Podman runner, config, spec). The controller stays thin; new
  render ops extend `RenderJobSpec` + the worker CLI + `processRenderJob` routing
  together.
- Never bypass the composition bounds (`validateVideoComposition`, 180 s cap) — they are
  the resource-DoS boundary for attacker-controlled compositions. The cap lives in THREE
  lockstep places (`MAX_DURATION_MS` in video-render.service.ts, `MAX_VIDEO_DURATION_MS`
  in designer-doc.limits.ts, the frontend store clamp) — `designer-doc.drift.spec.ts`
  fails if they drift apart.
- Keep the idempotency invariants: `pending`-only gate in `processRenderJob`, the
  single-winner claim in the processors (`SET NX` marker for design renders — never
  delete the payload key before the encode concludes; `GETDEL` for merges),
  deterministic per-minute event ids, credit charged once after
  confirmed completion. Do not wrap the render+charge in an interactive transaction.
- Org-scope every status/artifact read (`getJob(orgId, jobId)` pattern); the Inngest
  entry points are job-id-only by necessity but must re-scope immediately.
- Merge clips are resolved from storage **host-side** (`resolveClipsToFiles`) — storage
  credentials never enter the render container.
- `VIDEO_RENDER_NETWORK=host` weakens container network isolation; treat as a security
  decision, not a convenience flag.
- When touching the container contract (`render-job-spec.ts`, worker CLI), rebuild the
  `postmill-render` image; host and worker are versioned together.
