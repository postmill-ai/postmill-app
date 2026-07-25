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
   (org-scoped `getJob` — a foreign job id returns null, not data).
2. **Enqueue** — `libraries/nestjs-libraries/src/media/design-render/video-render.service.ts`
   (`VideoRenderService`):
   - Validates the composition: 60 s duration cap, `validateVideoComposition` bounds
     (dims ≤ `MAX_DIMENSION`, fps ≤ 240, `MAX_TRACKS`, `MAX_CLIPS_PER_TRACK` from
     `media/designer-doc/designer-doc.limits.ts`) — a resource-DoS guard on input that
     drives Puppeteer/FFmpeg.
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
   - Claims the payload atomically via Redis `GETDEL` (single winner; a losing duplicate
     runner skips silently and must **not** mark the job failed).
   - Podman path (`isPodmanRenderEnabled()`): writes the spec into
     `renderWorkDir(jobId)` = `os.tmpdir()/postmill-render-work/<jobId>`, then
     `PodmanRenderService.run(workDir, spec)`.
   - In-process fallback: `FfmpegVideoEncoderService` (+ `ChromiumFrameCaptureService`)
     under `withTimeout(getRenderTimeoutMs())`.
   - Stores the artifact via `MediaJobLifecycleService.completeJobWithBuffer` (org
     storage, mime/metadata, thumbnail); on error marks the job `failed` (error truncated
     to 1000 chars) and always removes the workdir in `finally`.
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
  calls `mergeLocalFiles` for `merge`; writes artifacts to `<workdir>/out/`.
- **Job spec contract:** `media/design-render/render-job-spec.ts` —
  `DesignRenderJobSpec` / `MergeRenderJobSpec` (`RenderJobSpec`), `RENDER_OUTPUT_DIR`,
  `RENDER_THUMBNAIL_NAME`, `renderOutputName`. Dependency-free by design; both host and
  worker import it. Keep the two sides in lockstep when changing it.
- **Image:** `Containerfile.render` (repo root) —
  `podman build -f Containerfile.render -t localhost/postmill-render:latest .`
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
| `VIDEO_RENDER_TIMEOUT_MS` | `120000` | In-process encode wall-clock cap |
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
- Never bypass the composition bounds (`validateVideoComposition`, 60 s cap) — they are
  the resource-DoS boundary for attacker-controlled compositions.
- Keep the idempotency invariants: `pending`-only gate in `processRenderJob`, `GETDEL`
  claim in the processors, deterministic per-minute event ids, credit charged once after
  confirmed completion. Do not wrap the render+charge in an interactive transaction.
- Org-scope every status/artifact read (`getJob(orgId, jobId)` pattern); the Inngest
  entry points are job-id-only by necessity but must re-scope immediately.
- Merge clips are resolved from storage **host-side** (`resolveClipsToFiles`) — storage
  credentials never enter the render container.
- `VIDEO_RENDER_NETWORK=host` weakens container network isolation; treat as a security
  decision, not a convenience flag.
- When touching the container contract (`render-job-spec.ts`, worker CLI), rebuild the
  `postmill-render` image; host and worker are versioned together.
