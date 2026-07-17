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
    bitrateKbps: number;
    format: 'mp4' | 'webm' | 'gif' | 'webp-animated';
    quality?: number;
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
  return `output.${format}`;
}
