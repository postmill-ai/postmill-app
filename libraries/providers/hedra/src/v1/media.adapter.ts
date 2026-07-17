import { metadata as providerMetadata } from './metadata';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaInputValue,
  MediaPollResult,
  resolveApiKey,
  redactError,
  isTransientStatus,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

const BASE = 'https://api.hedra.com/web-app/public';

interface HedraGenerationResponse {
  id?: string;
  generation_id?: string;
  status?: string;
  url?: string;
  asset_url?: string;
  error_message?: string;
}

export class HedraAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'hedra';
  readonly name = 'Hedra';
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
    if (!apiKey) throw new Error('Hedra API key is required');
    return { 'Content-Type': 'application/json', 'X-API-Key': apiKey };
  }

  async generateImage(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    throw new Error('Hedra does not support image generation');
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    // The studio resolves the start-keyframe media field to a reachable URL in `options.input`;
    // legacy callers still pass it via top-level options.
    const input = (options?.input || {}) as Record<string, MediaInputValue>;
    const startKeyframe =
      options?.sourceUrl ||
      (typeof input.start_keyframe === 'string' ? input.start_keyframe : undefined) ||
      (typeof input.start_keyframe_url === 'string' ? input.start_keyframe_url : undefined);
    const aspectRatio =
      options?.aspectRatio || (typeof input.aspect_ratio === 'string' ? input.aspect_ratio : undefined);

    const res = await this._fetch(`${BASE}/generations`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({
        type: 'video',
        text_prompt: prompt,
        ...(options?.model ? { ai_model_id: options.model } : {}),
        ...(options?.avatarId ? { avatar_id: options.avatarId } : {}),
        ...(startKeyframe ? { start_keyframe_url: startKeyframe } : {}),
        ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Hedra video generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as HedraGenerationResponse;
    const jobId = data.id || data.generation_id;
    if (!jobId) throw new Error('Hedra returned no generation id');
    return { jobId };
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Hedra does not support standalone audio generation');
  }

  generateAvatar(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    return this.generateVideo(prompt, options);
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    if (!resolveApiKey(options)) return { status: 'failed', error: 'Hedra API key is required' };

    const res = await this._fetch(`${BASE}/generations/${jobId}/status`, {
      headers: this._headers(options),
    });
    if (!res.ok) {
      const body = await res.text();
      // 3.4 — transient poll error: THROW so the still-rendering generation retries.
      if (isTransientStatus(res.status)) {
        throw new Error(`Hedra poll transient error ${res.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: redactError(body) };
    }
    const data = (await res.json()) as HedraGenerationResponse;

    if (data.status === 'complete') {
      const artifactUrl = data.url || data.asset_url;
      if (!artifactUrl) return { status: 'failed', error: 'Hedra generation complete without an asset URL' };
      return { status: 'completed', artifactUrl, metadata: { provider: this.identifier, mime: 'video/mp4' } };
    }
    if (data.status === 'error' || data.status === 'failed') {
      return { status: 'failed', error: redactError(data.error_message || 'Hedra generation failed') };
    }
    return { status: 'pending' };
  }
}

const _meta = new HedraAdapter(undefined as unknown as SafeFetchPort);

export const hedraMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new HedraAdapter(rt.fetch),
};
