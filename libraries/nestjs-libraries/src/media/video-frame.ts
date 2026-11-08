import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { Transform, type Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { parseFfmpegDurationSeconds } from '@postmill-ai/nestjs-libraries/media/audio-outro-fade';
import { fromFile } from '@postmill-ai/nestjs-libraries/upload/file-type.compat';

/**
 * Single-frame extraction for video thumbnails/posters. The design preview
 * renderer and the media library both need a still for a stored video; the
 * frame renderer's full ffmpeg pipeline (and its container) is far too heavy
 * for that, so this is the one shared, dependency-light path — the bundled
 * `ffmpeg-static` binary, one JPEG out.
 *
 * Best-effort BY CONSTRUCTION: any failure (missing binary, undecodable
 * bytes, empty output) returns null — a missing thumbnail must never cost
 * the preview render or the upload that triggered it.
 */

/** Where in the clip to grab the poster frame — past a fade-from-black head. */
export const VIDEO_FRAME_SEEK_SECONDS = 0.1;

/** Largest source the legacy whole-buffer path may read into memory. */
export const VIDEO_FRAME_MAX_BYTES = 256 * 1024 * 1024;
/** Hard disk bound for one streamed source; the memory cap stays at 256 MB. */
export const VIDEO_FRAME_STREAM_MAX_BYTES = 2 * 1024 * 1024 * 1024 - 1;
export const VIDEO_FRAME_TIMEOUT_MS = 30_000;
export const VIDEO_FRAME_STREAM_TIMEOUT_MS = 120_000;
const VIDEO_FRAME_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const FFMPEG_STDERR_MAX_BYTES = 64 * 1024;
const emptyFrame = (): VideoFrameInfo => ({
  frame: null,
  hasVideoStream: false,
  hasAudioStream: false,
});
const safeExtension = (ext: string) => ext.replace(/[^a-z0-9]/gi, '') || 'mp4';

// Same binary resolution as audio-outro-fade.ts / slide.service.ts: the
// bundled ffmpeg-static, with a PATH ffmpeg as the fallback.
function getFfmpegPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticPath = require('ffmpeg-static') as string | undefined;
    if (staticPath && fs.existsSync(staticPath)) return staticPath;
  } catch {}
  return 'ffmpeg';
}

interface FfmpegRun {
  code: number | null;
  stderr: string;
}

function runFfmpeg(args: string[]): Promise<FfmpegRun> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFfmpegPath(), args, { stdio: 'pipe' });
    let stderr = '';
    const timeout = setTimeout(() => proc.kill('SIGKILL'), VIDEO_FRAME_TIMEOUT_MS);
    timeout.unref();
    proc.stderr?.on('data', (d) => {
      if (stderr.length < FFMPEG_STDERR_MAX_BYTES) {
        stderr = (stderr + d.toString()).slice(0, FFMPEG_STDERR_MAX_BYTES);
      }
    });
    proc.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stderr });
    });
  });
}

/** Grab one bounded JPEG frame at `seekSeconds` into `outPath`. */
async function grabFrame(
  inPath: string,
  outPath: string,
  seekSeconds: number
): Promise<boolean> {
  const res = await runFfmpeg([
    '-y',
    '-ss',
    seekSeconds.toFixed(3),
    '-i',
    inPath,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    outPath,
  ]);
  if (res.code !== 0 || !fs.existsSync(outPath)) return false;
  const size = fs.statSync(outPath).size;
  return size > 0 && size <= VIDEO_FRAME_MAX_OUTPUT_BYTES;
}

export interface VideoFrameInfo {
  frame: Buffer | null;
  hasVideoStream: boolean;
  hasAudioStream: boolean;
  detectedMime?: string;
}

async function extractAtPath(inPath: string, outPath: string): Promise<VideoFrameInfo> {
  // Duration probe guard: a headerless/degenerate file reports no Duration —
  // seeking past EOF would yield an empty frame, so drop to frame 0.
  const probe = await runFfmpeg(['-hide_banner', '-i', inPath]);
  const hasVideoStream = /^\s*Stream #\d+:\d+.*: Video:/m.test(probe.stderr);
  const hasAudioStream = /^\s*Stream #\d+:\d+.*: Audio:/m.test(probe.stderr);
  if (hasAudioStream && !hasVideoStream) {
    return { frame: null, hasVideoStream, hasAudioStream };
  }
  const duration = parseFfmpegDurationSeconds(probe.stderr);
  const seek =
    duration != null && duration > VIDEO_FRAME_SEEK_SECONDS * 2
      ? VIDEO_FRAME_SEEK_SECONDS
      : 0;

  let frame: Buffer | null = null;
  if (await grabFrame(inPath, outPath, seek)) {
    frame = fs.readFileSync(outPath);
  } else if (seek > 0 && (await grabFrame(inPath, outPath, 0))) {
    // The seek produced nothing (e.g. a stream whose first packet lands
    // later) — one last try at the literal first frame before giving up.
    frame = fs.readFileSync(outPath);
  }
  return { frame, hasVideoStream, hasAudioStream };
}

/** Extract a frame from a bounded in-memory source, preserving the legacy API. */
export async function extractVideoFrameInfo(
  buffer: Buffer,
  ext = 'mp4'
): Promise<VideoFrameInfo> {
  if (!buffer.length || buffer.length > VIDEO_FRAME_MAX_BYTES) return emptyFrame();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-vframe-'));
  try {
    const inPath = path.join(dir, `in.${safeExtension(ext)}`);
    fs.writeFileSync(inPath, buffer);
    return await extractAtPath(inPath, path.join(dir, 'frame.jpg'));
  } catch {
    return emptyFrame();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Stream a source through a bounded temporary file instead of buffering it. */
export async function extractVideoFrameInfoFromStream(
  stream: Readable,
  ext = 'mp4',
  maxBytes = VIDEO_FRAME_STREAM_MAX_BYTES
): Promise<VideoFrameInfo> {
  const limit = Math.min(maxBytes, VIDEO_FRAME_STREAM_MAX_BYTES);
  if (limit <= 0) return emptyFrame();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-vframe-'));
  const inPath = path.join(dir, `in.${safeExtension(ext)}`);
  let bytes = 0;
  const timeout = setTimeout(() => {
    stream.destroy(new Error('Video thumbnail source download timed out'));
  }, VIDEO_FRAME_STREAM_TIMEOUT_MS);
  timeout.unref();
  try {
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > limit) {
          callback(new Error('Video thumbnail source exceeds the streaming size limit'));
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(stream, limiter, fs.createWriteStream(inPath, { flags: 'wx' }));
    clearTimeout(timeout);
    if (!bytes) return emptyFrame();
    const detected = await fromFile(inPath).catch(() => undefined);
    const info = await extractAtPath(inPath, path.join(dir, 'frame.jpg'));
    return { ...info, detectedMime: detected?.mime };
  } catch {
    return emptyFrame();
  } finally {
    clearTimeout(timeout);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Compatibility wrapper for callers that only need the JPEG frame. */
export async function extractVideoFrame(
  buffer: Buffer,
  ext = 'mp4'
): Promise<Buffer | null> {
  return (await extractVideoFrameInfo(buffer, ext)).frame;
}
