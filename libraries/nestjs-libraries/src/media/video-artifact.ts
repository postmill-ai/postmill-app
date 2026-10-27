import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REMUX_TIMEOUT_MS = 60_000;
const PROBE_TIMEOUT_MS = 15_000;
const FASTSTART_VIDEO_MIME = new Set([
  'video/mp4',
  'video/x-m4v',
  'video/quicktime',
]);
const VIDEO_EXT: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/x-m4v': '.m4v',
  'video/quicktime': '.mov',
};

export interface CanonicalVideoMetadata {
  dimensions: { width: number; height: number };
  durationMs: number;
}

export interface PreparedVideoArtifact {
  buffer: Buffer;
  metadata?: CanonicalVideoMetadata;
}

export interface PresentedMediaMetadata extends Partial<CanonicalVideoMetadata> {
  mime?: string;
}

export function presentMediaMetadata(value: unknown): PresentedMediaMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const result: PresentedMediaMetadata = {};
  if (typeof source.mime === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(source.mime)) {
    result.mime = source.mime;
  }
  if (typeof source.durationMs === 'number' && Number.isFinite(source.durationMs) && source.durationMs > 0) {
    result.durationMs = source.durationMs;
  }
  const dimensions = source.dimensions;
  if (dimensions && typeof dimensions === 'object' && !Array.isArray(dimensions)) {
    const { width, height } = dimensions as Record<string, unknown>;
    if (
      typeof width === 'number' && Number.isInteger(width) && width > 0 &&
      typeof height === 'number' && Number.isInteger(height) && height > 0
    ) {
      result.dimensions = { width, height };
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function run(
  command: string,
  args: string[],
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

export async function probeVideoMetadata(
  filePath: string,
): Promise<CanonicalVideoMetadata> {
  const stdout = await run(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,width,height,duration:format=duration',
      '-of',
      'json',
      filePath,
    ],
    PROBE_TIMEOUT_MS,
  );
  const probe = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      duration?: string;
    }>;
    format?: { duration?: string };
  };
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const durationSeconds = Number(probe.format?.duration ?? video?.duration);
  if (
    !Number.isInteger(video?.width) ||
    !Number.isInteger(video?.height) ||
    (video?.width ?? 0) <= 0 ||
    (video?.height ?? 0) <= 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    throw new Error('Incomplete video probe metadata');
  }
  return {
    dimensions: { width: video!.width!, height: video!.height! },
    durationMs: Math.round(durationSeconds * 1000),
  };
}

export async function remuxVideoToFaststart(filePath: string): Promise<boolean> {
  const parsed = path.parse(filePath);
  const tmpPath = path.join(
    parsed.dir,
    `${parsed.name}.faststart-tmp${parsed.ext}`,
  );
  try {
    await run(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        filePath,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        tmpPath,
      ],
      REMUX_TIMEOUT_MS,
    );
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // Best effort: the original file remains authoritative.
    }
    return false;
  }
}

export async function prepareVideoArtifact(
  buffer: Buffer,
  mime: string,
): Promise<PreparedVideoArtifact> {
  if (!mime.startsWith('video/')) return { buffer };

  let workDir: string | undefined;
  try {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-video-'));
    const inputPath = path.join(workDir, `artifact${VIDEO_EXT[mime] || '.video'}`);
    fs.writeFileSync(inputPath, buffer);
    const metadata = await probeVideoMetadata(inputPath);
    if (!FASTSTART_VIDEO_MIME.has(mime)) return { buffer, metadata };
    if (!(await remuxVideoToFaststart(inputPath))) {
      return { buffer, metadata };
    }
    return { buffer: fs.readFileSync(inputPath), metadata };
  } catch {
    return { buffer };
  } finally {
    if (workDir) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        // Temporary cleanup must not change artifact completion.
      }
    }
  }
}
