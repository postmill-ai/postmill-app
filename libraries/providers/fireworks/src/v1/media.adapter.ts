import { metadata as providerMetadata } from './metadata';
import {
  BearerTokenMediaAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaModelOption,
  resolveApiKey,
  redactError,
  validateModelId,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// Fireworks AI — same key as the Fireworks LLM provider (registry id `fireworks`), reused via
// the universal-credential fallback. Image generation uses Fireworks' workflow endpoint
// (`/inference/v1/workflows/accounts/fireworks/models/{model}/text_to_image`) with
// `Accept: application/json` → `{ base64: [...] }`. Audio was deprecated (2026-06); no video.
const BASE = 'https://api.fireworks.ai/inference/v1/workflows/accounts/fireworks/models';

interface FireworksImageResponse {
  base64?: string[];
  finishReason?: string;
}

export class FireworksMediaAdapter extends BearerTokenMediaAdapter {
  readonly identifier = 'fireworks';
  readonly name = 'Fireworks AI';
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
    const model = validateModelId(options?.model || 'flux-1-schnell-fp8');
    const res = await this._fetch(`${BASE}/${model}/text_to_image`, {
      method: 'POST',
      headers: { ...this._headers(options), Accept: 'application/json' },
      body: JSON.stringify({ prompt, ...this._clean(options?.input) }),
    });
    if (!res.ok) throw new Error(`Fireworks image generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as FireworksImageResponse;
    const urls = (data.base64 || [])
      .filter(Boolean)
      .map((b) => (b.startsWith('data:') ? b : `data:image/png;base64,${b}`));
    if (!urls.length) throw new Error('Fireworks returned no image');
    return {
      multi: urls.length > 1,
      image: urls[0],
      images: urls,
      metadata: { provider: this.identifier, model, prompt },
    };
  }

  async generateVideo(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Fireworks does not support video generation');
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Fireworks does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Fireworks does not support avatar generation');
  }

  // Fireworks has no image-model catalog endpoint — the descriptor's curated list + free
  // entry drives the dropdown.
  async listModels(): Promise<MediaModelOption[]> {
    return [];
  }

  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) return { ok: false, message: 'Fireworks API key is required' };
    try {
      const res = await this._fetch('https://api.fireworks.ai/inference/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) return { ok: true, message: 'Connection successful' };
      return { ok: false, message: `Fireworks connection failed: ${await res.text()}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

const _meta = new FireworksMediaAdapter(undefined as unknown as SafeFetchPort);

export const fireworksMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new FireworksMediaAdapter(rt.fetch),
};
