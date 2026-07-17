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
  container).
- **Aggregate resource pool.** All render containers join one Podman **pod** whose cgroup carries
  `--cpus VIDEO_RENDER_CPUS` / `--memory VIDEO_RENDER_MEMORY`. Those are the **total** across all
  containers — a lone render may use the whole pool; three share it. (e.g. `4` CPU / `8g` =
  ~half a 8-core/16 GB box for **all** renders combined.)
- **In-process fallback.** With Podman disabled (the default), renders run in the backend process
  as before — used for dev/CI and graceful degradation. The 3-concurrent cap still applies.

## Setup (production / self-host)

1. Build the worker image on the Podman host:
   ```bash
   podman build -f Containerfile.render -t localhost/postmill-render:latest .
   ```
2. Enable it:
   ```bash
   VIDEO_RENDER_PODMAN_ENABLED=true
   VIDEO_RENDER_CPUS=4
   VIDEO_RENDER_MEMORY=8g
   VIDEO_RENDER_CONCURRENCY=3
   ```
3. `NEXT_PUBLIC_BACKEND_URL` must be reachable from the container (the pod uses
   `--network host`, so a localhost backend URL works).

## Requirements & notes

- **cgroup v2** is required for the aggregate pod cap. Rootful Podman works out of the box;
  rootless needs `--cgroup-manager systemd` + cgroup delegation. If the pod can't be created and
  `VIDEO_RENDER_SPLIT_FALLBACK=true` (default), the service degrades to per-container even-split
  caps (`CPUS/CONCURRENCY`, `MEMORY/CONCURRENCY` each) and logs a warning.
- `--network host` lets the design-render container reach the backend's `render-frame` route and
  fetch assets. The pod owns networking, so per-container network can't differ; the merge worker
  shares it but doesn't use the network.
- The render image is the app build + distro Chromium/FFmpeg + the `media-render-worker` CLI as
  ENTRYPOINT. It reads `/work/job.json` and writes the artifact to `/work/out`.

| Env | Default | Meaning |
|---|---|---|
| `VIDEO_RENDER_CONCURRENCY` | `3` | Max simultaneous renders (Inngest limit + host semaphore) |
| `VIDEO_RENDER_PODMAN_ENABLED` | `false` | Run renders in Podman (else in-process) |
| `VIDEO_RENDER_IMAGE` | `localhost/postmill-render:latest` | Worker image |
| `VIDEO_RENDER_POD` | `postmill-render` | Shared pod (aggregate cgroup) |
| `VIDEO_RENDER_CPUS` | `4` | Total CPU across all render containers |
| `VIDEO_RENDER_MEMORY` | `8g` | Total RAM across all render containers |
| `VIDEO_RENDER_NETWORK` | `host` | Pod network |
| `VIDEO_RENDER_PODMAN_BIN` | `podman` | CLI path |
| `VIDEO_RENDER_TIMEOUT_MS` | `120000` | Per-container hard timeout |
| `VIDEO_RENDER_SPLIT_FALLBACK` | `true` | Even-split caps if the pod can't be created |

> Verified against v1.0.0
