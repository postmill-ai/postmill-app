import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { parseDataUrl } from '@postmill-ai/provider-kernel';
import { DefaultsResolutionService } from '@postmill-ai/nestjs-libraries/ai/defaults/defaults-resolution.service';
import { AiDefaultsService } from '@postmill-ai/nestjs-libraries/ai/defaults/ai-defaults.service';
import { AiMediaService } from '@postmill-ai/nestjs-libraries/ai/governance/media.service';
import { MediaJobLifecycleService } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { DefaultNotConfiguredError } from '@postmill-ai/nestjs-libraries/ai/defaults/defaults.errors';
import {
  aspectBucketForDimensions,
  buildSlideNormalizeFilter,
  SlideAspect,
  SlideFitMode,
} from './slide-aspect';

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

interface Slide {
  script: string;
  imagePrompt: string;
}

export interface SlideGenerationOptions {
  orgId: string;
  userId?: string;
  prompt: string;
  imageUrls?: string[];
  slides?: number;
  durationPerSlideSeconds?: number;
  // Coarse aspect forwarded to the image provider; derived from
  // targetWidth/targetHeight when omitted.
  aspect?: SlideAspect;
  // Target canvas for frame normalization. Both must be present for
  // normalization to run; absent = legacy behavior (the concat demuxer scales
  // every slide to the first frame's dimensions).
  targetWidth?: number;
  targetHeight?: number;
  // Defaults to 'cover' when a target canvas is supplied: social canvases
  // almost always want the frame filled, cropping the overflow.
  fitMode?: SlideFitMode;
}

@Injectable()
export class SlideService {
  private readonly _logger = new Logger(SlideService.name);

  constructor(
    private _defaultsResolution: DefaultsResolutionService,
    private _aiDefaults: AiDefaultsService,
    private _aiMediaService: AiMediaService,
    private _lifecycle: MediaJobLifecycleService,
  ) {}

  async generateSlide(options: SlideGenerationOptions): Promise<string> {
    const { orgId, userId, prompt, imageUrls } = options;

    // Resolve the sub-defaults required by the pipeline. The TTS availability
    // check goes through the SAME capability-driven resolution as
    // POST /media/text-to-speech (listGenerationProviders → _resolveForOperation):
    // the defaults-catalog resolver is a stricter, metadata-category-based gate
    // that can report "no TTS default" for an org whose TTS provider actually
    // works (prod: generate-slide 409'd while /media/text-to-speech succeeded
    // on the org's OpenAI default).
    const [frameDefault, reasoningDefault, ttsProviders] = await Promise.all([
      this._defaultsResolution.resolve('media', 'image-slide', orgId),
      this._defaultsResolution.resolve('ai', 'high-reasoning', orgId),
      this._aiMediaService.listGenerationProviders(orgId, 'tts'),
    ]);

    if (!frameDefault) throw new DefaultNotConfiguredError('image-slide');
    if (!reasoningDefault) throw new DefaultNotConfiguredError('high-reasoning');
    if (!ttsProviders.providers.length) throw new DefaultNotConfiguredError('text-to-speech');

    // 1. Break the script into slides using the high-reasoning default.
    const slides = await this._buildSlides(orgId, prompt, imageUrls);

    // 2. Create a pending media job so the render queue shows progress.
    const job = await this._lifecycle.createPendingJob({
      organizationId: orgId,
      userId,
      provider: frameDefault.providerId,
      operation: 'slide',
      model: frameDefault.model,
      version: frameDefault.version,
      inputJson: JSON.stringify({ prompt, slideCount: slides.length }),
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-slide-'));

    // Frame fitting: a supplied target canvas drives BOTH the image provider's
    // coarse aspect and the per-slide ffmpeg normalization. fitMode defaults
    // to 'cover' (fill the frame) — the common case for social canvases.
    const aspect =
      options.aspect ??
      (options.targetWidth && options.targetHeight
        ? aspectBucketForDimensions(options.targetWidth, options.targetHeight)
        : undefined);
    const normalize =
      options.targetWidth && options.targetHeight
        ? {
            width: options.targetWidth,
            height: options.targetHeight,
            fitMode: options.fitMode ?? ('cover' as SlideFitMode),
          }
        : null;

    try {
      // 3. Generate assets for each slide in parallel.
      const slideAssets = await this._generateSlideAssets(orgId, slides, tmpDir, aspect, normalize);

      // 4. Assemble into a slideshow video.
      const videoPath = path.join(tmpDir, 'output.mp4');
      await this._assembleVideo(slideAssets, videoPath, options.durationPerSlideSeconds ?? 5);

      const buffer = fs.readFileSync(videoPath);
      const ok = await this._lifecycle.completeJobWithBuffer(
        job,
        buffer,
        'video/mp4',
        { provider: frameDefault.providerId, model: frameDefault.model, prompt },
      );
      if (!ok) throw new Error('Failed to store slide video');

      const finished = await this._lifecycle.getJob(job.id, orgId);
      return finished?.artifactUrl || job.id;
    } catch (err) {
      await this._lifecycle.failJob(job, (err as Error).message);
      throw err;
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  }

  private async _buildSlides(orgId: string, prompt: string, imageUrls?: string[]): Promise<Slide[]> {
    const breakdownPrompt = `Break the following topic into a short slideshow. Return ONLY a JSON array of objects with keys "script" (short narration text, 1 sentence) and "imagePrompt" (a vivid image-generation prompt). Topic: ${prompt}`;
    const raw = await this._aiDefaults.highReasoningText(
      orgId,
      breakdownPrompt,
    );

    let parsed: Slide[];
    try {
      const cleaned = raw.replace(/^```json\s*|\s*```$/g, '').trim();
      parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) throw new Error('not an array');
    } catch {
      // Fallback: one slide with the original prompt.
      parsed = [{ script: prompt, imagePrompt: prompt }];
    }

    // If the user supplied reference images, bind them to the first N slides.
    if (imageUrls?.length) {
      parsed = parsed.map((slide, i) =>
        imageUrls[i]
          ? { ...slide, imagePrompt: `${slide.imagePrompt} (reference image: ${imageUrls[i]})` }
          : slide,
      );
    }

    return parsed.slice(0, 12); // Cap at 12 slides.
  }

  private async _generateSlideAssets(
    orgId: string,
    slides: Slide[],
    tmpDir: string,
    aspect?: SlideAspect,
    normalize?: { width: number; height: number; fitMode: SlideFitMode } | null,
  ): Promise<Array<{ imagePath: string; audioPath: string; durationSeconds: number }>> {
    const assets: Array<{ imagePath: string; audioPath: string; durationSeconds: number }> = [];

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      // Narration goes through the exact call POST /media/text-to-speech makes —
      // no defaults-catalog pre-gate (the availability check above already ran
      // through the same resolution), so the two endpoints can never disagree.
      const [imageUrl, audioBuffer] = await Promise.all([
        aspect
          ? this._aiDefaults.textToImage(orgId, slide.imagePrompt, { aspect })
          : this._aiDefaults.textToImage(orgId, slide.imagePrompt),
        this._aiMediaService.textToSpeech(slide.script, { orgId }),
      ]);

      const imagePath = path.join(tmpDir, `slide-${i}.jpg`);
      const audioPath = path.join(tmpDir, `slide-${i}.mp3`);

      await this._downloadImage(imageUrl, imagePath);
      fs.writeFileSync(audioPath, Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer, 'base64'));

      // Normalize each frame to the exact target canvas before concat: the
      // concat demuxer would otherwise scale every slide to the FIRST frame's
      // dimensions, so mixed-size slides (or square AI frames on a 16:9/9:16
      // canvas) used to come out stretched or letterboxed at random.
      let framePath = imagePath;
      if (normalize) {
        framePath = path.join(tmpDir, `slide-${i}.norm.png`);
        await runFfmpeg([
          '-y',
          '-i',
          imagePath,
          '-vf',
          buildSlideNormalizeFilter(normalize.width, normalize.height, normalize.fitMode),
          framePath,
        ]);
      }

      const durationSeconds = await this._getAudioDurationSeconds(audioPath);
      assets.push({ imagePath: framePath, audioPath, durationSeconds: Math.max(durationSeconds, 3) });
    }

    return assets;
  }

  private async _assembleVideo(
    assets: Array<{ imagePath: string; audioPath: string; durationSeconds: number }>,
    outputPath: string,
    minDurationSeconds: number,
  ): Promise<void> {
    // Build a concat demuxer file for the video stream (one image per slide, held for max(audio, min)).
    const durations = assets.map((a) => Math.max(a.durationSeconds, minDurationSeconds));
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);

    const concatLines: string[] = [];
    for (let i = 0; i < assets.length; i++) {
      concatLines.push(`file '${assets[i].imagePath.replace(/'/g, "'\\''")}'`);
      concatLines.push(`duration ${durations[i].toFixed(3)}`);
    }
    // Repeat the last frame to the end.
    concatLines.push(`file '${assets[assets.length - 1].imagePath.replace(/'/g, "'\\''")}'`);

    const concatPath = path.join(path.dirname(outputPath), 'concat.txt');
    fs.writeFileSync(concatPath, concatLines.join('\n'));

    // Mix all slide audios into a single track aligned to slide starts.
    const mixedAudioPath = path.join(path.dirname(outputPath), 'mixed-audio.wav');
    if (assets.length === 1) {
      await runFfmpeg([
        '-y',
        '-i',
        assets[0].audioPath,
        '-ac',
        '2',
        '-ar',
        '48000',
        mixedAudioPath,
      ]);
    } else {
      const inputs: string[] = [];
      const delays: string[] = [];
      let offset = 0;
      for (let i = 0; i < assets.length; i++) {
        inputs.push('-i', assets[i].audioPath);
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
      ]);
    }

    // Encode slideshow: images at 30fps + mixed audio, padded to total duration.
    // Two hard-won ffmpeg behaviors here:
    // - Frame synthesis MUST be the fps filter, not the `-r` output option: the
    //   concat demuxer emits one sparse packet per slide image, and `-r` only
    //   retimes those packets — the video truncates after the first slide.
    // - No `-shortest`: the mixed narration ends before the slideshow does (each
    //   slide is held for max(audio, min)), and `-shortest` would cut the video
    //   to the audio length. `-t` is the exact master-timeline bound.
    await runFfmpeg([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatPath,
      '-i',
      mixedAudioPath,
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
      outputPath,
    ]);
  }

  private async _downloadImage(url: string, destPath: string): Promise<void> {
    // Media adapters may return the generated image inline as a data: URI
    // (e.g. OpenRouter) instead of a hosted URL. safeFetch is an SSRF guard
    // for http/https and rightfully blocks those — decode them locally.
    const dataUrl = url.startsWith('data:') ? parseDataUrl(url) : null;
    if (dataUrl) {
      fs.writeFileSync(destPath, dataUrl.buffer);
      return;
    }
    // Relative specifier: tsc rewrites static import declarations to dist paths
    // but leaves dynamic import() specifiers untouched, and the bare
    // '@postmill-ai/nestjs-libraries/...' alias does not resolve in the built
    // backend (POSTMILL-APP-1D follow-up).
    const { safeFetch } = await import('../../dtos/webhooks/safe.fetch');
    const res = await safeFetch(url);
    if (!res.ok) throw new Error(`Image download failed (${res.status}): ${url}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
  }

  private async _getAudioDurationSeconds(filePath: string): Promise<number> {
    try {
      const mm = await import('music-metadata');
      const meta = await mm.parseFile(filePath);
      if (meta.format.duration) return meta.format.duration;
    } catch {}

    return new Promise((resolve) => {
      const binary = getFfmpegPath();
      const proc = spawn(binary, ['-i', filePath], { stdio: 'pipe' });
      let stderr = '';
      proc.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      proc.on('close', () => {
        const m = stderr.match(/Duration:\s(\d+):(\d+):(\d+\.\d+)/);
        if (!m) return resolve(3);
        const hours = parseInt(m[1], 10);
        const minutes = parseInt(m[2], 10);
        const seconds = parseFloat(m[3]);
        resolve(hours * 3600 + minutes * 60 + seconds);
      });
    });
  }
}
