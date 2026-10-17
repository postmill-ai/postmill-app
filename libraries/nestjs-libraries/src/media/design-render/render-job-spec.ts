// The job spec handed to the render worker (written to <workdir>/job.json, read by the
// container entrypoint). Shared by the host orchestration (PodmanRenderService) and the
// worker (apps/backend render-worker). Kept dependency-free so both sides can import it.

import * as os from 'os';
import * as path from 'path';

/** Persistent host workdir for a render job (survives between enqueue and processing). */
export function renderWorkDir(jobId: string): string {
  return path.join(os.tmpdir(), 'postmill-render-work', jobId);
}

export interface DesignRenderJobSpec {
  op: 'design';
  /** VideoOutput composition (the Designer timeline output). */
  composition: any;
  options: {
    fps: number;
    /** Resolution multiplier over the canvas size (default 1). */
    scale?: number;
    bitrateKbps: number;
    format: 'mp4' | 'webm' | 'gif' | 'webp-animated';
    quality?: number;
    /** loudnorm on the final audio mix (-14 LUFS / -1.5 dBTP); default off. */
    normalizeLoudness?: boolean;
    jobId: string;
    orgId: string;
    renderToken: string;
  };
  /** Backend base URL the in-container Chromium uses to load the render route / assets. */
  baseUrl: string;
}

export interface MergeRenderJobSpec {
  op: 'merge';
  /** Raw clip files already resolved into the workdir by the host (relative names). */
  files: Array<{ name: string; trimStart?: number; trimEnd?: number }>;
  transitions: Array<{ type: string; duration?: number }>;
}

export type RenderJobSpec = DesignRenderJobSpec | MergeRenderJobSpec;

/** Output written by the worker into <workdir>/out/. */
export const RENDER_OUTPUT_DIR = 'out';
export const RENDER_THUMBNAIL_NAME = 'thumbnail.jpg';
export function renderOutputName(format: string): string {
  // ffmpeg infers the muxer from the extension: the internal format id
  // 'webp-animated' is not a real extension and fails with "Invalid argument".
  // Must match the host-side read path (video-render.service.ts).
  return `output.${format === 'webp-animated' ? 'webp' : format}`;
}
