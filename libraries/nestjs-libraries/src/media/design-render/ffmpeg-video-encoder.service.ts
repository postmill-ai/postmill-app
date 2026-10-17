import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import { ChromiumFrameCaptureService } from './chromium-frame-capture.service';
import type { FrameCaptureProgress } from './chromium-frame-capture.service';
import { hasVolumeKeyframes } from '../designer-doc/keyframes';
import {
  averageSpeedForClip,
  hasSpeedCurve,
  sourceTimeForClipTime,
} from '../designer-doc/speed-curve';
import {
  sampleVolumeEnvelope,
  volumeEnvelopeExpr,
} from './volume-envelope';
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

/**
 * File extension for a render format. ffmpeg infers the muxer from the output
 * extension, so the internal format id 'webp-animated' must become '.webp' —
 * 'output.webp-animated' fails with "Invalid argument".
 */
export function formatExtension(format: string): string {
  return format === 'webp-animated' ? 'webp' : format;
}

export interface VideoEncodeOptions {
  fps?: number;
  /** Resolution multiplier over the composition canvas (default 1). */
  scale?: number;
  bitrateKbps?: number;
  format?: 'mp4' | 'webm' | 'gif' | 'webp-animated';
  quality?: number;
  jobId?: string;
  orgId?: string;
  renderToken?: string;
  /**
   * Frame-capture progress hook (global completed count). In-process renders wire
   * this to the Redis progress channel; the container worker wires it to the
   * render-progress HTTP route. Never serialized into a job spec.
   */
  onProgress?: (progress: FrameCaptureProgress) => void;
  /**
   * Apply EBU R128 loudness normalization (`loudnorm=I=-14:TP=-1.5`,
   * single-pass) to the final audio mix — the -14 LUFS / -1.5 dBTP target the
   * social platforms normalize to. No-op when the composition has no audio.
   */
  normalizeLoudness?: boolean;
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
    const scale = options.scale && options.scale > 0 ? options.scale : 1;
    // Frames are captured at canvas×scale, so the encoded raster is scaled too.
    const outWidth = Math.round(output.width * scale);
    const outHeight = Math.round(output.height * scale);
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
        options.onProgress?.(p);
      }, routeOptions, scale);

      const durationS = output.durationMs / 1000;
      const videoPath = path.join(tmpDir, `output.${formatExtension(format)}`);
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
            `fps=${fps},scale=${outWidth}:${outHeight}:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer`,
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
            `fps=${fps},scale=${outWidth}:${outHeight}:flags=lanczos`,
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
        const audioPath = await this.mixAudio(output, tmpDir, options.normalizeLoudness === true);

        // 3. Encode final video.
        const isWebm = format === 'webm';
        const args = [
          '-y',
          '-framerate',
          String(fps),
          '-i',
          framePattern,
          // The audio input must follow the frame input directly: placing it
          // after output options (-c:v/-pix_fmt/-t) makes ffmpeg parse those
          // as INPUT options for the wav and abort with "Error parsing
          // options for input file".
          ...(audioPath ? ['-i', audioPath] : []),
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
      if (format === 'webp-animated') {
        // Distro ffmpeg's webp decoder can't read ANIM/ANMF chunks, so
        // re-reading the animated output fails. Convert the mid capture frame
        // instead — identical pixels, no decode of the animated container.
        const totalFrames = Math.max(
          1,
          Math.ceil((output.durationMs / 1000) * fps),
        );
        const midFrame = path.join(
          tmpDir,
          `frame-${String(Math.max(1, Math.floor(totalFrames / 2))).padStart(5, '0')}.png`,
        );
        await runFfmpeg(['-y', '-i', midFrame, '-frames:v', '1', '-q:v', '2', thumbnailPath]);
      } else {
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
      }

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
  async mixAudio(output: VideoOutput, tmpDir: string, normalizeLoudness = false): Promise<string | null> {
    const audioInputs: AudioInput[] = [];
    const downloadCache = new Map<string, string>();

    for (const track of output.tracks) {
      // A muted track contributes nothing to the mix (the preview engine skips
      // it the same way) — and it must not feed the ducking sidechain either.
      // A hidden track is excluded from every renderer, so its audio goes too.
      if (track.muted || track.hidden) continue;
      const trackGain = track.gain ?? 1;
      for (const clip of track.clips) {
        const effectiveEnd = getEffectiveEnd(clip);
        const timelineDuration = effectiveEnd - clip.startMs;
        if (timelineDuration <= 0) continue;
        if (!clip.src) continue;

        const isAudioTrack = track.type === 'audio';
        // A base volume of 0 no longer silences the clip when volume keyframes
        // raise it above zero somewhere along the clip.
        const keyframedAudible =
          hasVolumeKeyframes(clip) &&
          (clip.keyframes || []).some((kf) => (kf.props.volume ?? 0) > 0);
        const isVideoWithAudio =
          track.type === 'video' && ((clip.volume ?? 1) > 0 || keyframedAudible);
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
      // A speed ramp collapses to the clip's AVERAGE speed for audio: this
      // chain (atrim + atempo) is constant-rate, so the source window becomes
      // the curve's INTEGRATED consumption (what the per-frame video mapping
      // actually reads) and the tempo its average. Variable-tempo audio is a
      // separate project; the picture still ramps per frame.
      let tempo = clip.speed;
      if (hasSpeedCurve(clip) && clip.speed !== 0) {
        sourceTrimLengthMs =
          sourceTimeForClipTime(clip, timelineDuration) - (clip.trimInMs || 0);
        tempo = averageSpeedForClip(clip);
        this._logger.warn(
          `Clip ${clip.id} has a speedCurve: mixing its audio at the average speed (${tempo.toFixed(3)}x), not a variable tempo`,
        );
      }
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
      if (tempo && tempo !== 1) {
        // atempo range is 0.5-2.0; chain if needed.
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

      // Volume: constant when the clip carries no volume keyframes, otherwise
      // a piecewise-linear expression sampled from the SHARED interpolation at
      // 100ms steps — the same function the preview evaluates per tick, so a
      // bezier easing quantises identically on both sides. Track gain is baked
      // into the envelope values (the preview multiplies it per tick). The
      // expression sits after atrim/asetpts (and any atempo), so its `t` is
      // seconds from the clip's LOCAL start — the keyframe timeline. Fades
      // stay separate afade filters below and multiply downstream, mirroring
      // the preview's composition order.
      const envelope = hasVolumeKeyframes(clip)
        ? sampleVolumeEnvelope(clip, trackGain, timelineDuration)
        : null;
      const envelopeExpr = envelope ? volumeEnvelopeExpr(envelope) : null;
      if (envelopeExpr) {
        // Single quotes: the expression contains commas, which the filtergraph
        // parser would otherwise read as filter separators.
        filterParts.push(`volume='${envelopeExpr}':eval=frame`);
      } else if (envelope) {
        // Keyframed but sampled flat — the constant filter is the same
        // automation (and covers the expression's null case by construction).
        const flat = envelope[0].v;
        if (flat !== 1) filterParts.push(`volume=${flat.toFixed(4)}`);
      } else if (volume !== 1) {
        filterParts.push(`volume=${volume.toFixed(4)}`);
      }
      if (fadeInS > 0) {
        filterParts.push(`afade=t=in:st=0:d=${fadeInS.toFixed(3)}`);
      }
      if (fadeOutS > 0) {
        const start = Math.max(0, timelineDuration / 1000 - fadeOutS);
        filterParts.push(`afade=t=out:st=${start.toFixed(3)}:d=${fadeOutS.toFixed(3)}`);
      }

      filterParts.push(`adelay=delays=${delayMs}|${delayMs}:all=1`);
      // The output pad label terminates the chain: appended WITHOUT a comma —
      // `filter,[label]` parses as an empty filter and ffmpeg aborts with
      // "No such filter: ''".
      filters.push(`${filterParts.join(',')}[p${index}]`);

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
    // Loudness normalization sits AFTER the final mix so it measures (and
    // gains) the summed signal, not one stem — single-pass loudnorm at the
    // social-platform target (-14 LUFS integrated, -1.5 dBTP).
    const loudnorm = normalizeLoudness ? ',loudnorm=I=-14:TP=-1.5' : '';
    filters.push(
      `${finalMix}amix=inputs=${finalLabels.length}:duration=longest:dropout_transition=0${loudnorm}[outa]`,
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
