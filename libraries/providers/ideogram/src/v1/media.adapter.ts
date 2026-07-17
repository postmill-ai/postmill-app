import { metadata as providerMetadata } from './metadata';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaInputValue,
  MediaJobSubmission,
  resolveApiKey,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// Ideogram — own-key image generation, strong at accurate in-image text. The v3 generate endpoint
// takes multipart/form-data with the key in an `Api-Key` header (no Bearer). Synchronous: one POST
// returns hosted image URLs. Native params (aspect_ratio, rendering_speed, magic_prompt, style_type,
// negative_prompt, num_images, seed) ride through `options.input` as form fields.
const ENDPOINT = 'https://api.ideogram.ai/v1/ideogram-v3/generate';

interface IdeogramResponse {
  data?: { url?: string }[];
}

export class IdeogramMediaAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'ideogram';
  readonly name = 'Ideogram';
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

  private _key(options?: MediaCredentialOptions): string {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('Ideogram API key is required');
    return apiKey;
  }

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const key = this._key(options);
    const form = new FormData();
    form.append('prompt', prompt);
    const input = (options?.input || {}) as Record<string, MediaInputValue>;
    for (const [field, value] of Object.entries(input)) {
      if (value === undefined || value === '') continue;
      form.append(field, String(value));
    }
    // No Content-Type header — fetch sets the multipart boundary; the key rides as Api-Key.
    const res = await this._fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Api-Key': key },
      body: form,
    });
    if (!res.ok) throw new Error(`Ideogram image generation failed: ${await res.text()}`);
    const data = (await res.json()) as IdeogramResponse;
    const images = (data.data || []).map((d) => d.url).filter((u): u is string => !!u);
    if (images.length === 0) throw new Error('Ideogram returned no images');
    return {
      multi: images.length > 1,
      image: images[0],
      images,
      metadata: { provider: this.identifier },
    };
  }

  async generateVideo(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Ideogram does not support video generation');
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Ideogram does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Ideogram does not support avatar generation');
  }
}

const _meta = new IdeogramMediaAdapter(undefined as unknown as SafeFetchPort);

export const ideogramMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new IdeogramMediaAdapter(rt.fetch),
};
