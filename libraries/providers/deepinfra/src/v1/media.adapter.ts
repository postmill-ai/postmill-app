import { metadata as providerMetadata } from './metadata';
import {
  BearerTokenMediaAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaModelOption,
  MediaOperation,
  resolveApiKey,
  redactError,
  validateModelId,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// DeepInfra — same key as the DeepInfra LLM provider (registry id `deepinfra`), reused via
// the universal-credential fallback. Media uses DeepInfra's native per-model inference
// endpoint (`POST /v1/inference/{model}`), which is synchronous and returns the artifact in
// the body. Image (FLUX), TTS, and text-to-video models are all reached this way. NOTE: the
// exact per-model response keys are model-dependent — we probe the common ones
// (images/image/audio/video_url/output) and may need adjustment against a live key.
const BASE = 'https://api.deepinfra.com/v1/inference';

type InferenceResponse = Record<string, unknown>;

export class DeepInfraMediaAdapter extends BearerTokenMediaAdapter {
  readonly identifier = 'deepinfra';
  readonly name = 'DeepInfra';
  readonly capabilities: MediaProviderCapabilities = {
    image: true,
    video: true,
    audio: true,
    avatar: false,
    tts: true,
    stt: false,
    upscale: false,
    bgRemove: false,
    inpaint: false,
  };

  private async _infer(model: string, body: Record<string, unknown>, options?: MediaCredentialOptions): Promise<InferenceResponse> {
    if (!model) throw new Error('DeepInfra requires a model');
    validateModelId(model);
    const res = await this._fetch(`${BASE}/${model}`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`DeepInfra request failed: ${redactError(await res.text())}`);
    return (await res.json()) as InferenceResponse;
  }

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const model = options?.model;
    const data = await this._infer(model!, { prompt, ...this._clean(options?.input) }, options);
    const urls = this._extractUrls(data, ['images', 'image', 'output', 'image_url'], 'image/png');
    if (!urls.length) throw new Error('DeepInfra returned no image');
    return {
      multi: urls.length > 1,
      image: urls[0],
      images: urls,
      metadata: { provider: this.identifier, model, prompt },
    };
  }

  async generateAudio(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const model = options?.model;
    const data = await this._infer(model!, { text: prompt, ...this._clean(options?.input) }, options);
    const urls = this._extractUrls(data, ['audio', 'audio_url', 'output'], 'audio/wav');
    if (!urls.length) throw new Error('DeepInfra returned no audio');
    return { jobId: `deepinfra-audio-${model}`, artifactUrl: urls[0], metadata: { provider: this.identifier, model, prompt } };
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const model = options?.model;
    const data = await this._infer(model!, { prompt, ...this._clean(options?.input) }, options);
    const urls = this._extractUrls(data, ['video_url', 'video', 'output'], 'video/mp4');
    if (!urls.length) throw new Error('DeepInfra returned no video');
    return { jobId: `deepinfra-video-${model}`, artifactUrl: urls[0], metadata: { provider: this.identifier, model, prompt } };
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('DeepInfra does not support avatar generation');
  }

  // Pull artifact URL(s) from the response under any of the candidate keys; bare base64 is
  // wrapped into a data: URL with the modality's default mime.
  private _extractUrls(data: InferenceResponse, keys: string[], defaultMime: string): string[] {
    for (const key of keys) {
      const value = data[key];
      const arr = Array.isArray(value) ? value : value !== undefined ? [value] : [];
      const urls = arr
        .map((v) => (typeof v === 'string' ? v : (v as { url?: string })?.url))
        .filter((v): v is string => !!v)
        .map((v) => (v.startsWith('http') || v.startsWith('data:') ? v : `data:${defaultMime};base64,${v}`));
      if (urls.length) return urls;
    }
    return [];
  }

  // DeepInfra has no single per-modality model catalog endpoint usable here — the
  // descriptor's curated lists + free entry drive the dropdown.
  async listModels(_operation: MediaOperation, _options?: MediaCredentialOptions): Promise<MediaModelOption[]> {
    return [];
  }

  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) return { ok: false, message: 'DeepInfra API key is required' };
    try {
      const res = await this._fetch('https://api.deepinfra.com/v1/openai/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) return { ok: true, message: 'Connection successful' };
      return { ok: false, message: `DeepInfra connection failed: ${await res.text()}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

const _meta = new DeepInfraMediaAdapter(undefined as unknown as SafeFetchPort);

export const deepinfraMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new DeepInfraMediaAdapter(rt.fetch),
};
