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

// xAI (Grok) — same key as the xAI LLM provider (registry id `xai`), reused via the
// universal-credential fallback. Image generation is OpenAI-compatible:
// `POST /v1/images/generations` (response `data[].url` / `data[].b64_json`). xAI's image API
// takes only `model` / `prompt` / `n` / `response_format` — no size/quality/style params.
// No video/audio generation.
const BASE = 'https://api.x.ai/v1';

interface XaiImageResponse {
  data?: { url?: string; b64_json?: string; revised_prompt?: string }[];
}

interface XaiModelsResponse {
  data?: { id?: string; name?: string }[];
  models?: { id?: string; name?: string }[];
}

export class XaiMediaAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'xai';
  readonly name = 'xAI Grok';
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
    if (!apiKey) throw new Error('xAI API key is required');
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  }

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const model = options?.model || 'grok-2-image-1212';
    // Pass native params through (e.g. `n`); xAI ignores anything it doesn't support.
    const input: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(options?.input || {})) {
      if (v !== undefined && v !== '') input[k] = v;
    }
    const res = await this._fetch(`${BASE}/images/generations`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({ model, prompt, response_format: 'url', ...input }),
    });
    if (!res.ok) throw new Error(`xAI image generation failed: ${await res.text()}`);
    const data = (await res.json()) as XaiImageResponse;
    const urls = (data.data || [])
      .map((d) => d.url || (d.b64_json ? `data:image/png;base64,${d.b64_json}` : undefined))
      .filter((u): u is string => !!u);
    if (!urls.length) throw new Error('xAI returned no image');
    return {
      multi: urls.length > 1,
      image: urls[0],
      images: urls,
      metadata: { provider: this.identifier, model, prompt },
    };
  }

  async generateVideo(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('xAI does not support video generation');
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('xAI does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('xAI does not support avatar generation');
  }

  async listModels(operation: MediaOperation, options?: MediaCredentialOptions): Promise<MediaModelOption[]> {
    if (operation !== 'image') return [];
    try {
      const res = await this._fetch(`${BASE}/image-generation-models`, { headers: this._headers(options) });
      if (!res.ok) return [];
      const body = (await res.json()) as XaiModelsResponse;
      const list = body.data || body.models || [];
      return list
        .filter((m) => m.id)
        .map((m) => ({ id: m.id as string, label: m.name || (m.id as string) }));
    } catch {
      return [];
    }
  }

  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this._fetch(`${BASE}/models`, { headers: this._headers(options) });
      if (res.ok) return { ok: true, message: 'Connection successful' };
      return { ok: false, message: `xAI connection failed: ${await res.text()}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

const _meta = new XaiMediaAdapter(undefined as unknown as SafeFetchPort);

export const xaiMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new XaiMediaAdapter(rt.fetch),
};
