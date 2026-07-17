import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import type { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';

const execFileAsync = promisify(execFile);

interface Clip {
  url?: string;
  fileId?: string;
  trimStart?: number;
  trimEnd?: number;
}

interface Transition {
  type: string;
  duration?: number;
}

const MAX_CLIPS = 6;
const MAX_CLIP_SIZE = 500 * 1024 * 1024;
const MAX_TOTAL_SIZE = 1024 * 1024 * 1024;

const TRANSITION_MAP: Record<string, string> = {
  fade: 'fade',
  'xfade-wipe': 'wiperight',
  dissolve: 'dissolve',
  fadegrayscale: 'fadegrayscale',
  pixelize: 'pixelize',
  radial: 'radial',
};

async function resolveClipBuffer(
  clip: Clip,
  index: number,
  orgId: string,
  storageService: StorageService,
  resolveFileId: (fileId: string) => Promise<string>,
): Promise<Buffer> {
  if (clip.fileId) {
    const filePath = await resolveFileId(clip.fileId);
    const adapter = await storageService.resolveAdapterForFolder(null, orgId);
    return adapter.readFile(filePath);
  }

  if (clip.url) {
    const response = await safeFetch(clip.url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch clip ${index + 1}: ${response.status} ${response.statusText}`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error(`Clip ${index + 1} must have either url or fileId`);
}

async function trimClip(
  buffer: Buffer,
  trimStart: number | undefined,
  trimEnd: number | undefined,
  workDir: string,
  clipIdx: number,
): Promise<Buffer> {
  const inputPath = join(workDir, `trim_in_${clipIdx}.mp4`);
  const outputPath = join(workDir, `trim_out_${clipIdx}.mp4`);
  await writeFile(inputPath, buffer);

  const args: string[] = ['-y', '-i', inputPath];
  if (trimStart !== undefined) {
    args.push('-ss', String(trimStart));
  }
  if (trimEnd !== undefined) {
    args.push('-to', String(trimEnd));
  }
  args.push('-c', 'copy', outputPath);

  try {
    await execFileAsync('ffmpeg', args);
    return await readFile(outputPath);
  } finally {
    try {
      await unlink(inputPath);
    } catch {
      /* ignore */
    }
    try {
      await unlink(outputPath);
    } catch {
      /* ignore */
    }
  }
}

async function getVideoDuration(filePath: string): Promise<number> {
  const probe = async (extraArgs: string[]): Promise<number | undefined> => {
    // util.promisify(execFile) resolves to stdout directly (not { stdout, stderr }).
    const stdout = await execFileAsync('ffprobe', [
      '-v',
      'error',
      ...extraArgs,
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const parsed = parseFloat(stdout.toString().trim());
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
    return undefined;
  };

  try {
    const streamDuration = await probe([
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=duration',
    ]);
    if (streamDuration !== undefined) {
      return streamDuration;
    }
  } catch {
    /* fall through to format duration */
  }

  try {
    const formatDuration = await probe(['-show_entries', 'format=duration']);
    if (formatDuration !== undefined) {
      return formatDuration;
    }
  } catch {
    /* fall through to error */
  }

  throw new Error(`Could not determine duration for ${filePath}`);
}

export interface LocalMergeInput {
  /** Absolute (or workdir-relative, resolved by caller) path to a raw clip file. */
  path: string;
  trimStart?: number;
  trimEnd?: number;
}

/**
 * Pure ffmpeg trim + xfade/acrossfade merge over already-resolved LOCAL files. No storage
 * or network access — this is the portion that runs inside the Podman render worker (and
 * in-process as a fallback). Writes the merged result to `outputPath`.
 */
export async function mergeLocalFiles(
  inputs: LocalMergeInput[],
  transitions: Transition[],
  workDir: string,
  outputPath: string,
): Promise<void> {
  if (inputs.length === 0) {
    throw new Error('At least one clip is required');
  }
  if (inputs.length > MAX_CLIPS) {
    throw new Error(`Maximum ${MAX_CLIPS} clips allowed`);
  }

  const tempFiles: string[] = [];
  for (let i = 0; i < inputs.length; i++) {
    let buffer = await readFile(inputs[i].path);
    if (inputs[i].trimStart !== undefined || inputs[i].trimEnd !== undefined) {
      buffer = await trimClip(buffer, inputs[i].trimStart, inputs[i].trimEnd, workDir, i);
    }
    const tempPath = join(workDir, `clip_${i}.mp4`);
    await writeFile(tempPath, buffer);
    tempFiles.push(tempPath);
  }

  if (tempFiles.length === 1) {
    await execFileAsync('ffmpeg', ['-y', '-i', tempFiles[0], '-c', 'copy', outputPath]);
    return;
  }

  const ffmpegInputs: string[] = [];
  for (const tf of tempFiles) {
    ffmpegInputs.push('-i', tf);
  }

  const durations: number[] = [];
  for (const tf of tempFiles) {
    durations.push(await getVideoDuration(tf));
  }

  const filterParts: string[] = [];
  let lastVideo = '[0:v]';
  let lastAudio = '[0:a]';

  for (let i = 1; i < tempFiles.length; i++) {
    const transIdx = i - 1;
    const transition = transitions[transIdx];
    const duration = transition?.duration ?? 0.5;
    const effect = TRANSITION_MAP[transition?.type || 'fade'] || 'fade';

    // Offset for the transition between clip i-1 and clip i is the sum of all
    // clip durations up to and including clip i-1, minus the sum of all transition
    // durations up to and including this transition.
    let offset = 0;
    for (let j = 0; j < i; j++) {
      offset += durations[j];
    }
    for (let j = 0; j <= transIdx; j++) {
      const priorDuration = transitions[j]?.duration ?? 0.5;
      offset -= priorDuration;
    }

    const vidOut = `[v${i}]`;
    const audOut = `[a${i}]`;

    filterParts.push(
      `${lastVideo}[${i}:v]xfade=transition=${effect}:duration=${duration}:offset=${offset}${vidOut};`,
    );
    filterParts.push(`${lastAudio}[${i}:a]acrossfade=d=${duration}${audOut};`);

    lastVideo = vidOut;
    lastAudio = audOut;
  }

  await execFileAsync('ffmpeg', [
    '-y',
    ...ffmpegInputs,
    '-filter_complex',
    filterParts.join(''),
    '-map',
    lastVideo.replace(/[[\]]/g, ''),
    '-map',
    lastAudio.replace(/[[\]]/g, ''),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    outputPath,
  ]);
}

/**
 * Resolve clips (storage/URL) into raw files in `workDir` and return their local-merge
 * inputs. This is the host-side step (keeps storage creds out of the render container).
 * Enforces per-clip and total size caps.
 */
export async function resolveClipsToFiles(
  clips: Clip[],
  orgId: string,
  storageService: StorageService,
  resolveFileId: (fileId: string) => Promise<string>,
  workDir: string,
): Promise<LocalMergeInput[]> {
  if (clips.length === 0) {
    throw new Error('At least one clip is required');
  }
  if (clips.length > MAX_CLIPS) {
    throw new Error(`Maximum ${MAX_CLIPS} clips allowed`);
  }

  const out: LocalMergeInput[] = [];
  let totalSize = 0;
  for (let i = 0; i < clips.length; i++) {
    const buffer = await resolveClipBuffer(clips[i], i, orgId, storageService, resolveFileId);
    if (buffer.length > MAX_CLIP_SIZE) {
      throw new Error(`Clip ${i + 1} exceeds 500 MB limit`);
    }
    totalSize += buffer.length;
    if (totalSize > MAX_TOTAL_SIZE) {
      throw new Error('Total clip size exceeds 1 GB limit');
    }
    const rawPath = join(workDir, `raw_${i}.mp4`);
    await writeFile(rawPath, buffer);
    out.push({ path: rawPath, trimStart: clips[i].trimStart, trimEnd: clips[i].trimEnd });
  }
  return out;
}

/**
 * Back-compat one-shot merge (resolve + merge in-process). Retained for the in-process
 * fallback path and any existing callers.
 */
export async function mergeClips(
  clips: Clip[],
  transitions: Transition[],
  orgId: string,
  storageService: StorageService,
  resolveFileId: (fileId: string) => Promise<string>,
): Promise<Buffer> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'replicate-merge-'));
  try {
    const inputs = await resolveClipsToFiles(
      clips,
      orgId,
      storageService,
      resolveFileId,
      tmpDir,
    );
    const outputPath = join(tmpDir, 'merged.mp4');
    await mergeLocalFiles(inputs, transitions, tmpDir, outputPath);
    return await readFile(outputPath);
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
