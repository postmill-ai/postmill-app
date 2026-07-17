import { metadata as providerMetadata } from './metadata';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  resolveApiKey,
  redactError,
  validateModelId,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

const BASE = 'https://api.bfl.ai/v1';

interface BFLSubmitResponse {
  id?: string;
}

interface BFLResultResponse {
  status?: string;
  result?: { sample?: string; seed?: number };
  details?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class BlackForestLabsAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'black-forest-labs';
  readonly name = 'Black Forest Labs';
  readonly capabilities: MediaProviderCapabilities = {
    image: true,
    video: false,
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
    if (!apiKey) throw new Error('Black Forest Labs API key is required');
    return { 'Content-Type': 'application/json', 'x-key': apiKey };
  }

  // FLUX generation is submit + poll; bounded internal polling keeps the
  // synchronous image contract (§11.2) — near-real-time or fail.
  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const model = validateModelId(options?.model || 'flux-pro-1.1');
    const [width, height] = (options?.size || '1024x1024')
      .split('x')
      .map((v) => Number.parseInt(v, 10));
    // Native FLUX params (prompt_upsampling, seed, safety_tolerance, aspect_ratio for
    // -ultra, output_format, …) ride through `options.input` so the studio descriptor
    // is the full feature surface. Defaults below apply only when input omits them.
    const res = await this._fetch(`${BASE}/${model}`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({
        prompt,
        width: Number.isFinite(width) ? width : 1024,
        height: Number.isFinite(height) ? height : 1024,
        ...(options?.input || {}),
      }),
    });
    if (!res.ok) throw new Error(`Black Forest Labs image generation failed: ${redactError(await res.text())}`);
    const { id } = (await res.json()) as BFLSubmitResponse;
    if (!id) throw new Error('Black Forest Labs returned no request id');

    for (let attempt = 0; attempt < 40; attempt++) {
      await sleep(1500);
      const pollRes = await this._fetch(`${BASE}/get_result?id=${encodeURIComponent(id)}`, {
        headers: this._headers(options),
      });
      if (!pollRes.ok) throw new Error(`Black Forest Labs polling failed: ${redactError(await pollRes.text())}`);
      const data = (await pollRes.json()) as BFLResultResponse;
      if (data.status === 'Ready') {
        const url = data.result?.sample;
        if (!url) throw new Error('Black Forest Labs returned no image');
        return {
          multi: false,
          image: url,
          images: [url],
          metadata: { provider: this.identifier, model, seed: data.result?.seed, width, height },
        };
      }
      if (data.status === 'Error' || data.status === 'Content Moderated' || data.status === 'Request Moderated') {
        throw new Error(`Black Forest Labs image generation failed: ${data.details || data.status}`);
      }
    }
    throw new Error('Black Forest Labs image generation timed out');
  }

  async generateVideo(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Black Forest Labs does not support video generation');
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Black Forest Labs does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Black Forest Labs does not support avatar generation');
  }
}

const _meta = new BlackForestLabsAdapter(undefined as unknown as SafeFetchPort);

export const blackforestlabsMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new BlackForestLabsAdapter(rt.fetch),
};
