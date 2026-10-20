import { Injectable, Logger } from '@nestjs/common';
import puppeteer, { Browser, Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { FRAME_RENDERER_SCRIPT, escapeForScriptTag } from './frame-renderer-script';
import { buildFramePage, fontLinksForOutput, fontPreloadsForOutput } from './frame-page';
import { isSafePublicHttpsUrl } from '@postmill-ai/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { getCapturePageCount, getFrameTimeoutMs } from './render-config';
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

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

/** Per-frame watchdog rejection — the stride retries these once on a fresh page. */
export class FrameCaptureTimeoutError extends Error {}

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
   * per document). Page setup (navigation + initial preload) runs SEQUENTIALLY
   * so N pages never spike memory at once — that setup-time RSS spike was the
   * suspected OOM behind the multi-page stall; only the strides overlap.
   *
   * Frames leave the page as CANVAS READBACK (canvas.toDataURL in the same
   * evaluate as renderFrame), never Page.captureScreenshot: in headless
   * Chromium only the front-most page is `visible`, and a compositor
   * screenshot of a `hidden` page waits for a frame it never produces — that
   * wedged page 0's first frame whenever N > 1 (the #152 stall: exactly one
   * page's stride completes). Canvas 2D raster is CPU-side and
   * visibility-independent, so every page can produce frames concurrently.
   *
   * Every frame runs under a per-frame watchdog (getFrameTimeoutMs); a wedged
   * frame is retried ONCE on a freshly set-up page before the render aborts,
   * and a browser-disconnect / page-crash listener rejects in-flight strides
   * fast.
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

      // Fail-fast channel: a dead browser (OOM kill in the cgroup-capped render
      // pod, renderer crash) must reject the in-flight strides immediately
      // instead of hanging until the outer render budget aborts the whole job.
      // The noop catch pre-handles the rejection for the moments no stride is
      // racing it (e.g. the browser.close() in finally); each Promise.race
      // below still sees it.
      let rejectCrashed: (err: Error) => void = () => {};
      const crashed = new Promise<never>((_, reject) => {
        rejectCrashed = reject;
      });
      crashed.catch(() => {});
      const onDisconnected = () =>
        rejectCrashed(
          new Error(
            'Chromium disconnected mid-capture — the browser process died (likely OOM in the render container)',
          ),
        );
      // A crashed page surfaces as the page 'error' event (puppeteer 25 has no
      // browser-level targetcrashed event) — one per capture page.
      const pageCrashHandlers = new Map<Page, (err: Error) => void>();
      browser.on('disconnected', onDisconnected);

      const pages: Page[] = [];
      try {
        for (let i = 0; i < pageCount; i++) {
          const page = await browser.newPage();
          const onPageError = (err: Error) =>
            rejectCrashed(
              new Error(`Chromium page crashed mid-capture: ${err.message}`),
            );
          page.on('error', onPageError);
          pageCrashHandlers.set(page, onPageError);
          pages.push(page);
        }
        // Setup runs SEQUENTIALLY: N pages doing goto(networkidle0) + media
        // preload at the same moment multiplies peak RSS by N inside the
        // cgroup-capped pod and was the suspected OOM behind the parallel
        // stall. One page at a time keeps the spike to a single page's worth;
        // only the strides below overlap. Sequential setup is ALSO what makes
        // the eager video warmup safe: a page is front-most (visible) during
        // its own setup, and a hidden headless page cannot create a media
        // pipeline at all — a <video> first given a src while its page has
        // been hidden for a while never fetches a byte, so lazy per-frame
        // video creation wedged the render at every clip switch.
        for (const page of pages) {
          await this.setupFramePage(page, output, width, height, fps, routeOptions, scale);
        }

        // Global completed-count keeps onProgress monotonic across pages: consumers
        // (render progress channel) want "how many frames are done", not per-page cursors.
        let completed = 0;
        const reportProgress = () => {
          completed++;
          if (onProgress) {
            onProgress({ frame: completed, total: totalFrames });
          }
        };

        // Recreate one capture page from scratch: fresh target, crash listener,
        // full setup. Used to retry a watchdog-wedged frame — the wedged page's
        // state (pending CDP call, stuck decoder) is discarded with it.
        const resetPage = async (oldPage: Page): Promise<Page> => {
          const oldHandler = pageCrashHandlers.get(oldPage);
          if (oldHandler) {
            oldPage.off('error', oldHandler);
            pageCrashHandlers.delete(oldPage);
          }
          await oldPage.close().catch(() => {});
          const page = await browser.newPage();
          const onPageError = (err: Error) =>
            rejectCrashed(
              new Error(`Chromium page crashed mid-capture: ${err.message}`),
            );
          page.on('error', onPageError);
          pageCrashHandlers.set(page, onPageError);
          await this.setupFramePage(page, output, width, height, fps, routeOptions, scale);
          return page;
        };

        await Promise.all(
          pages.map((page, pageIndex) =>
            this.captureFrameStride(page, pageIndex, pageCount, totalFrames, fps, durationMs, frameDir, reportProgress, crashed, resetPage),
          ),
        );
      } finally {
        browser.off('disconnected', onDisconnected);
        for (const [page, handler] of pageCrashHandlers) {
          page.off('error', handler);
        }
      }

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
        fontPreloads: fontPreloadsForOutput(output),
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

    // Eager media warmup: images AND videos load now, while this page is the
    // browser's front-most (visible) page. A hidden headless page cannot
    // create a media pipeline — the fetch parks indefinitely — so videos must
    // NOT load lazily per frame (see preload() in frame-renderer-script.ts).
    await page.evaluate(() => (window as any).__FRAME_API.preload());
  }

  /**
   * Capture this page's stride of the frame sequence: global indices
   * `pageIndex, pageIndex + pageCount, …`. Frames are written under their GLOBAL
   * index (`frame-%05d.png`), so per-page files interleave into one contiguous
   * sequence for the encoder.
   *
   * Each frame's render+readback runs under a per-frame watchdog
   * (getFrameTimeoutMs) and races the shared `crashed` rejection. A frame that
   * times out is retried ONCE on a freshly set-up page (`resetPage`) — a single
   * wedged frame must not kill a minutes-long render; a frame that wedges twice
   * (or any non-timeout failure) still aborts the stride.
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
    crashed: Promise<never>,
    resetPage: (oldPage: Page) => Promise<Page>,
  ): Promise<void> {
    const frameTimeoutMs = getFrameTimeoutMs();
    let currentPage = page;
    for (let i = pageIndex; i < totalFrames; i += pageCount) {
      const timeMs = Math.min((i * 1000) / fps, durationMs);
      try {
        await Promise.race([
          this.captureOneFrame(currentPage, i, timeMs, frameDir, frameTimeoutMs),
          crashed,
        ]);
      } catch (err) {
        if (!(err instanceof FrameCaptureTimeoutError)) throw err;
        this._logger.warn(
          `Frame ${i + 1} wedged its capture page (${err.message}); retrying once on a fresh page`,
        );
        currentPage = await resetPage(currentPage);
        await Promise.race([
          this.captureOneFrame(currentPage, i, timeMs, frameDir, frameTimeoutMs),
          crashed,
        ]);
      }

      reportProgress();
    }
  }

  /**
   * Render one frame and write it as PNG, bounded by `timeoutMs`.
   *
   * The frame leaves the page as a canvas `toDataURL` readback in the SAME
   * evaluate as the render — not Page.captureScreenshot, which is compositor-
   * based and pends forever on `hidden` (background) headless pages. The
   * evaluate returning at all proves the render completed; the data URL carries
   * the pixels.
   */
  private async captureOneFrame(
    page: Page,
    frameIndex: number,
    timeMs: number,
    frameDir: string,
    timeoutMs: number,
  ): Promise<void> {
    // Make this page the front-most (visible) one for the duration of its own
    // frame. Hidden headless pages defer NEW network activity indefinitely —
    // that includes media buffer re-fetches after a memory-pressure discard
    // and the reload+reseek wedge recovery in the frame script. Cheap: one
    // CDP call against a ~0.5s frame.
    await page.bringToFront();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new FrameCaptureTimeoutError(
              `Frame ${frameIndex + 1} capture timed out after ${timeoutMs}ms ` +
                '(VIDEO_RENDER_FRAME_TIMEOUT_MS)',
            ),
          ),
        timeoutMs,
      );
    });
    try {
      const dataUrl = await Promise.race([
        page.evaluate(async (t: number) => {
          await (window as any).__FRAME_API.renderFrame(t);
          return (document.getElementById('frame-canvas') as HTMLCanvasElement | null)?.toDataURL('image/png') ?? null;
        }, timeMs),
        timeout,
      ]);

      if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
        throw new Error(
          `Frame ${frameIndex + 1} capture returned no canvas PNG — the frame canvas is missing or unreadable`,
        );
      }

      const framePath = path.join(
        frameDir,
        `frame-${String(frameIndex + 1).padStart(5, '0')}.png`,
      );
      await fs.promises.writeFile(framePath, Buffer.from(dataUrl.slice(PNG_DATA_URL_PREFIX.length), 'base64'));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
