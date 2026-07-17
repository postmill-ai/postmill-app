import { metadata as providerMetadata } from './metadata';
import {
  BearerTokenMediaAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaJobSubmission,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// Recraft — own-key (Bearer) image generation, strong on vector/SVG, brand styles, and icons.
// Synchronous: a single POST returns hosted image URLs. Native params (style, substyle, size, n,
// response_format, controls) ride through `options.input` so the descriptor is the full surface.
const BASE = 'https://external.api.recraft.ai/v1';

interface RecraftResponse {
  data?: { url?: string; image_id?: string }[];
}

export class RecraftMediaAdapter extends BearerTokenMediaAdapter {
  readonly identifier = 'recraft';
  readonly name = 'Recraft';
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
    const model = options?.model || 'recraftv3';
    const res = await this._fetch(`${BASE}/images/generations`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({ prompt, model, ...(options?.input || {}) }),
    });
    if (!res.ok) throw new Error(`Recraft image generation failed: ${await res.text()}`);
    const data = (await res.json()) as RecraftResponse;
    const images = (data.data || []).map((d) => d.url).filter((u): u is string => !!u);
    if (images.length === 0) throw new Error('Recraft returned no images');
    return {
      multi: images.length > 1,
      image: images[0],
      images,
      metadata: { provider: this.identifier, model },
    };
  }

  async generateVideo(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Recraft does not support video generation');
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Recraft does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Recraft does not support avatar generation');
  }
}

const _meta = new RecraftMediaAdapter(undefined as unknown as SafeFetchPort);

export const recraftMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new RecraftMediaAdapter(rt.fetch),
};
