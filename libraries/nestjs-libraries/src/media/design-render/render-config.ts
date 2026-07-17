// Central config for the video-render queue + Podman worker. All values are read from
// process.env per call (not cached) so they can be tuned without a rebuild, following the
// existing direct-process.env convention in this codebase.

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
