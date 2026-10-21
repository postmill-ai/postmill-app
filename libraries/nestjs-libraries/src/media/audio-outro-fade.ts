import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';

/**
 * Generated music (Suno & co.) stops dead at the last sample — the hard cut
 * plays back as a click/crackle at the track end. Baking a short fade-out into
 * the stored artifact fixes it once for every consumer (timeline preview,
 * export mixer, downloads) instead of each player working around it.
 *
 * Best-effort BY CONSTRUCTION: every failure path returns the original bytes —
 * a failed fade must never cost the artifact.
 */

/** Outro fade length baked into generated music artifacts. */
export const AUDIO_OUTRO_FADE_MS = 400;

// Containers the fade re-encodes into. Anything else (ogg/m4a/…) is stored
// verbatim rather than transcoded by a guessed codec.
const FADEABLE_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};

// Same binary resolution as slide.service.ts: the bundled ffmpeg-static, with
// a PATH ffmpeg as the fallback.
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

/**
 * Container duration parsed from `ffmpeg -i` stderr (`Duration: HH:MM:SS.cs`).
 * Returns null when absent/unparseable — the caller stores the original.
 */
export function parseFfmpegDurationSeconds(stderr: string): number | null {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(sec) && sec > 0 ? sec : null;
}

/**
 * `buffer` with a ~400ms `afade=t=out` anchored at the track end
 * (st = duration − d), re-encoded into the same container. The duration comes
 * from provider metadata when known, else an `ffmpeg -i` header probe. ANY
 * failure — unknown container, missing ffmpeg, unparseable duration, non-zero
 * exit, empty output — returns the original buffer.
 */
export async function applyAudioOutroFade(
  buffer: Buffer,
  mime: string,
  durationSeconds?: number,
): Promise<Buffer> {
  const ext = FADEABLE_EXT[mime];
  if (!ext || !buffer.length) return buffer;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-afade-'));
  try {
    const inPath = path.join(dir, `in.${ext}`);
    const outPath = path.join(dir, `out.${ext}`);
    fs.writeFileSync(inPath, buffer);

    let totalSeconds =
      durationSeconds && Number.isFinite(durationSeconds) && durationSeconds > 0
        ? durationSeconds
        : null;
    if (totalSeconds == null) {
      // `ffmpeg -i` prints the container duration to stderr and exits non-zero
      // (no output specified) — that non-zero IS the probe, not a failure.
      const probe = await runFfmpeg(['-hide_banner', '-i', inPath]);
      totalSeconds = parseFfmpegDurationSeconds(probe.stderr);
    }
    if (totalSeconds == null) return buffer;

    // Capped at half the track so a very short clip keeps audible body.
    const fadeSec = Math.min(AUDIO_OUTRO_FADE_MS / 1000, totalSeconds / 2);
    const startSec = Math.max(0, totalSeconds - fadeSec);
    const res = await runFfmpeg([
      '-y',
      '-i',
      inPath,
      '-af',
      `afade=t=out:st=${startSec.toFixed(3)}:d=${fadeSec.toFixed(3)}`,
      outPath,
    ]);
    if (res.code !== 0 || !fs.existsSync(outPath)) return buffer;
    const faded = fs.readFileSync(outPath);
    return faded.length ? faded : buffer;
  } catch {
    // A missing/unrunnable ffmpeg binary (spawn ENOENT) lands here.
    return buffer;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
