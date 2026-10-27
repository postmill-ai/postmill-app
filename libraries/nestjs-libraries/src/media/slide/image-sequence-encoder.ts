import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { buildSlideNormalizeFilter, SlideFitMode } from './slide-aspect';

function getFfmpegPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticPath = require('ffmpeg-static') as string | undefined;
    if (staticPath && fs.existsSync(staticPath)) return staticPath;
  } catch {}
  return 'ffmpeg';
}

function runFfmpeg(args: string[], timeoutMs?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const binary = getFfmpegPath();
    const proc = spawn(binary, args, { stdio: 'pipe' });
    let stderr = '';
    let settled = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          proc.kill('SIGKILL');
          reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
        }, timeoutMs)
      : undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    proc.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => finish(err));
    proc.on('close', (code) => {
      if (code === 0) return finish();
      finish(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

export interface ImageSequenceSlide {
  imagePath: string;
  audioPath?: string;
  durationSeconds: number;
}

export interface ImageSequenceEncodeOptions {
  minDurationSeconds?: number;
  targetWidth?: number;
  targetHeight?: number;
  fitMode?: SlideFitMode;
  timeoutMs?: number;
}

export async function encodeImageSequenceToMp4(
  slides: ImageSequenceSlide[],
  outputPath: string,
  options: ImageSequenceEncodeOptions = {},
): Promise<void> {
  if (!slides.length) throw new Error('At least one slide is required');
  if (slides.some((slide) => !Number.isFinite(slide.durationSeconds) || slide.durationSeconds <= 0)) {
    throw new Error('Slide durations must be positive finite numbers');
  }

  const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : null;
  const remainingMs = () => {
    if (!deadline) return undefined;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`ffmpeg timed out after ${options.timeoutMs}ms`);
    return remaining;
  };
  const normalize = options.targetWidth && options.targetHeight
    ? {
        width: options.targetWidth,
        height: options.targetHeight,
        fitMode: options.fitMode ?? ('cover' as SlideFitMode),
      }
    : null;

  const assets = [] as ImageSequenceSlide[];
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    let imagePath = slide.imagePath;
    if (normalize) {
      imagePath = path.join(path.dirname(outputPath), `slide-${i}.norm.png`);
      await runFfmpeg([
        '-y',
        '-i',
        slide.imagePath,
        '-vf',
        buildSlideNormalizeFilter(normalize.width, normalize.height, normalize.fitMode),
        imagePath,
      ], remainingMs());
    }
    assets.push({ ...slide, imagePath });
  }

  const durations = assets.map((asset) => Math.max(asset.durationSeconds, options.minDurationSeconds ?? 0));
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
  const concatLines: string[] = [];
  for (let i = 0; i < assets.length; i++) {
    concatLines.push(`file '${assets[i].imagePath.replace(/'/g, "'\\''")}'`);
    concatLines.push(`duration ${durations[i].toFixed(3)}`);
  }
  concatLines.push(`file '${assets[assets.length - 1].imagePath.replace(/'/g, "'\\''")}'`);

  const concatPath = path.join(path.dirname(outputPath), 'concat.txt');
  fs.writeFileSync(concatPath, concatLines.join('\n'));

  const mixedAudioPath = path.join(path.dirname(outputPath), 'mixed-audio.wav');
  const hasNarration = assets.some((asset) => asset.audioPath);
  if (hasNarration && assets.length === 1) {
    await runFfmpeg([
      '-y',
      '-i',
      assets[0].audioPath!,
      '-ac',
      '2',
      '-ar',
      '48000',
      mixedAudioPath,
    ], remainingMs());
  } else if (hasNarration) {
    const inputs: string[] = [];
    const delays: string[] = [];
    let offset = 0;
    for (let i = 0; i < assets.length; i++) {
      if (assets[i].audioPath) {
        inputs.push('-i', assets[i].audioPath!);
      } else {
        inputs.push(
          '-f',
          'lavfi',
          '-t',
          durations[i].toFixed(3),
          '-i',
          'anullsrc=channel_layout=stereo:sample_rate=48000',
        );
      }
      const delayMs = Math.round(offset * 1000);
      delays.push(`[${i}:a]adelay=delays=${delayMs}|${delayMs}:all=1[ad${i}]`);
      offset += durations[i];
    }
    const mixLabels = assets.map((_, i) => `[ad${i}]`).join('');
    await runFfmpeg([
      '-y',
      ...inputs,
      '-filter_complex',
      `${delays.join(';')};${mixLabels}amix=inputs=${assets.length}:duration=longest:dropout_transition=0[outa]`,
      '-map',
      '[outa]',
      '-ac',
      '2',
      '-ar',
      '48000',
      mixedAudioPath,
    ], remainingMs());
  }

  await runFfmpeg([
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatPath,
    ...(hasNarration
      ? ['-i', mixedAudioPath]
      : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']),
    '-vf',
    'fps=30',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-t',
    totalDuration.toFixed(3),
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath,
  ], remainingMs());
}
