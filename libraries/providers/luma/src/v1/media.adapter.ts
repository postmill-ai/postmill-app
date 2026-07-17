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
  redactError,
  isTransientStatus,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

const BASE = 'https://api.lumalabs.ai/dream-machine/v1';

interface LumaGenerationResponse {
  id?: string;
  state?: string;
  failure_reason?: string;
  assets?: { video?: string };
}

export class LumaAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'luma';
  readonly name = 'Luma';
  readonly capabilities: MediaProviderCapabilities = {
    image: false,
    video: true,
    audio: false,
    avatar: false,
    tts: false,
    stt: false,
    upscale: false,
    bgRemove: false,
    inpaint: false,
  };

  private _headers(options?: MediaCredentialOptions): Record<string, string> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('Luma API key is required');
    return {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    };
  }

  async generateImage(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    throw new Error('Luma does not support image generation');
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    // Native Luma params (model, resolution, duration, loop, aspect_ratio) ride
    // `options.input` straight into the body. `start_image_url`/`end_image_url` are
    // flattened convenience fields the adapter folds into the nested `keyframes`.
    const input = (options?.input || {}) as Record<string, unknown>;
    const { start_image_url, end_image_url, ...rest } = input;
    const keyframes: Record<string, unknown> = {};
    if (typeof start_image_url === 'string') keyframes.frame0 = { type: 'image', url: start_image_url };
    if (typeof end_image_url === 'string') keyframes.frame1 = { type: 'image', url: end_image_url };

    const res = await this._fetch(`${BASE}/generations`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({
        prompt,
        aspect_ratio: '16:9',
        ...(options?.aspectRatio ? { aspect_ratio: options.aspectRatio } : {}),
        ...(options?.loop !== undefined ? { loop: options.loop } : {}),
        ...(options?.model ? { model: options.model } : {}),
        ...rest,
        ...(Object.keys(keyframes).length ? { keyframes } : {}),
        ...(options?.webhookUrl ? { callback_url: options.webhookUrl } : {}),
      }),
    });

    if (!res.ok) throw new Error(`Luma video generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as LumaGenerationResponse;
    if (!data.id) throw new Error('Luma returned no generation id');
    return { jobId: data.id };
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Luma does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Luma does not support avatar generation');
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    // Missing key is a permanent config error → terminal failed, not a thrown error the
    // lifecycle would retry for 24h.
    if (!resolveApiKey(options)) return { status: 'failed', error: 'Luma API key is required' };

    const res = await this._fetch(`${BASE}/generations/${jobId}`, {
      headers: this._headers(options),
    });

    if (!res.ok) {
      const body = await res.text();
      // 3.4 — a 429/5xx poll is transient: THROW so the lifecycle retries rather than
      // permanently failing a still-rendering generation.
      if (isTransientStatus(res.status)) {
        throw new Error(`Luma poll transient error ${res.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: redactError(body) };
    }
    const data = (await res.json()) as LumaGenerationResponse;

    switch (data.state) {
      case 'completed':
        if (!data.assets?.video) return { status: 'failed', error: 'Luma generation completed without video' };
        return {
          status: 'completed',
          artifactUrl: data.assets.video,
          metadata: { provider: this.identifier, mime: 'video/mp4' },
        };
      case 'failed':
        return { status: 'failed', error: redactError(data.failure_reason || 'Unknown error') };
      default:
        return { status: 'pending' };
    }
  }
}

const _meta = new LumaAdapter(undefined as unknown as SafeFetchPort);

export const lumaMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new LumaAdapter(rt.fetch),
};
