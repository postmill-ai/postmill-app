// Real render-progress channel (host side). The frame-capture loop reports
// {frame, total} while a video render runs — directly to Redis on the in-process
// path, or over POST /media/designs/render-progress/:jobId from the container
// worker (which has no Redis access; reportRenderProgress is that route's guard
// + write). The status endpoint (GET /media/designs/render-video/:jobId) reads
// the key to return a real percent instead of the old hardcoded 50.

import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { verifyMediaJobWebhookToken } from '../media-job-token';

export const RENDER_PROGRESS_TTL_SECONDS = 60 * 60;

/** Single source for the render payload key (enqueue, claim, render-frame route, progress route). */
export function renderPayloadKey(jobId: string): string {
  return `video-render:payload:${jobId}`;
}

export function renderProgressKey(jobId: string): string {
  return `video-render:progress:${jobId}`;
}

export interface RenderProgress {
  frame: number;
  total: number;
  updatedAt: number;
}

export async function writeRenderProgress(
  jobId: string,
  frame: number,
  total: number,
): Promise<void> {
  const value: RenderProgress = { frame, total, updatedAt: Date.now() };
  await ioRedis.set(
    renderProgressKey(jobId),
    JSON.stringify(value),
    'EX',
    RENDER_PROGRESS_TTL_SECONDS,
  );
}

/** Null when nothing has been reported yet (or the value is unreadable) — callers fall back. */
export async function readRenderProgress(jobId: string): Promise<RenderProgress | null> {
  let raw: string | null;
  try {
    raw = await ioRedis.get(renderProgressKey(jobId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      !Number.isFinite(parsed?.frame) ||
      !Number.isFinite(parsed?.total) ||
      parsed.total <= 0
    ) {
      return null;
    }
    return { frame: parsed.frame, total: parsed.total, updatedAt: parsed.updatedAt ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Token-gated progress write behind POST /media/designs/render-progress/:jobId.
 * The org id comes from the render payload (which survives the render by design —
 * the render-frame route serves it), exactly like the render-frame token check.
 */
export async function reportRenderProgress(
  jobId: string,
  token: string,
  frame: number,
  total: number,
): Promise<'ok' | 'forbidden' | 'not-found'> {
  if (!token) return 'forbidden';
  const raw = await ioRedis.get(renderPayloadKey(jobId));
  if (!raw) return 'not-found';
  let orgId: string | undefined;
  try {
    orgId = JSON.parse(raw)?.organizationId;
  } catch {
    return 'not-found';
  }
  if (!orgId || !verifyMediaJobWebhookToken(jobId, orgId, token)) return 'forbidden';
  // Clamp rather than reject: a buggy/late report must not 403 the worker, and a
  // bogus value must not poison the status percent.
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.round(total) : 0;
  if (!safeTotal) return 'forbidden';
  const safeFrame = Number.isFinite(frame) ? Math.max(0, Math.min(Math.round(frame), safeTotal)) : 0;
  await writeRenderProgress(jobId, safeFrame, safeTotal);
  return 'ok';
}
