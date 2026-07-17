import { metadata as providerMetadata } from './metadata';
import {
  BearerTokenMediaAdapter,
  pollMediaJob,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaJobSubmission,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// Leonardo.ai — own-key (Bearer) image generation. Its API is async (create returns a
// generationId, results are polled), but image is expected to be synchronous (§11.2), so we keep
// the contract with bounded internal polling (the BFL/Qwen pattern) — near-real-time or fail.
// `model` (the kit) maps to `modelId`; native params (width, height, num_images, negative_prompt,
// alchemy, contrast, styleUUID, …) ride through `options.input`.
const BASE = 'https://cloud.leonardo.ai/api/rest/v1';
const DEFAULT_MODEL = 'de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3'; // Leonardo Phoenix 1.0

interface LeonardoCreateResponse {
  sdGenerationJob?: { generationId?: string };
}

interface LeonardoGetResponse {
  generations_by_pk?: {
    status?: string;
    generated_images?: { url?: string; id?: string }[];
  };
}

export class LeonardoMediaAdapter extends BearerTokenMediaAdapter {
  readonly identifier = 'leonardo';
  readonly name = 'Leonardo.ai';
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

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const headers = this._headers(options);
    const modelId = options?.model || DEFAULT_MODEL;
    const input = options?.input || {};
    const res = await this._fetch(`${BASE}/generations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        modelId,
        width: input.width !== undefined ? Number(input.width) : 1024,
        height: input.height !== undefined ? Number(input.height) : 1024,
        num_images: input.num_images !== undefined ? Number(input.num_images) : 1,
        ...input,
      }),
    });
    if (!res.ok) throw new Error(`Leonardo.ai image generation failed: ${await res.text()}`);
    const created = (await res.json()) as LeonardoCreateResponse;
    const generationId = created.sdGenerationJob?.generationId;
    if (!generationId) throw new Error('Leonardo.ai returned no generation id');

    const images = await pollMediaJob<string[]>({
      fetch: this._fetch,
      url: `${BASE}/generations/${generationId}`,
      headers,
      attempts: 40,
      intervalMs: 2000,
      parse: (raw) => {
        const data = raw as LeonardoGetResponse;
        const status = data.generations_by_pk?.status;
        if (status === 'COMPLETE') {
          const imgs = (data.generations_by_pk?.generated_images || [])
            .map((i) => i.url)
            .filter((u): u is string => !!u);
          if (imgs.length === 0) return { status: 'failed', error: 'Leonardo.ai returned no images' };
          return { status: 'completed', result: imgs };
        }
        if (status === 'FAILED') return { status: 'failed', error: 'Leonardo.ai image generation failed' };
        return { status: 'pending' };
      },
    });
    return {
      multi: images.length > 1,
      image: images[0],
      images,
      metadata: { provider: this.identifier, model: modelId },
    };
  }

  async generateVideo(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Leonardo.ai video generation is not supported via the media adapter');
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Leonardo.ai does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Leonardo.ai does not support avatar generation');
  }
}

const _meta = new LeonardoMediaAdapter(undefined as unknown as SafeFetchPort);

export const leonardoMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new LeonardoMediaAdapter(rt.fetch),
};
