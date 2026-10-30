# Video rendering (developer view)

Local video compute for the Designer timeline and clip-merge: a request enqueues a render
job, an Inngest function (concurrency-capped) runs it either in-process (Chromium +
FFmpeg) or in a resource-capped Podman container, and the artifact lands in org storage
with one `video_export` credit charged. Sibling docs: `agents/backend.md`,
`agents/frontend.md`, `agents/jobs.md`, `agents/billing.md`.

## Render ops

| Op | Job marker | What it does | Entry |
|---|---|---|---|
| `design` | `provider = 'chromium-ffmpeg'` | Encodes a Designer timeline composition (headless Chromium frame capture → FFmpeg) to mp4/webm/gif/animated-webp + thumbnail | `POST /design/render-video` → `VideoRenderService.enqueueRender` |
| `merge` | `model = 'local/ffmpeg-merge'` | FFmpeg trim + xfade merge of stored clips | Replicate-studio clip-merge flow → `ReplicateRunnerService` (~line 450) resolves clips host-side into the workdir, then `VideoRenderService.enqueueMerge` |
| template preview | `provider = 'chromium-ffmpeg'`, `creditType = 'none'`, payload carries `templateId` | Cheap animated-WebP thumbnail for a video-mode template (first 3 s, 12 fps, 0.5× scale) | Automatic fire-and-forget from `DesignTemplateController` create/update → `VideoRenderService.enqueueTemplatePreview` |

## Template animated previews

Saving a template whose `doc.mode === 'video'` (POST/PUT `/media/design-templates`)
fire-and-forget enqueues a preview render alongside the static JPEG thumbnail the
client already uploads. The flow reuses the `design` pipeline end-to-end:

- **Cap server-side, not in the worker.** `enqueueTemplatePreview` runs
  `capCompositionDuration` (`media/designer-doc/composition-cap.ts`) to slice the
  composition to the first `TEMPLATE_PREVIEW_DURATION_MS` (3 s) — clips starting
  at/after the cap are dropped, a straddling clip's `endMs` (and freeze tail) is
  truncated; in-clip timelines (keyframes, speed curves, words) are untouched
  because points past the new end never evaluate. `render-job-spec.ts` and the
  container worker are UNCHANGED (no `maxDurationMs` to thread through); the
  reduced `fps` (12) and `scale` (0.5) ride the existing payload/spec fields.
- **No credit.** The job is created with `creditType: 'none'` (`NO_CREDIT` in
  video-render.service.ts) and `MediaJobsActivity.processRenderJob` skips
  `recordCredit` for it. The sentinel exists because merge jobs run with a NULL
  creditType and ARE charged — never switch to a null-means-free rule. The
  VIDEO_EXPORTS in-flight gate (`countInFlightVideoExports`) counts only
  `creditType = 'video_export'` rows, so previews hold no entitlement slot.
- **Completion links the thumbnail.** The payload's `templateId` routes the
  completion in `processVideoRender`: the animated WebP is stored via
  `completeJobWithBuffer` with `metadata.internal = 'design-preview'` (hidden
  from the media-library listing), no separate JPEG thumbnail artifact, and
  `notify: false`; then `linkTemplatePreview` resolves the stored File row by
  `artifactUrl` and `DesignService.updateTemplate` points `thumbnailFileId` at
  it (soft-deleting the replaced static thumbnail). Linking is best-effort — a
  failure leaves the static JPEG in place and never fails the job.
- Template panel tiles render the thumbnail in a plain `<img>`, so the WebP
  animates on its own; no frontend changes.

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
     `scale` (0.25–4 resolution multiplier) and `fps` (24|30|60 override) DTO fields
     are folded into the composition copy before validation, and ride the payload +
     `DesignRenderJobSpec.options.scale` through to the encoder. The stored document is
     never mutated; on the render-route path the overrides reach the frame page as
     clamped `scale`/`fps` query params (`renderScale` on the served composition copy).
   - Track-level `muted` (audio tracks) is honored by both the preview engine and the
     FFmpeg mixer — a muted track's clips contribute nothing, not even to the ducking
     sidechain. Track-level `locked`/`hidden` (both optional-additive on doc v7):
     `locked` refuses clip drag/trim/split/delete (gesture guards in the timeline,
     store guards in `removeClips`/`rippleDeleteClip(s)`/`splitClip`); `hidden`
     excludes the track from EVERY renderer — `composeClipsAtPlayhead` in both the
     preview and the injected frame script, and the FFmpeg mixer treats a hidden
     track exactly like a muted one (it also feeds no ducking sidechain).
     `VideoOutput.markers` (optional-additive v7) are editor-only ruler state —
     no renderer reads them.
   - Clip transitions (`transitionIn`/`transitionOut`): `cut`, `fade`
     (fade-through-black — each clip owns half the window), `dissolve` (plain
     cross-fade), `slide`, `wipe` (incoming slides over a STATIC outgoing clip),
     `zoom` (scale about the centre), `blur` (gaussian ramp inversely to opacity,
     max 24 px). ALL of the per-frame maths lives in ONE shared module,
     `media/designer-doc/transitions.ts` (`transitionAdjustment` /
     `applyTransitionAdjustment`); the preview imports it and the frame page is
     handed it as source (`transitionsSource()`, injected like
     `keyframesSource`) — a frame-renderer spec pins the injected copy to the
     module. Blur rides the canvas/CSS filter pipeline in both renderers (merged
     into `ctx.filter` with the clip's own filters); in the Konva preview it
     applies to image/video/sticker clips (the FilteredClipImage offscreen
     path) — text/shape/caption clips show the opacity ramp only.
   - `RenderVideoDesignDto.scale` is any multiplier in 0.25–4 (the 720p/1080p/4K
     shorthands and platform presets resolve to one) and `normalizeLoudness`
     (default off) appends `loudnorm=I=-14:TP=-1.5` to the FINAL `amix` leg of
     the audio filtergraph (single-pass), riding the payload +
     `DesignRenderJobSpec.options` like scale/fps/bitrate. MP4/WebM encoding
     normalizes odd scaled frames to even dimensions (`trunc(iw/2)*2` ×
     `trunc(ih/2)*2`) because their 4:2:0 codecs reject odd rasters; animated
     GIF/WebP dimensions are unchanged. FFmpeg failures retain the first known
     encoder/filter diagnostic and log only safe render parameters, not design
     content or asset URLs.
   - Clip `volume` is keyframable: keyframes REPLACE the base volume where they span
     (both sides evaluate the shared `volumeAtClipTime`), and the mixer bakes the
     eased curve into `volume='<expr>':eval=frame` sampled at 100 ms steps
     (`design-render/volume-envelope.ts`) — fades stay separate downstream afade
     filters in both engines.
   - Text clips can carry a progressive reveal (`clip.textReveal`, optional-additive):
     the drawn string is sliced to a growing prefix (chars or words) as the playhead
     crosses the clip — NOT a keyframe channel (keyframes animate numeric props
     only). The maths live in ONE shared module, `media/designer-doc/text-reveal.ts`
     (`applyTextReveal` / `textRevealProgress`); the preview overlay imports it and
     the frame page is handed it as source (`textRevealSource()`, injected like
     `keyframesSource`). The Typewriter preset (`text-animation-presets.ts`) writes
     it at ~80 ms/char; a reveal preset clears the keyframe lanes and vice versa.
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
     would abort a long render and silently skip metering). A terminal-`failed` after-read
     returns cleanly (the render recorded its own error; throwing would burn every
     Inngest retry re-reading the same failed status); only a non-terminal after-read
     throws, so a retry observes the eventual outcome. Neither path reaches the charge.
4. **Process** — `VideoRenderService.processVideoRender` / `processMergeRender`:
   - Design renders claim via a non-destructive `GET` of the payload plus an atomic
     `SET NX EX` marker `video-render:claim:<jobId>` (single winner; a losing duplicate
     runner skips silently and must **not** mark the job failed). A loser that finds the
     job still `pending` checks for a live runner via the progress key: fresh progress →
     skip; no/stale progress (`LIVE_RUNNER_PROGRESS_WINDOW_MS`, 60 s) → the holder
     crashed, so the stale claim + progress keys are deleted and the job re-dispatched
     instead of failed. The payload key must
     survive the render — the `render-frame` route serves it to headless Chromium —
     so it is only `DEL`eted (with the claim key) in `finally` after the encode
     concludes, and only by the claim winner. Merge payloads have no route reader and
     still claim via Redis `GETDEL`.
   - Podman path (`isPodmanRenderEnabled()`): writes the spec into
     `renderWorkDir(jobId)` = `os.tmpdir()/postmill-render-work/<jobId>`, then
     `PodmanRenderService.run(workDir, spec, renderTimeoutMs)`.
   - In-process fallback: `FfmpegVideoEncoderService` (+ `ChromiumFrameCaptureService`)
     under `withTimeout(renderTimeoutMs)`.
   - `renderTimeoutMs` = `max(getRenderTimeoutMs(), ceil(frames * 250ms * megapixels * scale²))`
     where `frames = ceil(durationMs/1000 * fps)` and `megapixels =
     (width * height)/1e6` of the unscaled canvas (1 MP fallback when unknown) —
     the capture loop's per-frame cost scales with frame area (~250 ms/MP/frame,
     calibrated on the prod host: ~480 ms/frame at 1080×1920 vs ~280 ms/frame at
     1080×1080, single page), so the env floor alone cannot fit long or
     high-resolution compositions.
   - **Parallel frame capture** (`ChromiumFrameCaptureService.captureFrames`): when
     `totalFrames > PARALLEL_CAPTURE_MIN_FRAMES` (150 — 5 s @ 30 fps, so a typical
     10 s social video parallelizes), capture runs on N pages inside
     ONE Chromium instance — N = `getCapturePageCount()` = `VIDEO_RENDER_CAPTURE_PAGES`
     if set (1 forces sequential), else **the conservative default
     `min(2, max(1, floor(cpus/2)))`** (parallel re-enabled after the stall hardening
     below). Hard cap `MAX_CAPTURE_PAGES` (8). Page i renders the frames where
     `frameIndex % N === i`; files are written under their GLOBAL index
     (`frame-%05d.png`), so the ffmpeg image2 pattern sees one contiguous sequence.
     Page setup (navigation + initial preload) runs SEQUENTIALLY so N pages never
     spike RSS at once — that setup spike was the suspected OOM behind the old
     multi-page stall. Videos AND images preload EAGERLY on every page: a hidden
     headless page cannot create a media pipeline at all — a `<video>` first given
     a src after its page has been hidden for a while never fetches a byte (the
     request parks in Chromium's network stack; networkState=2, readyState=0
     forever), so the old lazy per-frame video creation wedged the render at the
     first clip switch (`seekVideo` fail-fast: "still wedged after 3 consecutive
     seeks and a reload"). Setup is the one moment each page is guaranteed
     front-most, and seeks on an ALREADY-loaded element work fine while hidden.
     Belt-and-braces: `captureOneFrame` calls `page.bringToFront()` before each
     frame's evaluate so buffer re-fetches after a memory-pressure discard and
     the reload+reseek recovery path run on a visible page. Frames leave the
     page as CANVAS READBACK: `renderFrame` +
     `canvas.toDataURL('image/png')` run in ONE `page.evaluate` and the PNG is
     written host-side — never `Page.captureScreenshot`, which is compositor-based
     and pends forever on `hidden` headless pages (in headless Chromium only the
     front-most page is `visible`; that wedged page 0's first frame whenever
     N > 1 — the post-#172 production wedge — and is the likely mechanism behind
     the original #152 "one stride completes" stall). Fail-fast hardening: wedged
     video seeks resolve after a 5s timeout instead of hanging a stride
     (`seekVideo`) — but a wedged element that KEEPS timing out is no longer
     tolerated forever: consecutive wedged seeks are counted per element, after
     3 the element is reloaded once (`video.load()` + reseek), and a seek that
     still wedges after the reload THROWS so the render aborts fast instead of
     drawing stale frames at 10s/frame until the job timeout (clip videos also
     load with `preload='auto'` so the browser does not discard the buffer
     under memory pressure). Each frame's render+readback runs under a per-frame watchdog
     (`VIDEO_RENDER_FRAME_TIMEOUT_MS`, default 30s), a wedged frame is retried
     ONCE on a freshly set-up page before the render aborts, and a browser
     `disconnected` / page `error` (crash) listener rejects all in-flight strides
     immediately instead of burning the whole render budget. `onProgress` reports
     a GLOBAL completed count (monotonic). MEMORY: every page loads all clip
     media, so peak RSS roughly multiplies by N — the render pod is cgroup-capped
     (default 4 CPU / 8g, with `--memory-swap` pinned to the memory limit so the
     render pod gets ZERO swap allowance and cannot push the host into swap
     thrash; the degraded per-container split path pins it likewise).
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
     `media-src`/`img-src 'self' https:` (helmet's default `default-src 'self'` would block the
     loads), and the frontend `/api/uploads` serve route sends
     `Access-Control-Allow-Origin: *` (public no-auth bucket) so `crossOrigin='anonymous'`
     canvas draws are not tainted/blocked. Both are required for a render to see its clips.
   - Remote visual media is pre-downloaded HOST-SIDE before frame capture
     (`design-render/render-assets.ts`, `preloadRenderMedia`): `processVideoRender`
     walks the composition (`collectCompositionMediaUrls`), downloads every
     off-origin `https:` clip/image via `safeFetch` into
     `renderWorkDir(jobId)/assets/` under the merge op's caps (500 MB/clip, 1 GB
     total), and rewrites the srcs to root-relative
     `/media/designs/render-asset/:jobId/:file?token=…` URLs BEFORE the render
     payload is re-stored — so the render-frame route AND the podman job.json both
     carry local URLs (the container reaches the host route over the pod bridge via
     `spec.baseUrl`, the same mechanism as render-frame). Streaming the CDN from
     in-container Chromium had every discarded-buffer seek become a remote range
     request (~10 s/frame stalls → job timeouts). A download failure fails the job
     fast — a required clip never renders black. Downloaded mp4-family clips
     (mp4/m4v/mov) are also remuxed to faststart in place
     (`ffmpeg -c copy -movflags +faststart`, temp file + atomic rename): a clip
     whose moov atom sits at the END of the file (typical of AI-generated mp4s,
     e.g. the Replicate CDN's ftyp/free/mdat/moov box order) wedges Chromium's
     `<video>` seek on its first frame and trips the seekVideo fail-fast. The
     remux is best-effort — ffmpeg missing or a failed remux logs a warning and
     keeps the ORIGINAL file (the render degrades to the pre-faststart behavior,
     it does not fail). The route
     (`DesignRenderFrameController.renderAsset`) is token-gated like render-frame
     (same HMAC job token, org id from the payload), serves only `asset-N.ext`
     names the preloader wrote, and supports single byte-ranges (Chromium seeks
     issue range requests). The frame page CSP keeps `https:` for legacy remote
     URLs and adds `'self'` for these same-origin assets (dev backends serve http).
   - Render assets never cross the load balancer: the capture page loads from the
     public `NEXT_PUBLIC_BACKEND_URL`, so on a multi-replica deployment an HTTP
     render-asset request could land on a replica that never downloaded the files
     (404 → failed render). `ChromiumFrameCaptureService.setupFramePage` therefore
     enables Puppeteer request interception on EVERY route-mode capture page
     (including the fresh page a wedged-frame retry builds) BEFORE navigating, and
     `interceptRenderAssetRequest` answers this job's
     `/media/designs/render-asset/:jobId/:file` requests straight from the LOCAL
     assets dir (`RenderRouteOptions.assetsDir`, default
     `renderWorkDir(jobId)/assets`; the Podman worker passes `/work/assets`). Malformed
     job ids/file names 404 without touching the network; another job's asset and
     a file missing locally `continue()` to the token-gated HTTP route, which stays
     the fallback; every other request continues unchanged. Single byte-ranges get
     206/416 via the shared `parseByteRange` (`render-asset-files.ts`, also used by
     the route), and a range response is clamped to
     `RENDER_ASSET_MAX_RESPONSE_BYTES` (8 MB) because `Fetch.fulfillRequest` ships
     the body base64 in one CDP message — Chromium requests the next range.
     `render-asset-files.ts` stays Redis/Nest-free (the worker imports it).
   - Fonts on the frame page: `buildFramePage` (`design-render/frame-page.ts`) injects
     catalog `<link>`s + org `@font-face` rules (`fontLinksForOutput`) AND explicit
     `document.fonts.load()` specs (`fontPreloadsForOutput`), awaited before
     `__FRAME_API` is announced. `document.fonts.ready` alone is insufficient — the
     faces load lazily on first canvas `fillText`, so the opening frame(s) painted a
     fallback face and the real font popped in mid-video (prod-observed).
   - Silent-audio fallback: a composition with no audible clips still exports an audio
     stream — the encoder substitutes `-f lavfi -i anullsrc=cl=stereo:r=44100` for the
     mixed WAV and always passes `-c:a aac|libopus -shortest` (never `-an`) for
     mp4/webm, because players/platforms treat video-only files inconsistently.
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
   with a per-job timeout. Local renders stuck in `processing` (a crashed runner never
   ran its own fail path) are failed once they exceed their wall-clock budget — the same
   `computeRenderTimeoutMs` the runner enforces, derived from the surviving Redis payload
   (env floor when it is gone) — plus a 60 s grace, so the status poller stops waiting
   and the user can retry.

## Podman worker path

- `libraries/nestjs-libraries/src/media/design-render/podman-render.service.ts`
  (`PodmanRenderService`): writes `<workdir>/job.json`, runs
  `podman run --rm --name postmill-render-<jobId>-<suffix>` with the workdir
  mounted and cgroup caps (cpus/memory), in a shared pod for an aggregate cap.
  On wall-clock timeout the podman CLI client is SIGKILLed AND the named
  container is best-effort `podman kill`ed before the error is thrown —
  otherwise the detached container keeps running and the caller's workdir
  cleanup yanks /work from under it (late ENOENT + a spurious second error).
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
  The prod deploy script (`ops/scripts/deploy-app.sh`) rebuilds the image automatically
  whenever the deployed diff touches `libraries/nestjs-libraries/src/media/design-render/`,
  `apps/backend/src/media-render-worker.ts`, or the Containerfile — a manual rebuild
  after those changes is no longer needed (a stale image once kept serving pre-hardening
  capture code and wedged renders that the merged code had already fixed).
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
| `VIDEO_RENDER_TIMEOUT_MS` | `120000` | Render wall-clock floor (both paths); scaled up with frame count × frame pixel area (250 ms/MP/frame) |
| `VIDEO_RENDER_CAPTURE_PAGES` | `min(2, cpus/2)` when frames > 150 | Parallel capture pages (one browser); `1` = force sequential (rollback); hard cap 8. Passed through to the render container. |
| `VIDEO_RENDER_FRAME_TIMEOUT_MS` | `30000` | Per-frame capture watchdog (evaluate+screenshot); a wedged frame fails the render fast. Passed through to the render container. |
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
- Video text layout is canvas-authoritative and shared through `designer-doc/video-text-layout.ts`.
  The injected frame script must use `videoTextLayoutSource()` (paragraphs, long tokens, box overflow,
  one-fontSize line height, middle baselines, all four alignments and reveal prefixes), never a local
  wrapper or top baseline. `fontSize` is a numeric keyframe channel like geometry. Shape gradients use
  injected `buildStyleGradient`; doc v9 `fillGradient`/`align` also project through `video-poster.ts`.
- Visual clip crop/fit geometry is shared through `designer-doc/media-geometry.ts` and injected with
  `mediaGeometrySource()`. Preview (including the filtered canvas branch) and frame export must use
  the same source/destination rectangles. Absent `fitMode` means aspect-preserving `cover`; only
  explicit `fill` stretches. Crop edits carry `naturalWidth`/`naturalHeight`/`fitMode`/`focalPoint`
  through the clip adapter rather than consulting the image-only cache.
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
  credentials never enter the render container. Design-render remote visual media is
  likewise pre-downloaded host-side (`render-assets.ts`) into the mounted workdir and
  served to the in-container Chromium by request interception from `/work/assets`
  (token-gated `render-asset` route as fallback) — never hand the container a remote
  clip URL to stream.
- `VIDEO_RENDER_NETWORK=host` weakens container network isolation; treat as a security
  decision, not a convenience flag.
- When touching the container contract (`render-job-spec.ts`, worker CLI), rebuild the
  `postmill-render` image; host and worker are versioned together.
