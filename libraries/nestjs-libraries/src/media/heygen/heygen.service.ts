import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AIMediaJob } from '@prisma/client';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { OrgMediaProviderSettingsService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { MediaJobLifecycleService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { redactError } from '@gitroom/provider-kernel';

const BASE = 'https://api.heygen.com';

// Avatar/voice catalogs are tied to the account (API key), not tenant content, and
// change rarely — cache per-org for an hour to keep the pickers snappy.
const CATALOG_TTL_SECONDS = 60 * 60;

// Default render size (16:9). The Studio sends an explicit dimension per generate.
const DEFAULT_DIMENSION = { width: 1280, height: 720 };

export interface HeyGenScene {
  avatarId?: string;
  talkingPhotoId?: string;
  avatarStyle?: string;
  scale?: number;
  voiceId: string;
  inputText: string;
  speed?: number;
  background?: { type: 'color' | 'image' | 'video'; color?: string; fileId?: string };
}

export interface CreateAvatarVideoParams {
  scenes: HeyGenScene[];
  dimension?: { width: number; height: number };
  title?: string;
  folderId?: string | null;
}

interface HeyGenAvatarsResponse {
  data?: {
    avatars?: Array<{ avatar_id?: string; avatar_name?: string; gender?: string; preview_image_url?: string }>;
    talking_photos?: Array<{ talking_photo_id?: string; talking_photo_name?: string; preview_image_url?: string }>;
  };
}

interface HeyGenVoicesResponse {
  data?: {
    voices?: Array<{
      voice_id?: string;
      name?: string;
      language?: string;
      gender?: string;
      preview_audio?: string;
      support_pause?: boolean;
      emotion_support?: boolean;
    }>;
  };
}

interface HeyGenGenerateResponse {
  data?: { video_id?: string };
  error?: { message?: string } | string | null;
}

@Injectable()
export class HeyGenService {
  private readonly _logger = new Logger(HeyGenService.name);

  constructor(
    private readonly _orgMediaProviderSettings: OrgMediaProviderSettingsService,
    private readonly _lifecycle: MediaJobLifecycleService,
    private readonly _aiSettings: AiSettingsService,
    private readonly _storage: StorageService,
    private readonly _fileService: FileService,
  ) {}

  // ── Credentials ──

  private async _getConfig(orgId: string): Promise<{ key: string; version: string }> {
    const config = await this._orgMediaProviderSettings.getConfigForProvider(orgId, 'heygen');
    const key = config?.credentials?.apiKey || config?.credentials?.key || config?.credentials?.token;
    if (!key) {
      throw new ForbiddenException('HeyGen is not configured. Add an API key in Settings → Media.');
    }
    return { key, version: config?.version ?? 'v1' };
  }

  private async _getApiKey(orgId: string): Promise<string> {
    return (await this._getConfig(orgId)).key;
  }

  private _headers(apiKey: string): Record<string, string> {
    return {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': apiKey,
    };
  }

  async getStatus(orgId: string): Promise<{ configured: boolean }> {
    const config = await this._orgMediaProviderSettings.getConfigForProvider(orgId, 'heygen');
    const key = config?.credentials?.apiKey || config?.credentials?.key || config?.credentials?.token;
    return { configured: !!key };
  }

  // ── Catalogs (cached) ──

  async listAvatars(orgId: string) {
    const cacheKey = `heygen:avatars:${orgId}`;
    const cached = await ioRedis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const apiKey = await this._getApiKey(orgId);
    const res = await safeFetch(`${BASE}/v2/avatars`, { headers: this._headers(apiKey) });
    if (!res.ok) throw new ForbiddenException(`HeyGen avatars request failed (${res.status})`);
    const { data } = (await res.json()) as HeyGenAvatarsResponse;

    const result = {
      avatars: (data?.avatars || [])
        .filter((a) => a.avatar_id)
        .map((a) => ({
          avatarId: a.avatar_id,
          name: a.avatar_name || a.avatar_id,
          gender: a.gender || null,
          previewImageUrl: a.preview_image_url || null,
        })),
      talkingPhotos: (data?.talking_photos || [])
        .filter((tp) => tp.talking_photo_id)
        .map((tp) => ({
          talkingPhotoId: tp.talking_photo_id,
          name: tp.talking_photo_name || tp.talking_photo_id,
          previewImageUrl: tp.preview_image_url || null,
        })),
    };

    await ioRedis.set(cacheKey, JSON.stringify(result), 'EX', CATALOG_TTL_SECONDS);
    return result;
  }

  async listVoices(orgId: string) {
    const cacheKey = `heygen:voices:${orgId}`;
    const cached = await ioRedis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const apiKey = await this._getApiKey(orgId);
    const res = await safeFetch(`${BASE}/v2/voices`, { headers: this._headers(apiKey) });
    if (!res.ok) throw new ForbiddenException(`HeyGen voices request failed (${res.status})`);
    const { data } = (await res.json()) as HeyGenVoicesResponse;

    const result = {
      voices: (data?.voices || [])
        .filter((v) => v.voice_id)
        .map((v) => ({
          voiceId: v.voice_id,
          name: v.name || v.voice_id,
          language: v.language || null,
          gender: v.gender || null,
          previewAudio: v.preview_audio || null,
          supportPause: !!v.support_pause,
          emotionSupport: !!v.emotion_support,
        })),
    };

    await ioRedis.set(cacheKey, JSON.stringify(result), 'EX', CATALOG_TTL_SECONDS);
    return result;
  }

  // ── Storyboard avatar video ──

  async createAvatarVideo(
    orgId: string,
    userId: string,
    params: CreateAvatarVideoParams,
  ): Promise<{ jobId: string }> {
    if (!params.scenes?.length) {
      throw new ForbiddenException('At least one scene is required');
    }

    const { key: apiKey, version } = await this._getConfig(orgId);
    const videoInputs = await Promise.all(
      params.scenes.map((scene) => this._buildVideoInput(orgId, scene)),
    );

    // Create the ledger row first so the completion webhook can be addressed to it.
    const job = await this._lifecycle.createPendingJob({
      organizationId: orgId,
      userId: userId || undefined,
      provider: 'heygen',
      operation: 'avatar',
      model: 'heygen',
      version,
      folderId: params.folderId,
      inputJson: JSON.stringify({ scenes: params.scenes, dimension: params.dimension, title: params.title }),
    });

    const webhook = this._lifecycle.webhookUrlFor(job.id, orgId);

    try {
      const res = await safeFetch(`${BASE}/v2/video/generate`, {
        method: 'POST',
        headers: this._headers(apiKey),
        body: JSON.stringify({
          video_inputs: videoInputs,
          dimension: params.dimension || DEFAULT_DIMENSION,
          ...(params.title ? { title: params.title } : {}),
          ...(webhook ? { callback_url: webhook } : {}),
        }),
      });

      if (!res.ok) throw new Error(`HeyGen video generation failed: ${redactError(await res.text())}`);
      const body = (await res.json()) as HeyGenGenerateResponse;
      const videoId = body.data?.video_id;
      if (!videoId) {
        const msg = typeof body.error === 'string' ? body.error : body.error?.message;
        throw new Error(msg || 'HeyGen returned no video id');
      }

      await this._lifecycle.attachProviderJob(job.id, `video:${videoId}`, orgId);
      return { jobId: job.id };
    } catch (err) {
      await this._lifecycle.failJob(job, (err as Error).message, { notify: false });
      throw err;
    }
  }

  // ── Talking Photo ──

  async createTalkingPhotoVideo(
    orgId: string,
    userId: string,
    params: { fileId: string; voiceId: string; inputText: string; dimension?: { width: number; height: number }; title?: string; folderId?: string | null },
  ): Promise<{ jobId: string }> {
    const talkingPhotoId = await this._uploadTalkingPhoto(orgId, params.fileId);
    return this.createAvatarVideo(orgId, userId, {
      title: params.title,
      dimension: params.dimension,
      folderId: params.folderId,
      scenes: [{ talkingPhotoId, voiceId: params.voiceId, inputText: params.inputText }],
    });
  }

  // Upload a /files image to HeyGen to mint a talking_photo_id. HeyGen's upload host
  // takes the raw image bytes with the real content-type.
  private async _uploadTalkingPhoto(orgId: string, fileId: string): Promise<string> {
    const apiKey = await this._getApiKey(orgId);
    const { buffer, mime } = await this._readFileBytes(orgId, fileId);

    const res = await safeFetch('https://upload.heygen.com/v1/talking_photo', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': mime },
      body: buffer,
    });
    if (!res.ok) throw new ForbiddenException(`HeyGen talking-photo upload failed (${res.status}): ${redactError(await res.text())}`);
    const body = (await res.json()) as { data?: { talking_photo_id?: string } };
    const id = body.data?.talking_photo_id;
    if (!id) throw new ForbiddenException('HeyGen returned no talking_photo_id');
    return id;
  }

  // ── Voiceover (text-to-speech) ──

  async textToSpeech(
    orgId: string,
    userId: string,
    params: { voiceId: string; text: string; folderId?: string | null },
  ): Promise<{ jobId: string }> {
    const { key: apiKey, version } = await this._getConfig(orgId);

    const job = await this._lifecycle.createPendingJob({
      organizationId: orgId,
      userId: userId || undefined,
      provider: 'heygen',
      operation: 'audio',
      model: 'heygen',
      version,
      folderId: params.folderId,
      inputJson: JSON.stringify({ voiceId: params.voiceId, text: params.text }),
    });

    try {
      const res = await safeFetch(`${BASE}/v2/audio/generate`, {
        method: 'POST',
        headers: this._headers(apiKey),
        body: JSON.stringify({ voice_id: params.voiceId, input_text: params.text }),
      });
      if (!res.ok) throw new Error(`HeyGen TTS failed: ${redactError(await res.text())}`);
      const body = (await res.json()) as { data?: { audio_id?: string; id?: string } };
      const audioId = body.data?.audio_id || body.data?.id;
      if (!audioId) throw new Error('HeyGen returned no audio id');

      await this._lifecycle.attachProviderJob(job.id, `tts:${audioId}`, orgId);
      return { jobId: job.id };
    } catch (err) {
      await this._lifecycle.failJob(job, (err as Error).message, { notify: false });
      throw err;
    }
  }

  // ── Video translation ──

  async listTranslateLanguages(orgId: string): Promise<{ languages: string[] }> {
    const cacheKey = `heygen:translate-langs:${orgId}`;
    const cached = await ioRedis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const apiKey = await this._getApiKey(orgId);
    const res = await safeFetch(`${BASE}/v2/video_translate/target_languages`, { headers: this._headers(apiKey) });
    if (!res.ok) throw new ForbiddenException(`HeyGen languages request failed (${res.status})`);
    const body = (await res.json()) as { data?: { languages?: string[] } };
    const result = { languages: body.data?.languages || [] };
    await ioRedis.set(cacheKey, JSON.stringify(result), 'EX', CATALOG_TTL_SECONDS);
    return result;
  }

  // One job per target language. The source must be a URL HeyGen can fetch — fine for
  // public cloud storage; for local storage the resolved URL may be unreachable.
  async translateVideo(
    orgId: string,
    userId: string,
    params: { fileId?: string; url?: string; languages: string[]; folderId?: string | null },
  ): Promise<{ jobs: Array<{ language: string; jobId: string }> }> {
    if (!params.languages?.length) throw new ForbiddenException('Pick at least one language');
    const { key: apiKey, version } = await this._getConfig(orgId);
    const sourceUrl = params.url || (params.fileId ? await this._resolvePublicUrl(orgId, params.fileId) : null);
    if (!sourceUrl) throw new ForbiddenException('A source video is required');

    const jobs: Array<{ language: string; jobId: string }> = [];
    for (const language of params.languages) {
      const job = await this._lifecycle.createPendingJob({
        organizationId: orgId,
        userId: userId || undefined,
        provider: 'heygen',
        operation: 'video',
        model: 'heygen',
        version,
        folderId: params.folderId,
        inputJson: JSON.stringify({ source: sourceUrl, language }),
      });
      try {
        const res = await safeFetch(`${BASE}/v2/video_translate/translate`, {
          method: 'POST',
          headers: this._headers(apiKey),
          body: JSON.stringify({ video_url: sourceUrl, output_language: language, title: `translate-${language}` }),
        });
        if (!res.ok) throw new Error(`HeyGen translation failed: ${redactError(await res.text())}`);
        const body = (await res.json()) as { data?: { video_translate_id?: string } };
        const id = body.data?.video_translate_id;
        if (!id) throw new Error('HeyGen returned no translation id');
        await this._lifecycle.attachProviderJob(job.id, `translate:${id}`, orgId);
        jobs.push({ language, jobId: job.id });
      } catch (err) {
        await this._lifecycle.failJob(job, (err as Error).message, { notify: false });
      }
    }
    if (jobs.length === 0) throw new ForbiddenException('All translations failed to start');
    return { jobs };
  }

  private async _readFileBytes(orgId: string, fileId: string): Promise<{ buffer: Buffer; mime: string }> {
    const file = await this._fileService.getFileById(orgId, fileId);
    if (!file) throw new ForbiddenException('File not found');
    const adapter = file.folderId
      ? await this._storage.resolveAdapterForFolder(file.folderId, orgId)
      : await this._storage.getLocalAdapterForOrg(orgId, true);
    const buffer = await adapter.readFile(file.path);
    const ext = (file.path.split('.').pop() || '').toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return { buffer, mime };
  }

  private async _buildVideoInput(orgId: string, scene: HeyGenScene): Promise<Record<string, unknown>> {
    if (!scene.avatarId && !scene.talkingPhotoId) {
      throw new ForbiddenException('Each scene needs an avatar or a talking photo');
    }
    if (!scene.voiceId) throw new ForbiddenException('Each scene needs a voice');
    if (!scene.inputText?.trim()) throw new ForbiddenException('Each scene needs a script');

    const character = scene.talkingPhotoId
      ? {
          type: 'talking_photo',
          talking_photo_id: scene.talkingPhotoId,
          ...(scene.scale ? { scale: scene.scale } : {}),
        }
      : {
          type: 'avatar',
          avatar_id: scene.avatarId,
          ...(scene.avatarStyle ? { avatar_style: scene.avatarStyle } : {}),
          ...(scene.scale ? { scale: scene.scale } : {}),
        };

    const input: Record<string, unknown> = {
      character,
      voice: {
        type: 'text',
        voice_id: scene.voiceId,
        input_text: scene.inputText,
        ...(scene.speed ? { speed: scene.speed } : {}),
      },
    };

    const background = await this._buildBackground(orgId, scene.background);
    if (background) input.background = background;

    return input;
  }

  private async _buildBackground(
    orgId: string,
    background?: HeyGenScene['background'],
  ): Promise<Record<string, unknown> | null> {
    if (!background) return null;
    if (background.type === 'color') {
      return background.color ? { type: 'color', value: background.color } : null;
    }
    if (background.fileId) {
      const url = await this._resolvePublicUrl(orgId, background.fileId);
      return { type: background.type, url };
    }
    return null;
  }

  // Resolve a /files asset to a URL HeyGen can fetch (cloud storage → public URL,
  // local storage → media-directory URL). Mirrors the Replicate runner's resolver.
  private async _resolvePublicUrl(orgId: string, fileId: string): Promise<string> {
    const file = await this._fileService.getFileById(orgId, fileId);
    if (!file) {
      throw new ForbiddenException('File not found');
    }
    if (file.path.startsWith('https://')) return file.path;
    const adapter = file.folderId
      ? await this._storage.resolveAdapterForFolder(file.folderId, orgId)
      : await this._storage.getLocalAdapterForOrg(orgId, true);
    return adapter.getFileUrl(file.path);
  }

  // ── Render queue ──

  async listJobs(orgId: string, limit = 30) {
    const jobs = await this._aiSettings.getMediaJobsByProvider(orgId, 'heygen', limit);
    return Promise.all(jobs.map((j) => this._presentJob(orgId, j)));
  }

  // Drive completion by polling so jobs finish even where no public webhook can reach
  // this instance (local dev / private deploys). processJob is a no-op once terminal.
  async getJob(orgId: string, jobId: string) {
    const existing = await this._aiSettings.getMediaJobById(orgId, jobId);
    if (!existing || existing.organizationId !== orgId) {
      throw new ForbiddenException('Job not found');
    }
    if (existing.status === 'pending' || existing.status === 'processing') {
      try {
        await this._lifecycle.processJob(jobId);
      } catch {
        // Transient poll failure — leave pending for the next poll/sweep.
      }
    }
    const job = await this._aiSettings.getMediaJobById(orgId, jobId);
    if (!job || job.organizationId !== orgId) throw new ForbiddenException('Job not found');
    return this._presentJob(orgId, job);
  }

  private async _presentJob(orgId: string, job: AIMediaJob) {
    // Only the completed (stored) path is a real /files URL; the pending `pending://`
    // ref is internal and must never reach the client. Resolve the File id too so the
    // composer handoff ("Post") can attach it.
    const completed = job.status === 'completed' && job.artifactUrl;
    let fileId: string | null = null;
    if (completed) {
      const file = await this._fileService.getFileByPath(orgId, job.artifactUrl!).catch(() => null);
      fileId = file?.id ?? null;
    }
    return {
      id: job.id,
      operation: job.operation,
      status: job.status,
      artifactUrl: completed ? job.artifactUrl : null,
      fileId,
      error: job.error || null,
      createdAt: job.createdAt,
    };
  }
}
