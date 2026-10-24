import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { parseFfmpegDurationSeconds } from '@postmill-ai/nestjs-libraries/media/audio-outro-fade';

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

/** Source videos larger than this are skipped — one frame is never worth
 * buffering gigabytes into the API process. */
export const VIDEO_FRAME_MAX_BYTES = 256 * 1024 * 1024;

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
    proc.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stderr }));
  });
}

/** Grab one JPEG frame at `seekSeconds` into `inPath`. False on any failure. */
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
  return fs.statSync(outPath).size > 0;
}

export interface VideoFrameInfo {
  frame: Buffer | null;
  hasVideoStream: boolean;
  hasAudioStream: boolean;
}

/**
 * Extract a poster frame and report streams found by the existing ffmpeg probe.
 * Seeks to ~0.1s (past a fade-from-black head); degenerate files — unparseable
 * header, or a clip shorter than the seek — fall back to the literal first
 * frame. Failures return a null frame; never throws.
 */
export async function extractVideoFrameInfo(
  buffer: Buffer,
  ext = 'mp4'
): Promise<VideoFrameInfo> {
  const empty = { frame: null, hasVideoStream: false, hasAudioStream: false };
  if (!buffer.length || buffer.length > VIDEO_FRAME_MAX_BYTES) return empty;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-vframe-'));
  try {
    const inPath = path.join(dir, `in.${ext.replace(/[^a-z0-9]/gi, '') || 'mp4'}`);
    const outPath = path.join(dir, 'frame.jpg');
    fs.writeFileSync(inPath, buffer);

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
  } catch {
    return empty;
  } finally {
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
