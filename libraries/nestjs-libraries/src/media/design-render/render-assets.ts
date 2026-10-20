// Host-side pre-download of remote render media (design renders). Remote clip/image
// URLs (Pexels stock, Replicate CDN, …) used to be streamed by the render
// container's Chromium straight from the CDN: under memory pressure Chromium
// discards media buffers, so EVERY frame-capture seek became a fresh remote
// range request — ~10 s/frame stalls and job timeouts. Audio was already
// downloaded host-side (FfmpegVideoEncoderService.downloadAudio) and merge clips
// are resolved host-side (resolveClipsToFiles); this module does the same for
// the composition's VISUAL media.
//
// Flow: VideoRenderService.processVideoRender downloads each off-origin https:
// media URL into renderWorkDir(jobId)/assets/ (same 500 MB/clip + 1 GB total
// caps as the merge op) BEFORE the render payload is re-stored, rewriting the
// composition's srcs to a token-gated same-origin route
// (GET /media/designs/render-asset/:jobId/:file?token=…). Both render paths then
// see only same-origin media: the in-process page and the in-container page
// (which already reaches the host over the pod bridge for render-frame via
// spec.baseUrl) resolve the root-relative URLs against the backend base URL.
//
// Token gate: the same derived HMAC job token as render-frame/render-progress
// (mediaJobWebhookToken) — per-job, org-bound, unguessable without the instance
// secret, and present only in the job payload/workdir, so the route needs no
// session (the render container carries no auth cookies).

import * as fs from 'fs';
import * as path from 'path';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { verifyMediaJobWebhookToken } from '../media-job-token';
import { renderPayloadKey } from './render-progress';
import { renderWorkDir } from './render-job-spec';
import { collectCompositionMediaUrls } from './chromium-frame-capture.service';

// Lockstep with the merge op's caps (video-merge.ts MAX_CLIP_SIZE / MAX_TOTAL_SIZE).
export const RENDER_ASSET_MAX_BYTES = 500 * 1024 * 1024;
export const RENDER_ASSETS_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

export const RENDER_ASSETS_DIR = 'assets';
const RENDER_ASSET_MANIFEST = 'manifest.json';

function renderBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

/**
 * The media URLs worth pre-downloading: absolute `https:` URLs on a foreign
 * origin. Inert (data:/blob:), relative, and same-origin URLs already resolve
 * to infrastructure the render can reach cheaply and are left untouched.
 * Deduped — a reused clip downloads once.
 */
export function collectRemoteRenderMediaUrls(output: any, baseUrl = renderBaseUrl()): string[] {
  let baseHost = '';
  try {
    baseHost = new URL(baseUrl).host;
  } catch {
    /* no valid base host — treat every https: URL as remote */
  }
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const src of collectCompositionMediaUrls(output)) {
    if (!/^https:\/\//i.test(src)) continue;
    try {
      if (baseHost && new URL(src).host === baseHost) continue;
    } catch {
      continue;
    }
    if (seen.has(src)) continue;
    seen.add(src);
    urls.push(src);
  }
  return urls;
}

/** Root-relative render-asset URL embedded in the rewritten composition. */
export function renderAssetPath(jobId: string, fileName: string, token: string): string {
  return (
    `/media/designs/render-asset/${encodeURIComponent(jobId)}/${encodeURIComponent(fileName)}` +
    `?token=${encodeURIComponent(token)}`
  );
}

function extForAsset(url: string, contentType: string): string {
  if (contentType.includes('mp4') || contentType.includes('mpeg4')) return 'mp4';
  if (contentType.includes('webm')) return 'webm';
  if (contentType.includes('quicktime')) return 'mov';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('svg')) return 'svg';
  if (contentType.includes('avif')) return 'avif';
  const match = url.match(/\.([a-z0-9]{1,16})(?:[?#][^\r\n]*)?$/i);
  return match?.[1]?.toLowerCase() || 'bin';
}

const EXT_TO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

function mimeByExt(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

/** Swap downloaded URLs for their local render-asset paths in a composition copy. */
export function rewriteCompositionMedia(
  composition: any,
  replacements: Map<string, string>,
): any {
  if (!composition || replacements.size === 0) return composition;
  const swap = (src: any) =>
    (typeof src === 'string' && replacements.get(src)) || src;
  const out: any = { ...composition };
  if (out.bg?.type === 'image' && typeof out.bg.src === 'string') {
    out.bg = { ...out.bg, src: swap(out.bg.src) };
  }
  out.tracks = (Array.isArray(out.tracks) ? out.tracks : []).map((track: any) => {
    if (track?.type === 'audio') return track;
    return {
      ...track,
      clips: (Array.isArray(track?.clips) ? track.clips : []).map((clip: any) => {
        const next = { ...clip, src: swap(clip?.src) };
        if (Array.isArray(clip?.frames)) {
          next.frames = clip.frames.map((frame: any) => ({ ...frame, url: swap(frame?.url) }));
        }
        return next;
      }),
    };
  });
  return out;
}

export interface PreloadRenderMediaResult {
  /** The composition with downloaded URLs rewritten (same reference when nothing was downloaded). */
  composition: any;
  downloaded: number;
  bytes: number;
}

/**
 * Download every remote visual media URL of the composition into
 * `renderWorkDir(jobId)/assets/` and return the composition copy whose srcs
 * point at the token-gated render-asset route. A download failure or a size-cap
 * breach THROWS — a required clip must fail the job fast, never render black.
 */
export async function preloadRenderMedia(opts: {
  jobId: string;
  composition: any;
  token: string;
  baseUrl?: string;
}): Promise<PreloadRenderMediaResult> {
  const { jobId, composition, token } = opts;
  const urls = collectRemoteRenderMediaUrls(composition, opts.baseUrl);
  if (urls.length === 0) {
    return { composition, downloaded: 0, bytes: 0 };
  }

  const assetsDir = path.join(renderWorkDir(jobId), RENDER_ASSETS_DIR);
  fs.mkdirSync(assetsDir, { recursive: true });

  const replacements = new Map<string, string>();
  const manifest: Record<string, string> = {};
  let totalBytes = 0;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const res = await safeFetch(url);
    if (!res.ok) {
      throw new Error(`Render media download failed (${res.status}): ${url}`);
    }
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > RENDER_ASSET_MAX_BYTES) {
      throw new Error(`Render media exceeds the 500 MB per-clip limit: ${url}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > RENDER_ASSET_MAX_BYTES) {
      throw new Error(`Render media exceeds the 500 MB per-clip limit: ${url}`);
    }
    totalBytes += buffer.length;
    if (totalBytes > RENDER_ASSETS_MAX_TOTAL_BYTES) {
      throw new Error('Render media exceeds the 1 GB total limit');
    }
    const contentType = (res.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const fileName = `asset-${i}.${extForAsset(url, contentType)}`;
    fs.writeFileSync(path.join(assetsDir, fileName), buffer);
    manifest[fileName] = contentType || mimeByExt(fileName);
    replacements.set(url, renderAssetPath(jobId, fileName, token));
  }
  fs.writeFileSync(
    path.join(assetsDir, RENDER_ASSET_MANIFEST),
    JSON.stringify(manifest),
  );

  return {
    composition: rewriteCompositionMedia(composition, replacements),
    downloaded: urls.length,
    bytes: totalBytes,
  };
}

export type RenderAssetResolution =
  | { status: 'ok'; filePath: string; contentType: string; size: number }
  | { status: 'forbidden' | 'not-found' };

// Only the names preloadRenderMedia writes (asset-<i>.<ext>).
const SAFE_ASSET_FILE_NAME = /^asset-(\d+)\.([a-z0-9]{1,16})$/;

/**
 * Validate a render-asset file name and REBUILD it from the strict regex
 * captures, so the string used in path construction is provably free of path
 * separators and parent refs (CodeQL js/path-injection needs the sanitization
 * to dominate the path expression). Null for anything else — the manifest,
 * traversal attempts, dotfiles.
 */
export function safeRenderAssetFileName(fileName: string): string | null {
  const match = SAFE_ASSET_FILE_NAME.exec(fileName);
  if (!match) return null;
  return `asset-${match[1]}.${match[2]}`;
}

/** Render job ids are Prisma cuids; the route param feeds a filesystem path, so pin the alphabet. */
export function isSafeRenderAssetJobId(jobId: string): boolean {
  return /^[a-z0-9]{20,40}$/i.test(jobId);
}

/**
 * Token-gated resolution behind GET /media/designs/render-asset/:jobId/:file.
 * The org id comes from the render payload (which survives the render by
 * design), exactly like the render-frame / render-progress token checks; the
 * file must live in the job's assets dir with a name the preloader wrote.
 */
export async function resolveRenderAsset(
  jobId: string,
  fileName: string,
  token: string,
): Promise<RenderAssetResolution> {
  // Sanitize BEFORE any path construction: both route params feed the on-disk
  // path below. A format mismatch is a 404 (the controller 400s it first); the
  // token check still precedes the existence check, so an invalid token never
  // learns which names exist.
  const safeName = safeRenderAssetFileName(fileName);
  if (!safeName || !isSafeRenderAssetJobId(jobId)) return { status: 'not-found' };
  if (!token) return { status: 'forbidden' };

  const raw = await ioRedis.get(renderPayloadKey(jobId));
  if (!raw) return { status: 'not-found' };
  let orgId: string | undefined;
  try {
    orgId = JSON.parse(raw)?.organizationId;
  } catch {
    return { status: 'not-found' };
  }
  if (!orgId || !verifyMediaJobWebhookToken(jobId, orgId, token)) {
    return { status: 'forbidden' };
  }

  const assetsDir = path.resolve(renderWorkDir(jobId), RENDER_ASSETS_DIR);
  const filePath = path.resolve(assetsDir, safeName);
  // Belt and braces: the rebuilt name cannot escape, but verify containment.
  if (!filePath.startsWith(assetsDir + path.sep)) return { status: 'not-found' };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { status: 'not-found' };
  }
  if (!stat.isFile()) return { status: 'not-found' };

  let contentType = '';
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(assetsDir, RENDER_ASSET_MANIFEST), 'utf8'),
    );
    if (typeof manifest?.[safeName] === 'string') {
      contentType = manifest[safeName];
    }
  } catch {
    /* fall back to the extension guess */
  }
  if (!contentType) contentType = mimeByExt(safeName);

  return { status: 'ok', filePath, contentType, size: stat.size };
}
