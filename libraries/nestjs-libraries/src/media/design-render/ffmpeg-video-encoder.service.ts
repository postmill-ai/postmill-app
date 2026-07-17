import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import { ChromiumFrameCaptureService } from './chromium-frame-capture.service';
import type { VideoClip, VideoOutput, VideoTrack } from './design-render.types';

function getFfmpegPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticPath = require('ffmpeg-static') as string | undefined;
    if (staticPath && fs.existsSync(staticPath)) return staticPath;
  } catch {}
  return 'ffmpeg';
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const binary = getFfmpegPath();
    const proc = spawn(binary, args, { stdio: 'pipe' });
    let stderr = '';
    proc.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

function resolveMediaUrl(src?: string): string | undefined {
  if (!src) return undefined;
  if (/^(data:|https?:|blob:|file:)/i.test(src)) return src;
  const baseUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:3000';
  const prefix = baseUrl.replace(/\/$/, '');
  if (src.startsWith('/')) return prefix + src;
  return prefix + '/' + src;
}

function getClipDuration(clip: VideoClip): number {
  return clip.endMs - clip.startMs;
}

function getEffectiveEnd(clip: VideoClip): number {
  return clip.endMs + (clip.freezeAtMs || 0);
}

export interface VideoEncodeOptions {
  fps?: number;
  bitrateKbps?: number;
  format?: 'mp4' | 'webm' | 'gif' | 'webp-animated';
  quality?: number;
  jobId?: string;
  orgId?: string;
  renderToken?: string;
}

export interface EncodeResult {
  videoPath: string;
  thumbnailPath: string;
}

interface AudioInput {
  index: number;
  clip: VideoClip;
  track: VideoTrack;
  filePath: string;
  sourceDurationMs: number;
}

@Injectable()
export class FfmpegVideoEncoderService {
  private readonly _logger = new Logger(FfmpegVideoEncoderService.name);

  constructor(
    private _frameCapture: ChromiumFrameCaptureService,
  ) {}

  async encode(
    output: VideoOutput,
    options: VideoEncodeOptions,
  ): Promise<EncodeResult> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-render-'));
    const fps = options.fps || output.fps || 30;
    const bitrateKbps = options.bitrateKbps || 8000;
    const format = options.format || 'mp4';

    try {
      // 1. Capture frame sequence.
      const routeOptions =
        options.jobId && options.orgId && options.renderToken
          ? {
              jobId: options.jobId,
              orgId: options.orgId,
              token: options.renderToken,
            }
          : undefined;
      await this._frameCapture.captureFrames(output, fps, tmpDir, (p) => {
        this._logger.debug(`Frame ${p.frame}/${p.total}`);
      }, routeOptions);

      const durationS = output.durationMs / 1000;
      const videoPath = path.join(tmpDir, `output.${format}`);
      const framePattern = path.join(tmpDir, 'frame-%05d.png');

      if (format === 'gif' || format === 'webp-animated') {
        // Animated image: no audio.
        if (format === 'gif') {
          // Animated GIF: small palette, lanczos scaling.
          await runFfmpeg([
            '-y',
            '-framerate',
            String(fps),
            '-i',
            framePattern,
            '-vf',
            `fps=${fps},scale=${output.width}:${output.height}:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer`,
            '-loop',
            '0',
            videoPath,
          ]);
        } else {
          // Animated WebP via libwebp.
          const webpQuality = Math.round((options.quality ?? 0.8) * 100);
          await runFfmpeg([
            '-y',
            '-framerate',
            String(fps),
            '-i',
            framePattern,
            '-vf',
            `fps=${fps},scale=${output.width}:${output.height}:flags=lanczos`,
            '-c:v',
            'libwebp',
            '-loop',
            '0',
            '-preset',
            'default',
            '-q:v',
            String(webpQuality),
            videoPath,
          ]);
        }
      } else {
        // 2. Mix audio if present.
        const audioPath = await this.mixAudio(output, tmpDir);

        // 3. Encode final video.
        const isWebm = format === 'webm';
        const args = [
          '-y',
          '-framerate',
          String(fps),
          '-i',
          framePattern,
          '-c:v',
          isWebm ? 'libvpx-vp9' : 'libx264',
          ...(isWebm
            ? ['-pix_fmt', 'yuva420p', '-b:v', `${bitrateKbps}k`]
            : [
                '-pix_fmt',
                'yuv420p',
                '-preset',
                'medium',
                '-b:v',
                `${bitrateKbps}k`,
                '-maxrate',
                `${Math.round(bitrateKbps * 1.5)}k`,
                '-bufsize',
                `${bitrateKbps * 2}k`,
              ]),
          '-t',
          String(durationS),
        ];

        if (audioPath) {
          args.push(
            '-i',
            audioPath,
            '-c:a',
            isWebm ? 'libopus' : 'aac',
            '-b:a',
            '128k',
            '-shortest',
          );
        } else {
          args.push('-an');
        }

        args.push(videoPath);
        await runFfmpeg(args);
      }

      // 4. Extract poster (mid-frame).
      const thumbnailPath = path.join(tmpDir, 'thumbnail.jpg');
      await runFfmpeg([
        '-y',
        '-ss',
        String(Math.max(0, durationS / 2)),
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        thumbnailPath,
      ]);

      return { videoPath, thumbnailPath };
    } catch (err) {
      this.cleanup(tmpDir);
      throw err;
    }
  }

  /**
   * Mix all audio clips into a single WAV file aligned to the timeline.
   * Returns the mixed audio path, or null if there are no audible clips.
   */
  async mixAudio(output: VideoOutput, tmpDir: string): Promise<string | null> {
    const audioInputs: AudioInput[] = [];
    const downloadCache = new Map<string, string>();

    for (const track of output.tracks) {
      const trackGain = track.gain ?? 1;
      for (const clip of track.clips) {
        const effectiveEnd = getEffectiveEnd(clip);
        const timelineDuration = effectiveEnd - clip.startMs;
        if (timelineDuration <= 0) continue;
        if (!clip.src) continue;

        const isAudioTrack = track.type === 'audio';
        const isVideoWithAudio = track.type === 'video' && (clip.volume ?? 1) > 0;
        if (!isAudioTrack && !isVideoWithAudio) continue;

        const url = resolveMediaUrl(clip.src);
        if (!url) continue;

        let filePath = downloadCache.get(url);
        if (!filePath) {
          filePath = await this.downloadAudio(url, tmpDir, audioInputs.length);
          downloadCache.set(url, filePath);
        }

        const sourceDurationMs = await this.getAudioDurationMs(filePath);
        audioInputs.push({
          index: audioInputs.length,
          clip,
          track,
          filePath,
          sourceDurationMs,
        });
      }
    }

    if (audioInputs.length === 0) return null;

    const inputs: string[] = [];
    const filters: string[] = [];

    for (const input of audioInputs) {
      const { clip, track, filePath, sourceDurationMs, index } = input;
      const timelineDuration = getEffectiveEnd(clip) - clip.startMs;
      const clipVolume = clip.volume ?? 1;
      const trackGain = track.gain ?? 1;
      const volume = clipVolume * trackGain;
      const fadeInS = (clip.fadeInMs || 0) / 1000;
      const fadeOutS = (clip.fadeOutMs || 0) / 1000;
      const delayMs = clip.startMs;

      // Source trim: respect trimInMs and the portion consumed by speed/reverse.
      let sourceTrimLengthMs = timelineDuration;
      if (clip.speed) sourceTrimLengthMs = timelineDuration * clip.speed;
      const trimInMs = clip.trimInMs || 0;
      const trimOutMs = Math.min(
        trimInMs + sourceTrimLengthMs,
        sourceDurationMs,
      );

      const filterParts: string[] = [];
      filterParts.push(
        `[${index}:a]atrim=start=${trimInMs / 1000}:end=${trimOutMs / 1000},asetpts=PTS-STARTPTS`,
      );

      if (clip.reverse) filterParts.push('areverse');
      if (clip.speed && clip.speed !== 1) {
        // atempo range is 0.5-2.0; chain if needed.
        const tempo = clip.speed;
        if (tempo >= 0.5 && tempo <= 2) {
          filterParts.push(`atempo=${tempo}`);
        } else {
          const chain: number[] = [];
          let remaining = tempo;
          while (remaining > 2) {
            chain.push(2);
            remaining /= 2;
          }
          while (remaining < 0.5) {
            chain.push(0.5);
            remaining /= 0.5;
          }
          chain.push(remaining);
          filterParts.push(...chain.map((v) => `atempo=${v}`));
        }
      }

      if (volume !== 1) filterParts.push(`volume=${volume.toFixed(4)}`);
      if (fadeInS > 0) {
        filterParts.push(`afade=t=in:st=0:d=${fadeInS.toFixed(3)}`);
      }
      if (fadeOutS > 0) {
        const start = Math.max(0, timelineDuration / 1000 - fadeOutS);
        filterParts.push(`afade=t=out:st=${start.toFixed(3)}:d=${fadeOutS.toFixed(3)}`);
      }

      filterParts.push(`adelay=delays=${delayMs}|${delayMs}:all=1`);
      filterParts.push(`[p${index}]`);
      filters.push(filterParts.join(','));

      inputs.push('-i', filePath);
    }

    const voiceInputs = audioInputs.filter((i) => !i.track.autoDuck);
    const duckingInputs = audioInputs.filter((i) => !!i.track.autoDuck);
    const finalLabels: string[] = [];

    if (duckingInputs.length > 0 && voiceInputs.length > 0) {
      // Build a sidechain signal from all non-ducked (voice) audio.
      const voiceLabels = voiceInputs.map((i) => `[p${i.index}]`).join('');
      filters.push(
        `${voiceLabels}amix=inputs=${voiceInputs.length}:duration=longest:dropout_transition=0[voiceMix]`,
      );
      // Duck each music input under the voice signal.
      for (const input of duckingInputs) {
        filters.push(
          `[p${input.index}][voiceMix]sidechaincompress=threshold=-26dB:ratio=4:attack=20:release=250:knee=2[dM${input.index}]`,
        );
        finalLabels.push(`[dM${input.index}]`);
      }
    }

    // Voice inputs go into the final mix (either individually or as the mixed voice stream).
    if (voiceInputs.length > 0 && duckingInputs.length > 0) {
      finalLabels.push('[voiceMix]');
    } else {
      for (const input of voiceInputs) {
        finalLabels.push(`[p${input.index}]`);
      }
    }

    // If nothing was ducking, include any ducking inputs raw.
    if (duckingInputs.length > 0 && voiceInputs.length === 0) {
      for (const input of duckingInputs) {
        finalLabels.push(`[p${input.index}]`);
      }
    }

    const finalMix = finalLabels.join('');
    filters.push(
      `${finalMix}amix=inputs=${finalLabels.length}:duration=longest:dropout_transition=0[outa]`,
    );

    const mixedPath = path.join(tmpDir, 'mixed-audio.wav');
    await runFfmpeg([
      '-y',
      ...inputs,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[outa]',
      '-ac',
      '2',
      '-ar',
      '48000',
      mixedPath,
    ]);

    return mixedPath;
  }

  private async downloadAudio(
    url: string,
    tmpDir: string,
    index: number,
  ): Promise<string> {
    const res = await safeFetch(url);
    if (!res.ok) {
      throw new Error(`Audio download failed (${res.status}): ${url}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = this.guessAudioExt(url, res.headers.get('content-type') || '');
    const filePath = path.join(tmpDir, `audio-${index}.${ext}`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  private guessAudioExt(url: string, contentType: string): string {
    if (contentType.includes('mp4') || contentType.includes('mpeg4')) return 'mp4';
    if (contentType.includes('webm')) return 'webm';
    if (contentType.includes('wav')) return 'wav';
    if (contentType.includes('mp3') || contentType.includes('mpeg')) return 'mp3';
    if (contentType.includes('ogg')) return 'ogg';
    if (contentType.includes('m4a')) return 'm4a';
    const match = url.match(/\.([a-z0-9]{1,16})(?:\?[^\r\n]*)?$/i);
    return match?.[1] || 'bin';
  }

  private async getAudioDurationMs(filePath: string): Promise<number> {
    try {
       
      const mm = await import('music-metadata');
      const meta = await mm.parseFile(filePath);
      const duration = meta.format.duration;
      if (duration) return duration * 1000;
    } catch {}
    // Fallback: probe with ffmpeg.
    return new Promise((resolve) => {
      const binary = getFfmpegPath();
      const proc = spawn(binary, ['-i', filePath], { stdio: 'pipe' });
      let stderr = '';
      proc.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      proc.on('close', () => {
        const m = stderr.match(/Duration:\s(\d+):(\d+):(\d+\.\d+)/);
        if (!m) return resolve(0);
        const hours = parseInt(m[1], 10);
        const minutes = parseInt(m[2], 10);
        const seconds = parseFloat(m[3]);
        resolve((hours * 3600 + minutes * 60 + seconds) * 1000);
      });
    });
  }

  cleanup(tmpDir: string): void {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}
