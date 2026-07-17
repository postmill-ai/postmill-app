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
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

const BASE = 'https://api.replicate.com/v1';

// `Prefer: wait` must stay ≤ the outbound `safeFetch` budget (30 s) — a longer wait is killed
// client-side while the prediction keeps running (and billing). We ask for a short blocking
// window and fall back to polling the returned prediction id (2.4).
const PREFER_WAIT_SECONDS = 25;
const DEFAULT_IMAGE_MODEL = 'black-forest-labs/flux-schnell';

type ReplicateOutput = string | string[] | undefined;

interface ReplicatePredictionResponse {
  id?: string;
  status?: string;
  output?: ReplicateOutput;
  error?: string;
}

function firstOutputUrl(output: ReplicateOutput): string | undefined {
  if (Array.isArray(output)) return output.find((u) => typeof u === 'string');
  return typeof output === 'string' ? output : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A Replicate model reference is either a version HASH (64-hex, no slash) → `/predictions`
// with a `version` field, or an `owner/name` SLUG → `/models/{slug}/predictions` (2.5). A slug
// passed as `version` is rejected with a 422, so route it to the models endpoint instead.
function isVersionHash(model: string): boolean {
  return !model.includes('/');
}

export class ReplicateMediaAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'replicate';
  readonly name = 'Replicate';
  readonly capabilities: MediaProviderCapabilities = {
    image: true,
    video: true,
    audio: true,
    avatar: true,
    tts: false,
    stt: false,
    upscale: true,
    bgRemove: true,
    inpaint: true,
    videoToVideo: true,
    videoUpscale: true,
    videoBg: true,
  };

  private _headers(options?: MediaCredentialOptions, preferWait?: number): Record<string, string> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('Replicate API key is required');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(preferWait ? { Prefer: `wait=${preferWait}` } : {}),
    };
  }

  private async _createPrediction(
    options: MediaGenerateOptions | undefined,
    input: Record<string, string | number | boolean | undefined>,
    preferWait?: number,
  ): Promise<ReplicatePredictionResponse> {
    const headers = this._headers(options, preferWait);
    const model = options?.version;
    if (!model) throw new Error('Replicate model/version is required');
    const body = {
      input: { ...input, ...options?.input },
      ...(options?.webhookUrl
        ? { webhook: options.webhookUrl, webhook_events_filter: ['completed'] }
        : {}),
    };
    // Slug → /models/{slug}/predictions (input only); hash → /predictions with `version` (2.5).
    const url = isVersionHash(model)
      ? `${BASE}/predictions`
      : `${BASE}/models/${validateModelId(model)}/predictions`;
    const res = await this._fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(isVersionHash(model) ? { version: model, ...body } : body),
    });
    if (!res.ok) throw new Error(`Replicate request failed: ${redactError(await res.text())}`);
    return (await res.json()) as ReplicatePredictionResponse;
  }

  // A blocking (`Prefer: wait`) create may still return `starting`/`processing` when the window
  // elapses. Rather than returning `''`/throwing "no output" (2.4), poll the prediction id until
  // it reaches a terminal state, keeping the synchronous image/upscale/rembg/inpaint contract.
  private async _resolvePrediction(
    data: ReplicatePredictionResponse,
    options?: MediaCredentialOptions,
  ): Promise<ReplicatePredictionResponse> {
    if (data.status === 'succeeded' || data.status === 'failed' || data.status === 'canceled') {
      return data;
    }
    if (!data.id) throw new Error('Replicate returned no prediction id');
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(2000);
      const res = await this._fetch(`${BASE}/predictions/${data.id}`, {
        headers: this._headers(options),
      });
      if (!res.ok) {
        const body = await res.text();
        // Transient poll error: the prediction may still be fine — surface for a retry.
        if (isTransientStatus(res.status)) {
          throw new Error(`Replicate poll transient error ${res.status}: ${redactError(body, 200)}`);
        }
        throw new Error(`Replicate poll failed: ${redactError(body)}`);
      }
      const polled = (await res.json()) as ReplicatePredictionResponse;
      if (polled.status === 'succeeded' || polled.status === 'failed' || polled.status === 'canceled') {
        return polled;
      }
    }
    throw new Error('Replicate prediction timed out');
  }

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const created = await this._createPrediction(
      { ...options, version: options?.version || options?.model || DEFAULT_IMAGE_MODEL },
      { prompt },
      PREFER_WAIT_SECONDS,
    );
    const data = await this._resolvePrediction(created, options);
    if (data.status === 'failed' || data.status === 'canceled') {
      throw new Error(`Replicate image generation failed: ${data.error || 'unknown error'}`);
    }
    const output = data.output;
    if (!output) throw new Error('Replicate returned no output');

    if (Array.isArray(output)) {
      const urls = output.filter((u): u is string => typeof u === 'string');
      if (urls.length === 0) throw new Error('Replicate returned no image URLs');
      return { multi: urls.length > 1, image: urls[0], images: urls, metadata: { provider: this.identifier } };
    }
    if (typeof output === 'string') {
      return { multi: false, image: output, images: [output], metadata: { provider: this.identifier } };
    }
    throw new Error(`Unexpected Replicate output format: ${JSON.stringify(output)}`);
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    // video-to-video: when a source video is supplied, route to a v2v/restyle model.
    // Accept options.input.video_url per the contract; fall back to options.sourceUrl for compat.
    // NEEDS-LIVE-SMOKE-TEST: confirm the chosen model/version accepts video_url.
    const sourceVideoUrl = options?.input?.video_url ?? options?.sourceUrl;
    const isVideoToVideo = !!sourceVideoUrl;
    const input: Record<string, string | number | boolean | undefined> = isVideoToVideo
      ? { prompt, video_url: sourceVideoUrl }
      : { prompt };

    const modelId = options?.version || options?.model;
    if (isVideoToVideo && !modelId) {
      throw new Error(
        'Replicate video-to-video requires an explicit model/version; no default v2v model is configured',
      );
    }

    const opts: MediaGenerateOptions = { ...options, version: modelId };
    const data = await this._createPrediction(opts, input);
    if (!data.id) throw new Error('Replicate returned no prediction id');
    return { jobId: data.id };
  }

  generateAudio(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    return this.generateVideo(prompt, options);
  }

  generateAvatar(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    return this.generateVideo(prompt, options);
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    // Missing key is a permanent config error → terminal failed, not a thrown error the
    // lifecycle would retry to the 24h timeout.
    if (!resolveApiKey(options)) return { status: 'failed', error: 'Replicate API key is required' };

    const res = await this._fetch(`${BASE}/predictions/${jobId}`, {
      headers: this._headers(options),
    });

    if (!res.ok) {
      const body = await res.text();
      // 3.4 — a 429/5xx poll is transient (render may still be fine): THROW so the lifecycle
      // retries instead of permanently failing a paid, still-running prediction.
      if (isTransientStatus(res.status)) {
        throw new Error(`Replicate poll transient error ${res.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: redactError(body) };
    }
    const data = (await res.json()) as ReplicatePredictionResponse;

    switch (data.status) {
      case 'succeeded': {
        const url = firstOutputUrl(data.output);
        if (!url) return { status: 'failed', error: 'Replicate prediction succeeded without output' };
        return { status: 'completed', artifactUrl: url, metadata: { provider: this.identifier } };
      }
      case 'failed':
      case 'canceled':
        return { status: 'failed', error: redactError(data.error || 'Unknown error') };
      default:
        return { status: 'pending' };
    }
  }

  // Resolve a create response to a single output URL, polling if it is still processing when
  // the blocking window elapses (2.4 — never return '' for an in-flight prediction).
  private async _createAndResolveUrl(
    options: MediaGenerateOptions | undefined,
    input: Record<string, string | number | boolean | undefined>,
  ): Promise<string> {
    const created = await this._createPrediction(options, input, PREFER_WAIT_SECONDS);
    const data = await this._resolvePrediction(created, options);
    if (data.status === 'failed' || data.status === 'canceled') {
      throw new Error(`Replicate operation failed: ${data.error || 'unknown error'}`);
    }
    const url = firstOutputUrl(data.output);
    if (!url) throw new Error('Replicate prediction succeeded without output');
    return url;
  }

  async upscaleImage(imageUrl: string, options?: MediaGenerateOptions): Promise<string> {
    return this._createAndResolveUrl(
      { ...options, version: options?.version || 'nightmareai/real-esrgan' },
      { image: imageUrl, scale: options?.scale || 4 },
    );
  }

  async removeBackground(imageUrl: string, options?: MediaGenerateOptions): Promise<string> {
    return this._createAndResolveUrl(
      { ...options, version: options?.version || 'cjwbw/rembg' },
      { image: imageUrl },
    );
  }

  async inpaintImage(imageUrl: string, maskUrl: string, prompt: string, options?: MediaGenerateOptions): Promise<string> {
    return this._createAndResolveUrl(
      { ...options, version: options?.version || 'stability-ai/stable-diffusion-inpainting' },
      { image: imageUrl, mask: maskUrl, prompt },
    );
  }

  async upscaleVideo(videoUrl: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    // NEEDS-LIVE-SMOKE-TEST: verify model id and input field names against a real Replicate key.
    const data = await this._createPrediction(
      { ...options, version: options?.version || 'lucataco/real-esrgan-video' },
      { video: videoUrl, scale: options?.scale || 4 },
    );
    if (!data.id) throw new Error('Replicate returned no prediction id');
    return { jobId: data.id };
  }

  async removeVideoBackground(videoUrl: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    // NEEDS-LIVE-SMOKE-TEST: verify model id and input field names against a real Replicate key.
    const data = await this._createPrediction(
      { ...options, version: options?.version || 'arielreplicate/robust_video_matting' },
      { video: videoUrl },
    );
    if (!data.id) throw new Error('Replicate returned no prediction id');
    return { jobId: data.id };
  }
}

const _meta = new ReplicateMediaAdapter(undefined as unknown as SafeFetchPort);

export const replicateMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new ReplicateMediaAdapter(rt.fetch),
};
