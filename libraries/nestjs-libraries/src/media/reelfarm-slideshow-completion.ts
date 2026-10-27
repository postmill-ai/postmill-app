import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import { readResponseCapped } from '@postmill-ai/nestjs-libraries/utils/capped-stream';
import { encodeImageSequenceToMp4 } from '@postmill-ai/nestjs-libraries/media/slide/image-sequence-encoder';
import { SlideFitMode } from '@postmill-ai/nestjs-libraries/media/slide/slide-aspect';

const MAX_SLIDES = 20;
const MAX_SLIDE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_SLIDE_BYTES = 100 * 1024 * 1024;
const SLIDE_FETCH_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const ENCODE_TIMEOUT_MS = 120_000;

const ASPECT_DIMENSIONS = {
  '4:5': { width: 1080, height: 1350 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
} as const;

type ReelFarmAspectRatio = keyof typeof ASPECT_DIMENSIONS;

export interface ReelFarmSlideshowOptions {
  aspectRatio: ReelFarmAspectRatio;
  durationSeconds: number;
  fitMode: SlideFitMode;
}

export interface TransformedSlideshow {
  buffer: Buffer;
  mime: 'video/mp4';
  metadata: { durationSeconds: number };
}

export function reelFarmSlideshowOptions(inputJson?: string | null): ReelFarmSlideshowOptions {
  let input: Record<string, unknown> = {};
  try {
    const parsed = inputJson ? JSON.parse(inputJson) : {};
    if (parsed.input && typeof parsed.input === 'object' && !Array.isArray(parsed.input)) {
      input = parsed.input;
    }
  } catch {}

  const aspectRatio = input.aspect_ratio ?? '4:5';
  if (typeof aspectRatio !== 'string' || !(aspectRatio in ASPECT_DIMENSIONS)) {
    throw new Error('Reel.Farm slideshow aspect ratio is invalid');
  }
  const durationSeconds = input.duration ?? 4;
  if (
    typeof durationSeconds !== 'number' ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 1 ||
    durationSeconds > 30
  ) {
    throw new Error('Reel.Farm slide duration must be between 1 and 30 seconds');
  }
  const keepOriginal = input.keep_original_aspect_ratio ?? false;
  if (typeof keepOriginal !== 'boolean') {
    throw new Error('Reel.Farm image fit setting is invalid');
  }

  return {
    aspectRatio: aspectRatio as ReelFarmAspectRatio,
    durationSeconds,
    fitMode: keepOriginal ? 'contain' : 'cover',
  };
}

export async function transformReelFarmSlideshow(
  slides: string[],
  options: ReelFarmSlideshowOptions,
): Promise<TransformedSlideshow> {
  if (!slides.length || slides.length > MAX_SLIDES) {
    throw new Error(`Reel.Farm slideshow must contain between 1 and ${MAX_SLIDES} slides`);
  }
  if (slides.some((url) => typeof url !== 'string' || !url)) {
    throw new Error('Reel.Farm slideshow contains an invalid slide URL');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-reelfarm-'));
  const downloadDeadline = Date.now() + DOWNLOAD_TIMEOUT_MS;
  let totalBytes = 0;
  try {
    const assets: { imagePath: string; durationSeconds: number }[] = [];
    for (let i = 0; i < slides.length; i++) {
      const remainingMs = downloadDeadline - Date.now();
      if (remainingMs <= 0) throw new Error('Reel.Farm slide downloads timed out');
      const res = await safeFetch(slides[i], {
        timeoutMs: Math.min(SLIDE_FETCH_TIMEOUT_MS, remainingMs),
      });
      if (!res.ok) throw new Error(`Reel.Farm slide download failed (${res.status})`);
      const contentLength = Number(res.headers.get('content-length') || 0);
      if (contentLength > MAX_SLIDE_BYTES || totalBytes + contentLength > MAX_TOTAL_SLIDE_BYTES) {
        throw new Error('Reel.Farm slideshow exceeds the image size limit');
      }
      const buffer = await readResponseCapped(
        res,
        Math.min(MAX_SLIDE_BYTES, MAX_TOTAL_SLIDE_BYTES - totalBytes),
        'Reel.Farm slideshow exceeds the image size limit',
      );
      totalBytes += buffer.length;
      const imagePath = path.join(tmpDir, `slide-${i}.img`);
      fs.writeFileSync(imagePath, buffer);
      assets.push({ imagePath, durationSeconds: options.durationSeconds });
    }

    const dimensions = ASPECT_DIMENSIONS[options.aspectRatio];
    const outputPath = path.join(tmpDir, 'output.mp4');
    await encodeImageSequenceToMp4(assets, outputPath, {
      targetWidth: dimensions.width,
      targetHeight: dimensions.height,
      fitMode: options.fitMode,
      timeoutMs: ENCODE_TIMEOUT_MS,
    });
    return {
      buffer: fs.readFileSync(outputPath),
      mime: 'video/mp4',
      metadata: { durationSeconds: options.durationSeconds * slides.length },
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}
