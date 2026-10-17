import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { AiDefaultsService } from '@postmill-ai/nestjs-libraries/ai/defaults/ai-defaults.service';
import { MediaJobLifecycleService } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import { readResponseCapped } from '@postmill-ai/nestjs-libraries/utils/capped-stream';

// Segment transforms are the expensive part of video-to-video; cap the span so
// a "regenerate this bit" request cannot turn into a full-length render.
export const MAX_SEGMENT_SPAN_MS = 30_000;

// Defensive cap when downloading the source video (matches the lifecycle
// artifact cap — sources are user-media of the same order).
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;

function getFfmpegPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticPath = require('ffmpeg-static') as string | undefined;
    if (staticPath && fs.existsSync(staticPath)) return staticPath;
  } catch {}
  return 'ffmpeg';
}

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const binary = getFfmpegPath();
    const proc = spawn(binary, args, { stdio: 'pipe' });
    let stderr = '';
    proc.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) return resolve(stderr);
      reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

// ffmpeg -i exits non-zero (no output file), so the duration comes from stderr
// regardless of the exit code. Null when ffmpeg can't parse the container.
function probeSourceDurationMs(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const binary = getFfmpegPath();
    const proc = spawn(binary, ['-i', filePath], { stdio: 'pipe' });
    let stderr = '';
    proc.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const m = stderr.match(/Duration:\s(\d+):(\d+):(\d+\.\d+)/);
      if (!m) return resolve(null);
      resolve(
        Math.round(
          (parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3])) * 1000,
        ),
      );
    });
  });
}

export interface VideoSegmentTransformOptions {
  videoUrl: string;
  prompt: string;
  trimStartMs: number;
  trimEndMs: number;
  userId?: string;
}

@Injectable()
export class VideoSegmentTransformService {
  private readonly _logger = new Logger(VideoSegmentTransformService.name);

  constructor(
    private _aiDefaults: AiDefaultsService,
    private _lifecycle: MediaJobLifecycleService,
    private _storage: StorageService,
    private _fileService: FileService,
  ) {}

  /**
   * Trim-aware video-to-video: extract [trimStartMs, trimEndMs] from the source
   * with a re-encoding ffmpeg trim (never `-c copy` — keyframe drift would let
   * the provider see frames outside the requested window), land the segment in
   * tenant storage so the provider can fetch it by URL, then hand off to the
   * standard videoToVideo flow (same default resolution, budget ledger entry
   * and job lifecycle as the whole-clip endpoint).
   *
   * Returns the AIMediaJob id to poll, or — for synchronous providers — the
   * stored artifact URL (same contract as AiDefaultsService.videoToVideo).
   */
  async transformSegment(orgId: string, options: VideoSegmentTransformOptions): Promise<string> {
    const { videoUrl, prompt, userId } = options;
    let { trimStartMs, trimEndMs } = options;

    if (!Number.isFinite(trimStartMs) || !Number.isFinite(trimEndMs)) {
      throw new BadRequestException('trimStartMs and trimEndMs must be finite numbers');
    }
    trimStartMs = Math.max(0, Math.round(trimStartMs));
    trimEndMs = Math.round(trimEndMs);
    if (trimEndMs <= trimStartMs) {
      throw new BadRequestException('trimEndMs must be greater than trimStartMs');
    }
    if (trimEndMs - trimStartMs > MAX_SEGMENT_SPAN_MS) {
      throw new BadRequestException(
        `Segment span exceeds the ${MAX_SEGMENT_SPAN_MS / 1000}s limit`,
      );
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-segment-'));
    try {
      const { buffer, mimeType } = await this._readVideo(orgId, videoUrl);
      const sourcePath = path.join(tmpDir, `source.${mimeType === 'video/webm' ? 'webm' : 'mp4'}`);
      fs.writeFileSync(sourcePath, buffer);

      // Probe the source duration and clamp the window to it.
      const durationMs = await probeSourceDurationMs(sourcePath);
      if (durationMs !== null) {
        trimEndMs = Math.min(trimEndMs, durationMs);
        if (trimEndMs <= trimStartMs) {
          throw new BadRequestException('Segment window is outside the source duration');
        }
        // The window covers the whole source — the trim would be a wasteful
        // re-encode; run the whole-clip flow on the original URL.
        if (trimStartMs === 0 && trimEndMs >= durationMs) {
          return this._aiDefaults.videoToVideo(orgId, prompt, videoUrl);
        }
      }

      const segmentPath = path.join(tmpDir, 'segment.mp4');
      await this._trimReencode(sourcePath, segmentPath, trimStartMs, trimEndMs - trimStartMs);

      const stored = await this._lifecycle.storeInputArtifact({
        organizationId: orgId,
        buffer: fs.readFileSync(segmentPath),
        mime: 'video/mp4',
        baseName: `segment-${Date.now()}`,
      });

      return await this._aiDefaults.videoToVideo(orgId, prompt, stored.path);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  }

  // Storage-first read (the URL usually points at our own tenant storage) with a
  // safeFetch fallback for genuinely external URLs — same shape as
  // CaptionService._readVideo, plus a streamed byte cap on the fetch path.
  private async _readVideo(orgId: string, videoUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const file = await this._fileService.getFileByPath(orgId, videoUrl).catch(() => null);
    if (file) {
      const adapter = file.folderId
        ? await this._storage.resolveAdapterForFolder(file.folderId, orgId)
        : await this._storage.getLocalAdapterForOrg(orgId, true);
      const buffer = await adapter.readFile(file.path);
      return { buffer, mimeType: this._mimeForPath(file.path) };
    }

    const res = await safeFetch(videoUrl);
    if (!res.ok) throw new Error(`Video download failed (${res.status}): ${videoUrl}`);
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > MAX_SOURCE_BYTES) throw new Error('Source video exceeds the size limit');
    const buffer = await readResponseCapped(res, MAX_SOURCE_BYTES, 'Source video exceeds the size limit');
    const mimeType = res.headers.get('content-type')?.split(';')[0] || 'video/mp4';
    return { buffer, mimeType };
  }

  private _mimeForPath(filePath: string): string {
    const ext = filePath.split('?')[0].split('.').pop()?.toLowerCase() || '';
    if (ext === 'webm') return 'video/webm';
    return 'video/mp4';
  }

  // Re-encoding trim (libx264/aac): -ss before -i seeks on the input side, and
  // the re-encode makes the cut frame-accurate regardless of keyframe spacing.
  private async _trimReencode(
    sourcePath: string,
    outputPath: string,
    startMs: number,
    spanMs: number,
  ): Promise<void> {
    await runFfmpeg([
      '-y',
      '-ss',
      (startMs / 1000).toFixed(3),
      '-i',
      sourcePath,
      '-t',
      (spanMs / 1000).toFixed(3),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      outputPath,
    ]);
  }
}
