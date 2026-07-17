import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { DefaultsResolutionService } from '@gitroom/nestjs-libraries/ai/defaults/defaults-resolution.service';
import { AiMediaService } from '@gitroom/nestjs-libraries/ai/governance/media.service';
import { MediaJobLifecycleService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { DefaultNotConfiguredError } from '@gitroom/nestjs-libraries/ai/defaults/defaults.errors';

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

interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export const MAX_WORDS_PER_SEGMENT = 12;

export interface CaptionOptions {
  orgId: string;
  userId?: string;
  videoUrl: string;
  style?: 'srt' | 'ass';
}

@Injectable()
export class CaptionService {
  private readonly _logger = new Logger(CaptionService.name);

  constructor(
    private _defaultsResolution: DefaultsResolutionService,
    private _aiMediaService: AiMediaService,
    private _lifecycle: MediaJobLifecycleService,
    private _storage: StorageService,
    private _fileService: FileService,
  ) {}

  async captionVideo(options: CaptionOptions): Promise<string> {
    const { orgId, userId, videoUrl, style = 'ass' } = options;

    // video-caption resolves the org's STT default (e.g. Deepgram).
    const sttDefault = await this._defaultsResolution.resolve('media', 'video-caption', orgId);
    if (!sttDefault) {
      throw new DefaultNotConfiguredError('video-caption');
    }

    const job = await this._lifecycle.createPendingJob({
      organizationId: orgId,
      userId,
      provider: sttDefault.providerId,
      operation: 'caption',
      model: sttDefault.model,
      version: sttDefault.version,
      inputJson: JSON.stringify({ videoUrl }),
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-caption-'));

    try {
      // 1. Read the source video bytes from storage (no outbound HTTP/SSRF surface).
      const { buffer: videoBuffer, mimeType } = await this._readVideo(orgId, videoUrl);
      const sourcePath = path.join(tmpDir, `source.${mimeType === 'video/webm' ? 'webm' : 'mp4'}`);
      fs.writeFileSync(sourcePath, videoBuffer);

      // 2. Transcribe via the STT default.
      const { words } = await this._aiMediaService.speechToTextWords(videoBuffer, { orgId, userId });
      const segments = this._buildSegments(words);

      // 3. Build subtitle file.
      const subtitlePath = path.join(tmpDir, `subtitles.${style}`);
      if (style === 'ass') {
        fs.writeFileSync(subtitlePath, this._buildAss(segments));
      } else {
        fs.writeFileSync(subtitlePath, this._buildSrt(segments));
      }

      // 4. Burn captions with FFmpeg.
      const outputPath = path.join(tmpDir, 'output.mp4');
      await this._burnCaptions(sourcePath, subtitlePath, outputPath, style);

      const buffer = fs.readFileSync(outputPath);
      const ok = await this._lifecycle.completeJobWithBuffer(
        job,
        buffer,
        'video/mp4',
        { provider: sttDefault.providerId, model: sttDefault.model, segments },
      );
      if (!ok) throw new Error('Failed to store captioned video');

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

  private async _readVideo(orgId: string, videoUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
    // If videoUrl is a local file path managed by FileService, resolve through storage.
    const file = await this._fileService.getFileByPath(orgId, videoUrl).catch(() => null);
    if (file) {
      const adapter = file.folderId
        ? await this._storage.resolveAdapterForFolder(file.folderId, orgId)
        : await this._storage.getLocalAdapterForOrg(orgId, true);
      const buffer = await adapter.readFile(file.path);
      return { buffer, mimeType: this._mimeForPath(file.path) };
    }

    // Otherwise, fetch the URL (public URLs only).
    const { safeFetch } = await import('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch');
    const res = await safeFetch(videoUrl);
    if (!res.ok) throw new Error(`Video download failed (${res.status}): ${videoUrl}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type')?.split(';')[0] || 'video/mp4';
    return { buffer, mimeType };
  }

  private _mimeForPath(filePath: string): string {
    const ext = filePath.split('?')[0].split('.').pop()?.toLowerCase() || '';
    if (ext === 'webm') return 'video/webm';
    return 'video/mp4';
  }

  private _buildSegments(words: TranscriptWord[]): TranscriptSegment[] {
    if (!words.length) return [];
    const segments: TranscriptSegment[] = [];
    let current: TranscriptWord[] = [];
    for (const w of words) {
      current.push(w);
      const endsPhrase = /[.!?]$/.test(w.word) || current.length >= MAX_WORDS_PER_SEGMENT;
      if (endsPhrase) {
        segments.push(this._segmentFromWords(current));
        current = [];
      }
    }
    if (current.length) segments.push(this._segmentFromWords(current));
    return segments;
  }

  private _segmentFromWords(words: TranscriptWord[]): TranscriptSegment {
    return {
      start: words[0].start,
      end: words[words.length - 1].end,
      text: words.map((w) => w.word).join(' '),
    };
  }

  // Strip control/override tokens before caption text is burned in: CR/LF would break the
  // SRT cue / ASS dialogue line structure, and `{`/`}` are ASS style-override delimiters
  // (e.g. `{\pos(..)}`) an attacker could inject via a crafted transcript.
  private _sanitizeCaptionText(text: string): string {
    return (text || '').replace(/[\r\n]+/g, ' ').replace(/[{}]/g, '');
  }

  private _buildSrt(segments: TranscriptSegment[]): string {
    return segments
      .map((s, i) => {
        const start = this._formatSrtTime(s.start);
        const end = this._formatSrtTime(s.end);
        return `${i + 1}\n${start} --> ${end}\n${this._sanitizeCaptionText(s.text)}\n`;
      })
      .join('\n');
  }

  private _formatSrtTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const ms = Math.round((secs % 1) * 1000);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(Math.floor(secs)).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  private _buildAss(segments: TranscriptSegment[]): string {
    const events = segments
      .map((s) => {
        const start = this._formatAssTime(s.start);
        const end = this._formatAssTime(s.end);
        return `Dialogue: 0,${start},${end},Default,,0,0,0,,${this._sanitizeCaptionText(s.text).replace(/,/g, '，')}`;
      })
      .join('\n');

    return `[Script Info]
Title: Postmill Auto-Captions
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}`;
  }

  private _formatAssTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const cs = Math.round((secs % 1) * 100);
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(Math.floor(secs)).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  private async _burnCaptions(
    sourcePath: string,
    subtitlePath: string,
    outputPath: string,
    style: 'srt' | 'ass',
  ): Promise<void> {
    const filter = style === 'ass'
      ? `ass='${subtitlePath.replace(/'/g, "'\\''")}'`
      : `subtitles='${subtitlePath.replace(/'/g, "'\\''")}'`;

    await runFfmpeg([
      '-y',
      '-i',
      sourcePath,
      '-vf',
      filter,
      '-c:a',
      'copy',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      outputPath,
    ]);
  }
}
