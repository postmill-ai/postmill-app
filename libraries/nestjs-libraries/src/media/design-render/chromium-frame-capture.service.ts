import { Injectable, Logger } from '@nestjs/common';
import puppeteer, { Browser, Page } from 'puppeteer';
import * as path from 'path';
import { FRAME_RENDERER_SCRIPT, escapeForScriptTag } from './frame-renderer-script';
import { buildFramePage, fontLinksForOutput } from './frame-page';
import { isSafePublicHttpsUrl } from '@postmill-ai/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { getCapturePageCount } from './render-config';
import type { VideoOutput } from './design-render.types';

export interface FrameCaptureProgress {
  frame: number;
  total: number;
}

export interface RenderRouteOptions {
  jobId: string;
  orgId: string;
  token: string;
}

function renderBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

/** Collect every visual media URL the headless page will load (skips audio — the mixer
 *  downloads audio host-side through safeFetch). */
export function collectCompositionMediaUrls(output: VideoOutput): string[] {
  const urls: string[] = [];
  const bg = output.bg;
  if (bg?.type === 'image' && bg.src) urls.push(bg.src);
  for (const track of (output as any)?.tracks || []) {
    if (track?.type === 'audio') continue;
    for (const clip of track?.clips || []) {
      if (clip?.src) urls.push(clip.src);
      for (const frame of clip?.frames || []) {
        if (frame?.url) urls.push(frame.url);
      }
    }
  }
  return urls;
}

/**
 * A render media URL is safe to hand the headless browser when it is inert (`data:`/`blob:`),
 * same-origin/relative (served by our own backend), or a validated public HTTPS URL. A
 * private-IP / metadata / non-public host (e.g. `http://169.254.169.254/…`) is rejected
 * host-side BEFORE the browser (which runs `--no-sandbox` with host network on the in-process
 * path) can fetch it — closing the blind-SSRF hole in the frame renderer.
 */
export async function isRenderMediaUrlAllowed(src: string): Promise<boolean> {
  if (!src) return true;
  if (/^(data:|blob:)/i.test(src)) return true;
  // Relative path → resolves against our own baseUrl (same origin). Allowed.
  if (!/^https?:\/\//i.test(src) && !src.startsWith('//')) return true;
  const absolute = src.startsWith('//') ? `https:${src}` : src;
  try {
    const u = new URL(absolute);
    const base = new URL(renderBaseUrl());
    if (u.host === base.host) return true; // same-origin storage / dev host
  } catch {
    return false;
  }
  return isSafePublicHttpsUrl(absolute);
}

/** Reject the whole render if any visual media URL is not host-side-safe (SSRF guard). */
export async function assertCompositionMediaSafe(output: VideoOutput): Promise<void> {
  for (const src of collectCompositionMediaUrls(output)) {
    if (!(await isRenderMediaUrlAllowed(src))) {
      throw new Error(`Unsafe media URL blocked in render composition: ${src}`);
    }
  }
}

@Injectable()
export class ChromiumFrameCaptureService {
  private readonly _logger = new Logger(ChromiumFrameCaptureService.name);

  /**
   * Render every frame of a VideoOutput to PNG files in `frameDir`.
   * Files are named `frame-00001.png`, `frame-00002.png`, etc. — GLOBAL frame
   * indices even under parallel capture, so the ffmpeg image2 pattern
   * (`frame-%05d.png`) sees one contiguous sequence.
   * Returns the number of frames written.
   *
   * Long renders capture on N pages inside ONE browser (see getCapturePageCount):
   * page i renders the frames where frameIndex % N === i. Per-page state is
   * isolated by construction (the frame-renderer script keeps its media caches
   * per document), so each page navigates/preloads independently. Screenshots
   * stay serialized within a page; the evaluate+screenshot pipelines overlap
   * across pages.
   *
   * `scale` multiplies the output resolution: the viewport and the page's frame
   * canvas run at canvas×scale (the renderer script reads `renderScale` off the
   * composition it is handed), so 2× is a true supersample, not an upscale.
   */
  async captureFrames(
    output: VideoOutput,
    fps: number,
    frameDir: string,
    onProgress?: (progress: FrameCaptureProgress) => void,
    routeOptions?: RenderRouteOptions,
    scale = 1,
  ): Promise<number> {
    const width = Math.round(output.width * scale);
    const height = Math.round(output.height * scale);
    const durationMs = output.durationMs;
    const totalFrames = Math.max(1, Math.ceil((durationMs / 1000) * fps));

    // SSRF guard: validate every visual media URL host-side before the headless browser
    // (which runs --no-sandbox) can fetch it. Throws for private-IP / metadata hosts.
    await assertCompositionMediaSafe(output);

    const browser = await puppeteer.launch({
      headless: true,
      // Honour a distro Chromium when set (used by the render-worker container); falls
      // back to puppeteer's bundled Chromium when unset (the in-process default).
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--mute-audio',
      ],
    });

    try {
      const pageCount = getCapturePageCount(totalFrames);
      const pages: Page[] = [];
      for (let i = 0; i < pageCount; i++) {
        pages.push(await browser.newPage());
      }
      await Promise.all(
        pages.map((page) => this.setupFramePage(page, output, width, height, fps, routeOptions, scale)),
      );

      // Global completed-count keeps onProgress monotonic across pages: consumers
      // (render progress channel) want "how many frames are done", not per-page cursors.
      let completed = 0;
      const reportProgress = () => {
        completed++;
        if (onProgress) {
          onProgress({ frame: completed, total: totalFrames });
        }
      };

      await Promise.all(
        pages.map((page, pageIndex) =>
          this.captureFrameStride(page, pageIndex, pageCount, totalFrames, fps, durationMs, frameDir, reportProgress),
        ),
      );

      this._logger.log(
        `Captured ${totalFrames} frames (${width}x${height} @ ${fps}fps, ${pageCount} page${pageCount === 1 ? '' : 's'})`,
      );
      return totalFrames;
    } finally {
      await browser.close();
    }
  }

  /** Navigate/preload one capture page (route path or direct HTML), then await the frame API. */
  private async setupFramePage(
    page: Page,
    output: VideoOutput,
    width: number,
    height: number,
    fps: number,
    routeOptions: RenderRouteOptions | undefined,
    scale: number,
  ): Promise<void> {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    const baseUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.FRONTEND_URL ||
      'http://localhost:3000';

    if (routeOptions) {
      // scale/fps ride as query params: the route serves the composition from
      // the render payload, so the overrides are applied there — the stored
      // document itself is never mutated. N pages navigate to the SAME URL; the
      // route reads the payload from Redis, which survives the whole render.
      const params = new URLSearchParams({ token: routeOptions.token });
      if (scale !== 1) params.set('scale', String(scale));
      params.set('fps', String(fps));
      const renderUrl = `${baseUrl.replace(/\/$/, '')}/media/designs/render-frame/${routeOptions.jobId}?${params.toString()}`;
      await page.goto(renderUrl, { waitUntil: 'networkidle0' });
    } else {
      const html = buildFramePage({
        outputLiteral: escapeForScriptTag(
          scale === 1 ? output : { ...output, renderScale: scale },
        ),
        baseUrlLiteral: escapeForScriptTag(baseUrl),
        baseUrl,
        script: FRAME_RENDERER_SCRIPT,
        // Direct mode carries no org context, so only catalog fonts can be
        // linked here; org custom fonts reach the frame page through the
        // render-frame route (the path real renders take) instead.
        fontLinks: fontLinksForOutput(output),
      });

      // puppeteer 25: setContent() no longer accepts networkidle0; load +
      // explicit idle wait preserves the semantics (fonts/asset links resolve
      // before the frame API is awaited below).
      await page.setContent(html, { waitUntil: 'load' });
      await page.waitForNetworkIdle();
    }
    await page.waitForFunction(
      () => !!(window as any).__FRAME_API,
      { timeout: 30000 },
    );

    // Preload images/videos so frame rendering is not stalled by network.
    await page.evaluate(() => (window as any).__FRAME_API.preload());
  }

  /**
   * Capture this page's stride of the frame sequence: global indices
   * `pageIndex, pageIndex + pageCount, …`. Frames are written under their GLOBAL
   * index (`frame-%05d.png`), so per-page files interleave into one contiguous
   * sequence for the encoder.
   */
  private async captureFrameStride(
    page: Page,
    pageIndex: number,
    pageCount: number,
    totalFrames: number,
    fps: number,
    durationMs: number,
    frameDir: string,
    reportProgress: () => void,
  ): Promise<void> {
    const canvas = await page.$('#frame-canvas');
    if (!canvas) {
      throw new Error('Frame canvas disappeared during capture');
    }
    for (let i = pageIndex; i < totalFrames; i += pageCount) {
      const timeMs = Math.min((i * 1000) / fps, durationMs);
      await page.evaluate(
        (t: number) => (window as any).__FRAME_API.renderFrame(t),
        timeMs,
      );

      const framePath = path.join(
        frameDir,
        `frame-${String(i + 1).padStart(5, '0')}.png`,
      );
      await canvas.screenshot({ path: framePath, type: 'png' });

      reportProgress();
    }
  }
}
