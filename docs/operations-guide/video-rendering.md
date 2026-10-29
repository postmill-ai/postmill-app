# Video rendering (queue + Podman workers)

Local video work — the **Designer timeline render** (headless Chromium + FFmpeg) and the
**clip-merge** (FFmpeg trim + xfade) — is queued and resource-bounded. Both are CPU/RAM heavy
local compute; without bounds a backlog can starve the host.

## How it works

- **Queue + concurrency.** Both render kinds run through one Inngest function, `media-render`,
  with a static `concurrency.limit` = `VIDEO_RENDER_CONCURRENCY` (default **3**). At most that
  many renders run at once. Enqueue (`/media/designs/render-video`, the merge endpoint) creates a
  pending `AIMediaJob` and sends a `media/render` event; the `media-jobs-poll` cron only
  **re-enqueues** stuck pending jobs (it no longer renders inline). If `USE_INNGEST` is off, the
  cron renders inline through a host semaphore that holds the same cap.
- **Podman workers (opt-in).** With `VIDEO_RENDER_PODMAN_ENABLED=true`, each render runs in a
  `postmill-render` container instead of in-process. The backend shells out to the local `podman`
  CLI. The full render (Chromium frame-capture + FFmpeg encode, or the FFmpeg merge) happens
  inside the container; storage/clip resolution stays on the host (no storage creds in the
  container). Remote (`https:`) clips and images in a design are downloaded host-side before
  capture into the render's work directory, and the renderer reads them straight from local disk
  (Chromium request interception — `/work/assets` inside the container), so it never streams
  media from a remote CDN and multiple backend replicas need no shared storage.
- **Aggregate resource pool.** All render containers join one Podman **pod** whose cgroup carries
  `--cpus VIDEO_RENDER_CPUS` / `--memory VIDEO_RENDER_MEMORY`. Those are the **total** across all
  containers — a lone render may use the whole pool; three share it. (e.g. `4` CPU / `8g` =
  ~half a 8-core/16 GB box for **all** renders combined.)
- **In-process fallback.** With Podman disabled (the default), renders run in the backend process
  as before — used for dev/CI and graceful degradation. The 3-concurrent cap still applies.
- **Time budget.** Designer compositions are capped at 180 seconds. Each render gets a wall-clock
  budget of `VIDEO_RENDER_TIMEOUT_MS` or, if larger, an estimate that scales with frame count ×
  frame pixel area (about 250 ms per megapixel per frame), so long or high-resolution videos are
  not cut off by the floor. A render that exceeds its budget fails; on the Podman path the
  container is also killed. Long videos (more than 150 frames) capture frames on several
  Chromium pages in parallel (`VIDEO_RENDER_CAPTURE_PAGES`).

## Setup (production / self-host)

1. Build the worker image on the Podman host:
   ```bash
   podman build -f docker/Containerfile.render -t localhost/postmill-render:latest .
   ```
2. Enable it:
   ```bash
   VIDEO_RENDER_PODMAN_ENABLED=true
   VIDEO_RENDER_CPUS=4
   VIDEO_RENDER_MEMORY=8g
   VIDEO_RENDER_CONCURRENCY=3
   ```
3. `NEXT_PUBLIC_BACKEND_URL` must be reachable from the container. The pod uses an isolated
   `bridge` network by default, so a `localhost` backend URL does **not** resolve to the host;
   use an address the container can reach, or opt into `VIDEO_RENDER_NETWORK=host`.

## Requirements & notes

- **cgroup v2** is required for the aggregate pod cap. Rootful Podman works out of the box;
  rootless needs `--cgroup-manager systemd` + cgroup delegation. If the pod can't be created and
  `VIDEO_RENDER_SPLIT_FALLBACK=true` (default), the service degrades to per-container even-split
  caps (`CPUS/CONCURRENCY`, `MEMORY/CONCURRENCY` each) and logs a warning.
- The design-render container reaches the backend's `render-frame` route over
  `VIDEO_RENDER_NETWORK` (default `bridge`). `host` is opt-in and defeats the isolation: the
  container's Chromium could then reach localhost, internal services, and cloud metadata. The pod
  owns networking, so per-container network can't differ; the merge worker shares it but doesn't
  use the network.
- The render image is the app build + distro Chromium/FFmpeg + the `media-render-worker` CLI as
  ENTRYPOINT. It reads `/work/job.json` and writes the artifact to `/work/out`. The container runs
  as an unprivileged `render` user; the backend makes each per-job workdir world-writable so that
  user (a mapped subuid under rootless Podman) can write the artifact. Rebuild the image whenever
  you upgrade Postmill — a stale image keeps running the old render code.
- The pod (and the degraded per-container caps) set `--memory-swap` equal to the memory limit, so
  renders get no swap allowance.
- Peak memory grows with the number of parallel capture pages (each page loads every clip), so
  keep `VIDEO_RENDER_CAPTURE_PAGES` well under the CPU cap.

| Env | Default | Meaning |
|---|---|---|
| `VIDEO_RENDER_CONCURRENCY` | `3` | Max simultaneous renders (Inngest limit + host semaphore) |
| `VIDEO_RENDER_PODMAN_ENABLED` | `false` | Run renders in Podman (else in-process) |
| `VIDEO_RENDER_IMAGE` | `localhost/postmill-render:latest` | Worker image |
| `VIDEO_RENDER_POD` | `postmill-render` | Shared pod (aggregate cgroup) |
| `VIDEO_RENDER_CPUS` | `4` | Total CPU across all render containers |
| `VIDEO_RENDER_MEMORY` | `8g` | Total RAM across all render containers |
| `VIDEO_RENDER_NETWORK` | `bridge` | Pod network (`host` is opt-in and removes network isolation) |
| `VIDEO_RENDER_PODMAN_BIN` | `podman` | CLI path |
| `VIDEO_RENDER_TIMEOUT_MS` | `120000` | Render wall-clock floor (both paths); scaled up for long or high-resolution renders |
| `VIDEO_RENDER_CAPTURE_PAGES` | `min(2, cpus/2)` | Parallel capture pages in one Chromium for renders over 150 frames; `1` forces sequential; capped at 8. Passed through to the container |
| `VIDEO_RENDER_FRAME_TIMEOUT_MS` | `30000` | Per-frame capture watchdog; a wedged frame is retried once, then the render fails fast. Passed through to the container |
| `VIDEO_RENDER_SPLIT_FALLBACK` | `true` | Even-split caps if the pod can't be created |

> Verified against v1.4.0
