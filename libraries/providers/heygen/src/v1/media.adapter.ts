import { metadata as providerMetadata } from './metadata';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaPollResult,
  resolveApiKey,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

interface HeyGenGenerateResponse {
  data?: { video_id?: string };
}

interface HeyGenStatusResponse {
  data?: {
    status?: string;
    video_url?: string;
    duration?: number;
    error?: { message?: string };
  };
}

interface HeyGenTranslateStatusResponse {
  data?: {
    status?: string;
    url?: string;
    message?: string;
  };
}

interface HeyGenAudioStatusResponse {
  data?: {
    status?: string;
    audio_url?: string;
    url?: string;
    duration?: number;
    error?: { message?: string };
  };
}

// 2.1 — a 429/5xx on a status poll is transient: THROW so the lifecycle retries the render
// rather than permanently failing a job whose generation may still be fine. 4xx / a
// provider-reported terminal state stays a returned { status: 'failed' }.
const isTransientStatus = (s: number): boolean => s === 429 || s >= 500;

// 5.11 — the poll id is namespaced `<op>:<id>`; an unrecognized prefix must be treated as a
// BARE avatar-video id (never silently routed with the prefix stripped).
const HEYGEN_OPS = new Set(['video', 'translate', 'tts']);

export class HeyGenAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'heygen';
  readonly name = 'HeyGen';
  readonly capabilities: MediaProviderCapabilities = {
    image: false,
    video: true,
    audio: false,
    avatar: true,
    tts: false,
    stt: false,
    upscale: false,
    bgRemove: false,
    inpaint: false,
  };

  private _headers(options?: MediaCredentialOptions): Record<string, string> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('HeyGen API key is required');
    return {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': apiKey,
    };
  }

  async generateImage(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    throw new Error('HeyGen does not support image generation');
  }

  // Validate the key with a cheap authenticated GET (the avatar catalog) so the
  // Settings → Media "Test connection" doesn't fall back to image generation.
  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this._fetch('https://api.heygen.com/v2/avatars', { headers: this._headers(options) });
      if (res.ok) return { ok: true, message: 'Connection successful' };
      if (res.status === 401 || res.status === 403) return { ok: false, message: 'Invalid HeyGen API key' };
      return { ok: false, message: `HeyGen returned ${res.status}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const res = await this._fetch('https://api.heygen.com/v2/video/generate', {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({
        video_inputs: [
          {
            character: { type: 'avatar', avatar_id: options?.avatarId },
            voice: { type: 'text', input_text: prompt },
          },
        ],
        ...(options?.webhookUrl ? { callback_url: options.webhookUrl } : {}),
      }),
    });

    if (!res.ok) throw new Error(`HeyGen video generation failed: ${await res.text()}`);
    const { data } = (await res.json()) as HeyGenGenerateResponse;
    if (!data?.video_id) throw new Error('HeyGen returned no video id');
    return { jobId: data.video_id };
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('HeyGen does not support standalone audio generation');
  }

  generateAvatar(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    return this.generateVideo(prompt, options);
  }

  // HeyGen has distinct status endpoints per operation (avatar video, video translation,
  // text-to-speech). The HeyGen Studio stores the provider reference as `<op>:<id>` so a
  // single pollJob can route to the right one. A bare id (no `:`) is an avatar-video job —
  // this preserves the generic media-provider path (governance/grid), which stores the raw id.
  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    // Missing key is a config error → terminal failed (matches the openai/Sora convention),
    // not a thrown error the lifecycle would retry to the 24h timeout.
    if (!resolveApiKey(options)) return { status: 'failed', error: 'HeyGen API key is required' };

    const sep = jobId.indexOf(':');
    const prefix = sep > 0 ? jobId.slice(0, sep) : '';
    const known = HEYGEN_OPS.has(prefix);
    const op = known ? prefix : 'video';
    const id = known ? jobId.slice(sep + 1) : jobId;

    switch (op) {
      case 'translate':
        return this._pollTranslate(id, options);
      case 'tts':
        return this._pollTts(id, options);
      case 'video':
      default:
        return this._pollVideo(id, options);
    }
  }

  private async _pollVideo(videoId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    const res = await this._fetch(`https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
      headers: this._headers(options),
    });

    if (!res.ok) {
      const body = await res.text();
      if (isTransientStatus(res.status)) throw new Error(`HeyGen video poll transient error ${res.status}: ${body.slice(0, 200)}`);
      return { status: 'failed', error: body };
    }
    const { data } = (await res.json()) as HeyGenStatusResponse;

    if (data?.status === 'completed') {
      if (!data.video_url) return { status: 'failed', error: 'HeyGen video completed without a URL' };
      return {
        status: 'completed',
        artifactUrl: data.video_url,
        metadata: { provider: this.identifier, mime: 'video/mp4', durationSeconds: data.duration },
      };
    }
    if (data?.status === 'failed') return { status: 'failed', error: data.error?.message };
    return { status: 'pending' };
  }

  // Video translation status — GET /v2/video_translate/{id}. Terminal status is
  // `success` with a downloadable `url`; `failed` carries a message.
  private async _pollTranslate(translateId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    const res = await this._fetch(`https://api.heygen.com/v2/video_translate/${encodeURIComponent(translateId)}`, {
      headers: this._headers(options),
    });

    if (!res.ok) {
      const body = await res.text();
      if (isTransientStatus(res.status)) throw new Error(`HeyGen translate poll transient error ${res.status}: ${body.slice(0, 200)}`);
      return { status: 'failed', error: body };
    }
    const { data } = (await res.json()) as HeyGenTranslateStatusResponse;
    const status = data?.status;

    if (status === 'success') {
      if (!data?.url) return { status: 'failed', error: 'HeyGen translation completed without a URL' };
      return {
        status: 'completed',
        artifactUrl: data.url,
        metadata: { provider: this.identifier, mime: 'video/mp4' },
      };
    }
    if (status === 'failed') return { status: 'failed', error: data?.message || 'Translation failed' };
    return { status: 'pending' };
  }

  // Text-to-speech status — GET /v1/audio_status.get. Returns a downloadable audio URL on
  // completion. Wrapped so a not-yet-available endpoint surfaces as a graceful job failure
  // rather than crashing the polling sweep.
  private async _pollTts(audioId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    const res = await this._fetch(`https://api.heygen.com/v1/audio_status.get?audio_id=${encodeURIComponent(audioId)}`, {
      headers: this._headers(options),
    });

    if (!res.ok) {
      const body = await res.text();
      if (isTransientStatus(res.status)) throw new Error(`HeyGen tts poll transient error ${res.status}: ${body.slice(0, 200)}`);
      return { status: 'failed', error: body };
    }
    const { data } = (await res.json()) as HeyGenAudioStatusResponse;

    if (data?.status === 'completed' || data?.status === 'success') {
      const url = data.audio_url || data.url;
      if (!url) return { status: 'failed', error: 'HeyGen audio completed without a URL' };
      return {
        status: 'completed',
        artifactUrl: url,
        metadata: { provider: this.identifier, mime: 'audio/mpeg', durationSeconds: data.duration },
      };
    }
    if (data?.status === 'failed') return { status: 'failed', error: data.error?.message };
    return { status: 'pending' };
  }
}

const _meta = new HeyGenAdapter(undefined as unknown as SafeFetchPort);

export const heygenMediaModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'media',
    providerId: _meta.identifier,
    version: 'v1',
    displayName: _meta.name,
    status: 'active',
    credentialFields: (_meta as any).credentialFields || [],
    capabilities: (_meta as any).capabilities,
  },
  create: (rt) => new HeyGenAdapter(rt.fetch),
};
