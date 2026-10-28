import { metadata as providerMetadata } from './metadata';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaInputValue,
  resolveApiKey,
  redactError,
  SafeFetchPort,
  ProviderModule,
  mediaUpstreamError,
} from '@postmill-ai/provider-kernel';

// Map a TTS response_format to the data-URL mime so the artifact lands with the right type.
const TTS_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
};

// Aspect hint → provider size token. gpt-image and dall-e expose different
// wide/tall sizes, so the mapping is model-aware; an explicit `options.size`
// (or a native `input.size`) always wins over the hint.
const GPT_IMAGE_ASPECT_SIZE: Record<string, string> = {
  square: '1024x1024',
  wide: '1536x1024',
  tall: '1024x1536',
};
const DALL_E_ASPECT_SIZE: Record<string, string> = {
  square: '1024x1024',
  wide: '1792x1024',
  tall: '1024x1792',
};

interface OpenAIImageResponse {
  data?: { url?: string; b64_json?: string }[];
}

interface OpenAITranscriptionResponse {
  text?: string;
  segments?: { start: number; end: number; text: string }[];
}

export class OpenaiMediaAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'openai';
  readonly name = 'OpenAI';
  readonly capabilities: MediaProviderCapabilities = {
    image: true,
    video: false,
    audio: true,
    avatar: false,
    tts: true,
    stt: true,
    upscale: false,
    bgRemove: false,
    inpaint: false,
    outpaint: false,
  };

  private _apiKey(options?: MediaGenerateOptions): string {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('OpenAI API key is required');
    return apiKey;
  }

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const apiKey = this._apiKey(options);
    // dall-e-3 is gone for new keys (live 404s); explicit `options.model` overrides still win,
    // so orgs configured for dall-e-3 keep it (and its dall-e-only defaults below).
    const model = options?.model || 'gpt-image-1';
    const aspectSizes = model.startsWith('dall-e') ? DALL_E_ASPECT_SIZE : GPT_IMAGE_ASPECT_SIZE;
    const size = options?.size || (options?.aspect ? aspectSizes[options.aspect] : undefined) || '1024x1024';
    // `quality` values are model-specific: dall-e takes standard|hd, gpt-image takes
    // auto|high|medium|low — a dall-e default sent to gpt-image-1 400s.
    const quality = options?.quality || (model.startsWith('dall-e') ? 'standard' : 'auto');

    // Native params (size, quality, style, background, output_format, n, …) ride through
    // `options.input` so the descriptor exposes each model's full surface; defaults below
    // apply only when input omits them. gpt-image-1 returns b64_json (no url).
    const res = await this._fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      // gpt-image / dall-e generations routinely exceed the 30s default.
      timeoutMs: 120_000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        n: options?.n || 1,
        size,
        quality,
        ...(options?.input || {}),
      }),
    });

    if (!res.ok) throw await mediaUpstreamError(this, res, 'image');
    const data = (await res.json()) as OpenAIImageResponse;
    const fmt = String(options?.input?.output_format || 'png');
    const dataMime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
    const urls = (data.data || [])
      .map((d) => d.url || (d.b64_json ? `data:${dataMime};base64,${d.b64_json}` : undefined))
      .filter((u): u is string => typeof u === 'string' && u.length > 0);
    if (urls.length === 0) throw new Error('OpenAI returned no images');
    return {
      multi: urls.length > 1,
      image: urls[0],
      images: urls,
      metadata: { provider: this.identifier, model },
    };
  }

  // OpenAI retired the Sora video API and the Sora studio was removed; video stays unsupported.
  async generateVideo(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('OpenAI does not support video generation');
  }

  // OpenAI TTS is synchronous — return the artifact inline.
  async generateAudio(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const audio = await this.textToSpeech(prompt, options);
    const base64 = Buffer.isBuffer(audio) ? audio.toString('base64') : audio;
    const input = (options?.input || {}) as Record<string, MediaInputValue>;
    const fmt = String(input.response_format || options?.format || 'mp3');
    const mime = TTS_MIME[fmt] || 'audio/mpeg';
    return {
      jobId: `openai-audio-${Date.now()}`,
      artifactUrl: `data:${mime};base64,${base64}`,
      metadata: { provider: this.identifier, model: options?.model || 'tts-1', mime },
    };
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('OpenAI does not support avatar generation');
  }

  async listVoices(_options?: MediaGenerateOptions): Promise<Array<{ id: string; label: string; previewUrl?: string }>> {
    // OpenAI TTS voices are a fixed catalog; no list endpoint exists.
    // ballad/coral ship with gpt-4o-mini-tts; the tts-1 family rejects them
    // upstream, and the caller picks the model — the catalog is the union.
    return [
      { id: 'alloy', label: 'Alloy' },
      { id: 'echo', label: 'Echo' },
      { id: 'fable', label: 'Fable' },
      { id: 'onyx', label: 'Onyx' },
      { id: 'nova', label: 'Nova' },
      { id: 'shimmer', label: 'Shimmer' },
      { id: 'sage', label: 'Sage' },
      { id: 'ash', label: 'Ash' },
      { id: 'ballad', label: 'Ballad' },
      { id: 'coral', label: 'Coral' },
    ];
  }

  async textToSpeech(text: string, options?: MediaGenerateOptions): Promise<Buffer | string> {
    const apiKey = this._apiKey(options);

    // Studio descriptor fields (voice, response_format, speed) arrive in `options.input`;
    // fall back to legacy top-level options so existing callers are unchanged.
    const input = (options?.input || {}) as Record<string, MediaInputValue>;
    const voice = (typeof input.voice === 'string' && input.voice) || options?.voice || 'alloy';
    const responseFormat =
      (typeof input.response_format === 'string' && input.response_format) || options?.format || 'mp3';
    const model = options?.model || 'tts-1';
    const instructions =
      (typeof input.instructions === 'string' && input.instructions) || options?.instructions || '';

    const res = await this._fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        response_format: responseFormat,
        ...(input.speed !== undefined ? { speed: Number(input.speed) } : {}),
        // `instructions` is gpt-4o-mini-tts-only — tts-1/tts-1-hd 400 on the
        // unknown field, so it is sent for exactly that model.
        ...(model === 'gpt-4o-mini-tts' && instructions ? { instructions } : {}),
      }),
    });

    if (!res.ok) throw await mediaUpstreamError(this, res, 'audio');
    return Buffer.from(await res.arrayBuffer());
  }

  async speechToText(audio: Buffer, options?: MediaGenerateOptions): Promise<string> {
    const apiKey = this._apiKey(options);

    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(audio)]), 'audio.mp3');
    formData.append('model', options?.model || 'whisper-1');

    const res = await this._fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) throw await mediaUpstreamError(this, res, 'stt');
    const data = (await res.json()) as OpenAITranscriptionResponse;
    return data.text || '';
  }

  // Free auth check: GET /v1/models is an unmetered catalog read — the settings
  // Test button must not fall back to a billed image render.
  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) return { ok: false, message: 'OpenAI API key is required' };
    const res = await this._fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return { ok: true, message: 'Connection successful' };
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Invalid API key' };
    throw new Error(`OpenAI connection test failed (${res.status}): ${redactError(await res.text(), 200)}`);
  }
}

const _meta = new OpenaiMediaAdapter(undefined as unknown as SafeFetchPort);

export const openaiMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new OpenaiMediaAdapter(rt.fetch),
};
