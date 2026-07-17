import { metadata as providerMetadata } from './metadata';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaModelOption,
  MediaOperation,
  resolveApiKey,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// OpenRouter — same key as the OpenRouter LLM provider (registry id `openrouter`), reused via
// the universal-credential fallback. Image generation uses OpenRouter's dedicated
// `POST /api/v1/images` endpoint (response `data[].b64_json`). No video/audio generation.
const BASE = 'https://openrouter.ai/api/v1';

interface OpenRouterImageResponse {
  data?: { b64_json?: string; url?: string }[];
}

interface OpenRouterModelsResponse {
  data?: { id?: string; name?: string; architecture?: { output_modalities?: string[] } }[];
}

export class OpenRouterMediaAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'openrouter';
  readonly name = 'OpenRouter';
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
    if (!apiKey) throw new Error('OpenRouter API key is required');
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  }

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const model = options?.model;
    if (!model) throw new Error('OpenRouter image generation requires a model');
    const input: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(options?.input || {})) {
      if (v !== undefined && v !== '') input[k] = v;
    }
    const res = await this._fetch(`${BASE}/images`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({ model, prompt, ...input }),
    });
    if (!res.ok) throw new Error(`OpenRouter image generation failed: ${await res.text()}`);
    const data = (await res.json()) as OpenRouterImageResponse;
    const urls = (data.data || [])
      .map((d) => d.url || (d.b64_json ? `data:image/png;base64,${d.b64_json}` : undefined))
      .filter((u): u is string => !!u);
    if (!urls.length) throw new Error('OpenRouter returned no image');
    return {
      multi: urls.length > 1,
      image: urls[0],
      images: urls,
      metadata: { provider: this.identifier, model, prompt },
    };
  }

  async generateVideo(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('OpenRouter does not support video generation');
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('OpenRouter does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('OpenRouter does not support avatar generation');
  }

  async listModels(operation: MediaOperation, options?: MediaCredentialOptions): Promise<MediaModelOption[]> {
    if (operation !== 'image') return [];
    try {
      const res = await this._fetch(`${BASE}/models`, { headers: this._headers(options) });
      if (!res.ok) return [];
      const body = (await res.json()) as OpenRouterModelsResponse;
      return (body.data || [])
        .filter((m) => m.id && m.architecture?.output_modalities?.includes('image'))
        .map((m) => ({ id: m.id as string, label: m.name || (m.id as string) }));
    } catch {
      return [];
    }
  }

  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this._fetch(`${BASE}/models`, { headers: this._headers(options) });
      if (res.ok) return { ok: true, message: 'Connection successful' };
      return { ok: false, message: `OpenRouter connection failed: ${await res.text()}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

const _meta = new OpenRouterMediaAdapter(undefined as unknown as SafeFetchPort);

export const openrouterMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new OpenRouterMediaAdapter(rt.fetch),
};
