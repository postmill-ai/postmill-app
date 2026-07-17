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

const BASE = 'https://api.d-id.com';

interface DIDTalkResponse {
  id?: string;
  status?: string;
  result_url?: string;
  error?: { description?: string };
}

export class DIDAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'did';
  readonly name = 'D-ID';
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
    if (!apiKey) throw new Error('D-ID API key is required');
    return {
      'Content-Type': 'application/json',
      Authorization: `Basic ${apiKey}`,
    };
  }

  async generateImage(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    throw new Error('D-ID does not support image generation');
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    // The studio resolves the source-image media field to a reachable URL in `options.input`;
    // legacy callers still pass it via top-level options/credentials.
    const input = (options?.input || {}) as Record<string, MediaInputValue>;
    const sourceUrl =
      options?.sourceUrl ||
      (typeof input.source_image === 'string' ? input.source_image : undefined) ||
      (typeof input.source_url === 'string' ? input.source_url : undefined) ||
      options?.credentials?.sourceUrl;
    if (!sourceUrl) throw new Error('D-ID talking-avatar generation requires a source image (sourceUrl)');

    const voiceProvider = typeof input.voice_provider === 'string' ? input.voice_provider : undefined;
    const voiceId = typeof input.voice_id === 'string' ? input.voice_id : undefined;
    const provider =
      voiceProvider && voiceId ? { provider: { type: voiceProvider, voice_id: voiceId } } : {};

    const res = await this._fetch(`${BASE}/talks`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({
        script: { type: 'text', input: prompt, ...provider },
        source_url: sourceUrl,
        ...(input.stitch !== undefined ? { config: { stitch: Boolean(input.stitch) } } : {}),
        ...(options?.webhookUrl ? { webhook: options.webhookUrl } : {}),
      }),
    });
    if (!res.ok) throw new Error(`D-ID video generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as DIDTalkResponse;
    if (!data.id) throw new Error('D-ID returned no talk id');
    return { jobId: data.id };
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('D-ID does not support standalone audio generation');
  }

  generateAvatar(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    return this.generateVideo(prompt, options);
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    if (!resolveApiKey(options)) return { status: 'failed', error: 'D-ID API key is required' };

    const res = await this._fetch(`${BASE}/talks/${jobId}`, {
      headers: this._headers(options),
    });
    if (!res.ok) {
      const body = await res.text();
      // 3.4 — transient poll error: THROW so the still-rendering talk retries.
      if (isTransientStatus(res.status)) {
        throw new Error(`D-ID poll transient error ${res.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: redactError(body) };
    }
    const data = (await res.json()) as DIDTalkResponse;

    if (data.status === 'done') {
      if (!data.result_url) return { status: 'failed', error: 'D-ID talk done without a result URL' };
      return {
        status: 'completed',
        artifactUrl: data.result_url,
        metadata: { provider: this.identifier, mime: 'video/mp4' },
      };
    }
    if (data.status === 'error' || data.status === 'rejected') {
      return { status: 'failed', error: redactError(data.error?.description || `D-ID talk status: ${data.status}`) };
    }
    return { status: 'pending' };
  }
}

const _meta = new DIDAdapter(undefined as unknown as SafeFetchPort);

export const didMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new DIDAdapter(rt.fetch),
};
