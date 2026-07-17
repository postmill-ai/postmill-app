import { Injectable, Logger } from '@nestjs/common';
import puppeteer from 'puppeteer';
import * as path from 'path';
import { FRAME_RENDERER_SCRIPT, escapeForScriptTag } from './frame-renderer-script';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
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
  const bg = (output as any)?.bg;
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
   * Files are named `frame-00001.png`, `frame-00002.png`, etc.
   * Returns the number of frames written.
   */
  async captureFrames(
    output: VideoOutput,
    fps: number,
    frameDir: string,
    onProgress?: (progress: FrameCaptureProgress) => void,
    routeOptions?: RenderRouteOptions,
  ): Promise<number> {
    const width = output.width;
    const height = output.height;
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
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });

      const baseUrl =
        process.env.NEXT_PUBLIC_BACKEND_URL ||
        process.env.FRONTEND_URL ||
        'http://localhost:3000';

      if (routeOptions) {
        const renderUrl = `${baseUrl.replace(/\/$/, '')}/media/designs/render-frame/${routeOptions.jobId}?token=${encodeURIComponent(routeOptions.token)}`;
        await page.goto(renderUrl, { waitUntil: 'networkidle0' });
      } else {
        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <base href="${baseUrl}">
  <style>body{margin:0;background:#000}</style>
</head>
<body>
  <canvas id="frame-canvas"></canvas>
  <script>
    window.__DATA = {
      output: ${escapeForScriptTag(output)},
      baseUrl: ${escapeForScriptTag(baseUrl)}
    };
    ${FRAME_RENDERER_SCRIPT}
  </script>
</body>
</html>`;

        await page.setContent(html, { waitUntil: 'networkidle0' });
      }
      await page.waitForFunction(
        () => !!(window as any).__FRAME_API,
        { timeout: 30000 },
      );

      // Preload images/videos so frame rendering is not stalled by network.
      await page.evaluate(() => (window as any).__FRAME_API.preload());

      for (let i = 0; i < totalFrames; i++) {
        const timeMs = Math.min((i * 1000) / fps, durationMs);
        await page.evaluate(
          (t: number) => (window as any).__FRAME_API.renderFrame(t),
          timeMs,
        );

        const framePath = path.join(
          frameDir,
          `frame-${String(i + 1).padStart(5, '0')}.png`,
        );
        const canvas = await page.$('#frame-canvas');
        if (!canvas) {
          throw new Error('Frame canvas disappeared during capture');
        }
        await canvas.screenshot({ path: framePath, type: 'png' });

        if (onProgress) {
          onProgress({ frame: i + 1, total: totalFrames });
        }
      }

      this._logger.log(
        `Captured ${totalFrames} frames (${width}x${height} @ ${fps}fps)`,
      );
      return totalFrames;
    } finally {
      await browser.close();
    }
  }
}
