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

const BASE = 'https://tavusapi.com/v2';

interface TavusVideoResponse {
  video_id?: string;
  status?: string;
  download_url?: string;
  hosted_url?: string;
  error?: string;
}

export class TavusAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'tavus';
  readonly name = 'Tavus';
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
    if (!apiKey) throw new Error('Tavus API key is required');
    return { 'Content-Type': 'application/json', 'x-api-key': apiKey };
  }

  async generateImage(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    throw new Error('Tavus does not support image generation');
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    // The studio supplies the replica id as a descriptor field in `options.input`; legacy
    // callers pass it via top-level options/credentials.
    const input = (options?.input || {}) as Record<string, MediaInputValue>;
    const replicaId =
      options?.avatarId ||
      (typeof input.replica_id === 'string' ? input.replica_id : undefined) ||
      options?.credentials?.replicaId;
    if (!replicaId) throw new Error('Tavus video generation requires a replica id (avatarId)');

    const res = await this._fetch(`${BASE}/videos`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({
        replica_id: replicaId,
        script: prompt,
        ...(typeof input.video_name === 'string' && input.video_name ? { video_name: input.video_name } : {}),
        ...(options?.webhookUrl ? { callback_url: options.webhookUrl } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Tavus video generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as TavusVideoResponse;
    if (!data.video_id) throw new Error('Tavus returned no video id');
    return { jobId: data.video_id };
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Tavus does not support standalone audio generation');
  }

  generateAvatar(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    return this.generateVideo(prompt, options);
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    if (!resolveApiKey(options)) return { status: 'failed', error: 'Tavus API key is required' };

    const res = await this._fetch(`${BASE}/videos/${jobId}`, {
      headers: this._headers(options),
    });
    if (!res.ok) {
      const body = await res.text();
      // 3.4 — transient poll error: THROW so the still-rendering video retries.
      if (isTransientStatus(res.status)) {
        throw new Error(`Tavus poll transient error ${res.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: redactError(body) };
    }
    const data = (await res.json()) as TavusVideoResponse;

    if (data.status === 'ready') {
      // 6.1f — `hosted_url` is an HTML share page, not a downloadable asset. Only the
      // `download_url` is the real mp4; if it hasn't populated yet, keep polling rather than
      // landing the HTML page as a "video".
      if (!data.download_url) return { status: 'pending' };
      return { status: 'completed', artifactUrl: data.download_url, metadata: { provider: this.identifier, mime: 'video/mp4' } };
    }
    if (data.status === 'error' || data.status === 'deleted') {
      return { status: 'failed', error: redactError(data.error || `Tavus video status: ${data.status}`) };
    }
    return { status: 'pending' };
  }
}

const _meta = new TavusAdapter(undefined as unknown as SafeFetchPort);

export const tavusMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new TavusAdapter(rt.fetch),
};
