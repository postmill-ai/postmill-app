import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { OrgMediaProviderSettingsService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { MediaJobLifecycleService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResult {
  text: string;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
}

// Extension → MIME for the Content-Type Deepgram receives. Deepgram demuxes audio
// from video containers, so video/* sources transcribe fine.
const MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
};

// Phrase chunking for caption segments — mirrors the Designer timeline's grouping so a
// transcript lines up with what auto-captions produce there.
const MAX_WORDS_PER_SEGMENT = 12;

// §6.2: transcription reads the whole source file into memory (no streaming to Deepgram),
// so bound it to protect the backend heap. 250 MB comfortably covers long-form audio and
// short video while blocking a multi-GB source from OOMing the process.
const MAX_TRANSCRIPTION_SOURCE_BYTES = 250 * 1024 * 1024;

// Bespoke Deepgram (STT) studio backend. Unlike the kit studios, Deepgram returns text
// rather than a media artifact, so it has its own controller/service instead of riding
// the generic MediaStudioService.
@Injectable()
export class DeepgramService {
  private readonly _logger = new Logger(DeepgramService.name);

  constructor(
    private readonly _orgMediaProviderSettings: OrgMediaProviderSettingsService,
    private readonly _lifecycle: MediaJobLifecycleService,
    private readonly _aiSettings: AiSettingsService,
    private readonly _storage: StorageService,
    private readonly _fileService: FileService,
    private readonly _resolution: ProviderResolutionService,
  ) {}

  async getStatus(orgId: string): Promise<{ configured: boolean }> {
    const config = await this._orgMediaProviderSettings.getConfigForProvider(orgId, 'deepgram');
    const key = config?.credentials?.apiKey || config?.credentials?.key || config?.credentials?.token;
    return { configured: !!key };
  }

  async transcribe(
    orgId: string,
    params: { fileId: string; model?: string; language?: string },
  ): Promise<TranscriptResult> {
    const config = await this._orgMediaProviderSettings.getConfigForProvider(orgId, 'deepgram');
    const credentials = config?.credentials;
    if (!credentials || Object.keys(credentials).length === 0) {
      throw new ForbiddenException('Deepgram is not configured. Add an API key in Settings → Media.');
    }

    const adapter = this._resolution.resolveMedia('deepgram', {
      version: config.version,
      credentials,
      orgId,
    });
    if (!adapter?.speechToTextWords) {
      throw new ForbiddenException('Deepgram transcription is not available.');
    }

    const { buffer, mimeType } = await this._readFile(orgId, params.fileId);

    const { text, words } = await adapter.speechToTextWords(buffer, {
      credentials,
      model: params.model || 'nova-2',
      mimeType,
      input: {
        smartFormat: true,
        ...(params.language ? { language: params.language } : {}),
      },
    });

    return { text, words, segments: this._buildSegments(words, text) };
  }

  // Persist a transcript as a completed `stt` media job — the transcript text lands in
  // the org's media tree (bypassing the /files import content-type allowlist) and the
  // job row surfaces in the studio render queue via /media/studio/jobs?provider=deepgram.
  // The job is created already-complete, so it never enters the async poll path.
  async saveTranscript(
    orgId: string,
    userId: string | undefined,
    params: { text: string; segments?: TranscriptSegment[] },
  ): Promise<{ jobId: string; path: string }> {
    const config = await this._orgMediaProviderSettings.getConfigForProvider(orgId, 'deepgram');
    const job = await this._lifecycle.createPendingJob({
      organizationId: orgId,
      userId,
      provider: 'deepgram',
      operation: 'stt',
      model: 'deepgram',
      version: config?.version ?? 'v1',
      inputJson: JSON.stringify({ operation: 'stt', segments: params.segments?.length ?? 0 }),
    });
    const ok = await this._lifecycle.completeJobWithBuffer(
      job,
      Buffer.from(params.text, 'utf-8'),
      'text/plain',
      { provider: 'deepgram', ...(params.segments ? { segments: params.segments } : {}) },
    );
    if (!ok) throw new ForbiddenException('Failed to store transcript');
    const stored = await this._aiSettings.getMediaJobById(orgId, job.id);
    return { jobId: job.id, path: stored?.artifactUrl ?? '' };
  }

  // ── internals ──

  private async _readFile(orgId: string, fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const file = await this._fileService.getFileById(orgId, fileId);
    if (!file) {
      throw new ForbiddenException('File not found');
    }
    // §6.2: reject oversized sources up front (using the stored size) so we never even
    // attempt to buffer a multi-GB file into heap.
    if (file.fileSize && file.fileSize > MAX_TRANSCRIPTION_SOURCE_BYTES) {
      throw new ForbiddenException('File is too large to transcribe (max 250 MB).');
    }
    // readFile resolves the bytes for both local (handles full /uploads URLs) and cloud
    // (object key) storage — no outbound HTTP, so no SSRF surface for internal URLs.
    const adapter = file.folderId
      ? await this._storage.resolveAdapterForFolder(file.folderId, orgId)
      : await this._storage.getLocalAdapterForOrg(orgId, true);
    const buffer = await adapter.readFile(file.path);
    // Backstop for a stale/zero fileSize (the row default is 0): a source whose real
    // bytes exceed the ceiling still can't sail through.
    if (buffer.length > MAX_TRANSCRIPTION_SOURCE_BYTES) {
      throw new ForbiddenException('File is too large to transcribe (max 250 MB).');
    }
    return { buffer, mimeType: this._mimeForPath(file.path) };
  }

  private _mimeForPath(path: string): string {
    const ext = path.split('?')[0].split('.').pop()?.toLowerCase() || '';
    return MIME_BY_EXT[ext] || 'audio/mpeg';
  }

  private _buildSegments(words: TranscriptWord[], fallbackText: string): TranscriptSegment[] {
    if (!words.length) {
      return fallbackText ? [{ start: 0, end: 0, text: fallbackText }] : [];
    }
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
}
