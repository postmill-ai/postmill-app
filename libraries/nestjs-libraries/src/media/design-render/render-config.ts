// Central config for the video-render queue + Podman worker. All values are read from
// process.env per call (not cached) so they can be tuned without a rebuild, following the
// existing direct-process.env convention in this codebase.

import * as os from 'os';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Max simultaneous local video renders (Inngest media-render concurrency + host-semaphore cap). */
export function getRenderConcurrency(): number {
  return intEnv('VIDEO_RENDER_CONCURRENCY', 3);
}

/** Opt-in: run renders inside Podman containers. Off = in-process fallback (dev/CI). */
export function isPodmanRenderEnabled(): boolean {
  const raw = (process.env.VIDEO_RENDER_PODMAN_ENABLED || '').toLowerCase();
  return raw === 'true' || raw === '1';
}

/**
 * Overall wall-clock cap for a single render (in-process encoder + Podman container share
 * this budget). A render that exceeds it is aborted/failed rather than pinning a worker.
 */
export function getRenderTimeoutMs(): number {
  return intEnv('VIDEO_RENDER_TIMEOUT_MS', 120000);
}

/**
 * Below this frame count capture stays sequential: standing up extra Chromium
 * pages (navigation + full media preload each) costs more than it saves.
 * 150 = 5 s @ 30 fps — a 10 s social video (300 frames) is exactly the case
 * that needs parallelism most, and the old 300 threshold kept it sequential.
 * The memory risk that motivated the high threshold is addressed by the PR #172
 * hardening: page setup runs sequentially, parallel pages preload videos lazily,
 * and wedged frames/seeks fail fast under watchdogs.
 */
export const PARALLEL_CAPTURE_MIN_FRAMES = 150;

/** Hard ceiling on capture pages regardless of env — each page loads ALL clip media. */
export const MAX_CAPTURE_PAGES = 8;

/**
 * How many Chromium pages capture frames in parallel inside ONE browser instance.
 * Page i takes frames where frameIndex % N === i; file naming stays global, so the
 * ffmpeg image2 pattern is unaffected.
 *
 * `VIDEO_RENDER_CAPTURE_PAGES` pins the count (1 = force sequential) and always
 * wins when set. When unset the default is `min(2, max(1, floor(cpus/2)))` —
 * parallel capture is re-enabled with a conservative cap after the stall
 * hardening: page setup (goto + initial preload) runs SEQUENTIALLY so N pages
 * no longer spike RSS at once, video preload is lazy under parallel capture
 * (fetched on demand per frame), wedged video seeks time out instead of
 * hanging a stride, each frame's evaluate+screenshot runs under a per-frame
 * watchdog (see getFrameTimeoutMs), and a browser disconnect / target crash
 * fails the capture fast instead of burning the whole render budget.
 *
 * MEMORY: N pages each load every clip of the composition, so peak RSS roughly
 * multiplies by N — and the render pod is cgroup-capped (default 4 CPU / 8g, see
 * getPodmanRenderConfig). Keep the default well under the CPU cap; raising pages
 * past the CPU count buys nothing but memory pressure.
 */
export function getCapturePageCount(totalFrames: number): number {
  if (totalFrames <= PARALLEL_CAPTURE_MIN_FRAMES) return 1;
  const raw = process.env.VIDEO_RENDER_CAPTURE_PAGES;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed, MAX_CAPTURE_PAGES);
    }
  }
  return Math.min(2, Math.max(1, Math.floor(os.cpus().length / 2)));
}

/**
 * Per-frame watchdog for capture: one frame's evaluate+screenshot may never take
 * longer than this. A wedged CDP call otherwise hangs its page's stride until the
 * outer render budget (getRenderTimeoutMs) aborts the whole job.
 */
export function getFrameTimeoutMs(): number {
  return intEnv('VIDEO_RENDER_FRAME_TIMEOUT_MS', 30000);
}

export interface PodmanRenderConfig {
  bin: string;
  image: string;
  pod: string;
  cpus: number;
  memory: string;
  network: string;
  timeoutMs: number;
  /** When true, ensurePool failures fall back to per-container even-split cpu/memory caps. */
  splitFallback: boolean;
}

export function getPodmanRenderConfig(): PodmanRenderConfig {
  return {
    bin: process.env.VIDEO_RENDER_PODMAN_BIN || 'podman',
    image: process.env.VIDEO_RENDER_IMAGE || 'localhost/postmill-render:latest',
    pod: process.env.VIDEO_RENDER_POD || 'postmill-render',
    cpus: intEnv('VIDEO_RENDER_CPUS', 4),
    memory: process.env.VIDEO_RENDER_MEMORY || '8g',
    // Isolated bridge network by default: the render container must NOT join the host
    // network, or containerized Chromium can reach localhost / internal services / cloud
    // metadata (169.254.169.254) — negating the isolation and re-opening the render-path
    // SSRF surface. `host` is opt-in (VIDEO_RENDER_NETWORK=host) and defeats that isolation;
    // full metadata-blocking still needs an egress proxy / firewall on the bridge.
    network: process.env.VIDEO_RENDER_NETWORK || 'bridge',
    timeoutMs: getRenderTimeoutMs(),
    splitFallback: (process.env.VIDEO_RENDER_SPLIT_FALLBACK || '').toLowerCase() !== 'false',
  };
}
