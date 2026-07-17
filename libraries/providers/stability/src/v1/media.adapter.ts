import { metadata as providerMetadata } from './metadata';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaPollResult,
  resolveApiKey,
  redactError,
  isTransientStatus,
  validateModelId,
  readCappedArrayBuffer,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

const BASE = 'https://api.stability.ai';

// Cap a fetched source frame before buffering it into a multipart upload (6.1j).
const MAX_SOURCE_IMAGE_BYTES = 32 * 1024 * 1024;

interface StabilityImageResponse {
  image?: string;
  seed?: number;
  finish_reason?: string;
}

interface StabilityVideoSubmitResponse {
  id?: string;
}

interface StabilityVideoResultResponse {
  video?: string;
  errors?: string[];
  finish_reason?: string;
}

interface StabilityAudioResponse {
  audio?: string;
  errors?: string[];
}

export class StabilityAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'stability-ai';
  readonly name = 'Stability AI';
  readonly capabilities: MediaProviderCapabilities = {
    image: true,
    video: true,
    audio: true,
    avatar: false,
    tts: false,
    stt: false,
    upscale: false,
    bgRemove: false,
    inpaint: false,
  };

  private _auth(options?: MediaCredentialOptions): string {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('Stability AI API key is required');
    return `Bearer ${apiKey}`;
  }

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    // Native Stable Image params (negative_prompt, aspect_ratio, style_preset, seed,
    // output_format, …) ride through `options.input`. `model` selects the endpoint
    // (core/ultra/sd3). Defaults apply only when input omits them; merge before append
    // so a descriptor value never produces a duplicate form field.
    const fields: Record<string, string | number | boolean> = {
      output_format: options?.format || 'png',
      ...(options?.input || {}),
    };
    if (options?.aspectRatio && !('aspect_ratio' in fields)) {
      fields.aspect_ratio = options.aspectRatio;
    }

    const form = new FormData();
    form.append('prompt', prompt);
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === '') continue;
      form.append(key, String(value));
    }

    const model = validateModelId(options?.model || 'core');
    const res = await this._fetch(`${BASE}/v2beta/stable-image/generate/${model}`, {
      method: 'POST',
      headers: { Authorization: this._auth(options), Accept: 'application/json' },
      body: form,
    });
    if (!res.ok) throw new Error(`Stability AI image generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as StabilityImageResponse;
    if (!data.image) throw new Error('Stability AI returned no image');
    const fmt = String(fields.output_format || 'png');
    const mime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
    const image = `data:${mime};base64,${data.image}`;
    return {
      multi: false,
      image,
      images: [image],
      metadata: { provider: this.identifier, model, seed: data.seed, mime },
    };
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    // Stability video generation is image-to-video — requires a source frame.
    if (!options?.sourceUrl) {
      throw new Error('Stability AI video generation requires a source image (sourceUrl)');
    }
    const imageRes = await this._fetch(options.sourceUrl);
    if (!imageRes.ok) throw new Error('Stability AI: could not fetch source image');
    const imageBuffer = await readCappedArrayBuffer(imageRes as any, MAX_SOURCE_IMAGE_BYTES);

    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(imageBuffer)]), 'source.png');

    const res = await this._fetch(`${BASE}/v2beta/image-to-video`, {
      method: 'POST',
      headers: { Authorization: this._auth(options) },
      body: form,
    });
    if (!res.ok) throw new Error(`Stability AI video generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as StabilityVideoSubmitResponse;
    if (!data.id) throw new Error('Stability AI returned no job id');
    return { jobId: data.id };
  }

  // Stable Audio is synchronous — return the artifact inline (no webhook/poll needed).
  async generateAudio(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('output_format', 'mp3');
    if (options?.durationSeconds) form.append('duration', String(options.durationSeconds));

    const res = await this._fetch(`${BASE}/v2beta/audio/stable-audio-2/text-to-audio`, {
      method: 'POST',
      headers: { Authorization: this._auth(options), Accept: 'application/json' },
      body: form,
    });
    if (!res.ok) throw new Error(`Stability AI audio generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as StabilityAudioResponse;
    if (!data.audio) throw new Error('Stability AI returned no audio');
    return {
      jobId: `stability-audio-${Date.now()}`,
      artifactUrl: `data:audio/mpeg;base64,${data.audio}`,
      metadata: { provider: this.identifier, mime: 'audio/mpeg', durationSeconds: options?.durationSeconds },
    };
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Stability AI does not support avatar generation');
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    if (!resolveApiKey(options)) return { status: 'failed', error: 'Stability AI API key is required' };

    const res = await this._fetch(`${BASE}/v2beta/image-to-video/result/${jobId}`, {
      headers: { Authorization: this._auth(options), Accept: 'application/json' },
    });
    if (res.status === 202) return { status: 'pending' };
    if (!res.ok) {
      const body = await res.text();
      // 3.4 — transient poll error: THROW so the still-rendering job retries.
      if (isTransientStatus(res.status)) {
        throw new Error(`Stability AI poll transient error ${res.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: redactError(body) };
    }
    const data = (await res.json()) as StabilityVideoResultResponse;
    if (!data.video) {
      return { status: 'failed', error: redactError(data.errors?.join('; ') || 'Stability AI job returned no video') };
    }
    return {
      status: 'completed',
      artifactUrl: `data:video/mp4;base64,${data.video}`,
      metadata: { provider: this.identifier, mime: 'video/mp4' },
    };
  }
}

const _meta = new StabilityAdapter(undefined as unknown as SafeFetchPort);

export const stabilityMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new StabilityAdapter(rt.fetch),
};
