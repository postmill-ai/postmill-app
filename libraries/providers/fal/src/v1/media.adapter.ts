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
  validateModelId,
  isTransientStatus,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

interface FalQueueSubmitResponse {
  request_id?: string;
}

interface FalQueueStatusResponse {
  status?: string;
  error?: string;
}

interface FalResultResponse {
  images?: { url?: string; width?: number; height?: number }[];
  video?: { url?: string };
  audio?: { url?: string };
  audio_file?: { url?: string };
  seed?: number;
}

// 2.1 — a 429/5xx on a status/result poll is transient: THROW so the lifecycle retries the
// render rather than permanently failing a job whose generation may still be fine.

const DEFAULT_IMAGE_MODEL = 'fal-ai/flux/schnell';
const DEFAULT_VIDEO_MODEL = 'fal-ai/kling-video/v1.6/standard/text-to-video';
const DEFAULT_AUDIO_MODEL = 'fal-ai/stable-audio';

// fal queue job ids carry the model path (the status/result URLs include it):
// `<model>::<request_id>`.
function encodeJobId(model: string, requestId: string): string {
  return `${model}::${requestId}`;
}

// 6.1i — a job id with no `::` is a legacy (pre-namespacing) id; the model path can't be
// recovered, so decoding to a default would poll the wrong endpoint (404). Signal it instead.
function decodeJobId(jobId: string): { model: string; requestId: string } | null {
  const idx = jobId.lastIndexOf('::');
  if (idx === -1) return null;
  return { model: jobId.slice(0, idx), requestId: jobId.slice(idx + 2) };
}

export class FalAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'fal';
  // Display name shown in Settings → Media. Kept as "Kling" to match the studio
  // (/media/kling, nav + title "Kling"); the registry/config identifier stays `fal`.
  readonly name = 'Kling';
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

  private _headers(options?: MediaCredentialOptions): Record<string, string> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('fal.ai API key is required');
    return {
      'Content-Type': 'application/json',
      Authorization: `Key ${apiKey}`,
    };
  }

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const model = validateModelId(options?.model || DEFAULT_IMAGE_MODEL);
    const res = await this._fetch(`https://fal.run/${model}`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({
        prompt,
        num_images: options?.n || 1,
        ...options?.input,
      }),
    });
    if (!res.ok) throw new Error(`fal.ai image generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as FalResultResponse;
    const urls = (data.images || [])
      .map((i) => i.url)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);
    if (urls.length === 0) throw new Error('fal.ai returned no images');
    return {
      multi: urls.length > 1,
      image: urls[0],
      images: urls,
      metadata: {
        provider: this.identifier,
        model,
        seed: data.seed,
        width: data.images?.[0]?.width,
        height: data.images?.[0]?.height,
      },
    };
  }

  private async _submitQueue(
    model: string,
    prompt: string,
    options?: MediaGenerateOptions,
  ): Promise<MediaJobSubmission> {
    validateModelId(model);
    const url = new URL(`https://queue.fal.run/${model}`);
    if (options?.webhookUrl) url.searchParams.set('fal_webhook', options.webhookUrl);
    const res = await this._fetch(url.toString(), {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({ prompt, ...options?.input }),
    });
    if (!res.ok) throw new Error(`fal.ai job submission failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as FalQueueSubmitResponse;
    if (!data.request_id) throw new Error('fal.ai returned no request id');
    return { jobId: encodeJobId(model, data.request_id) };
  }

  generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    return this._submitQueue(options?.model || DEFAULT_VIDEO_MODEL, prompt, options);
  }

  generateAudio(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    return this._submitQueue(options?.model || DEFAULT_AUDIO_MODEL, prompt, options);
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('fal.ai avatar generation not supported');
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    // Missing key is a config error → terminal failed (matches openai/Sora), not a thrown
    // error the lifecycle would retry to the 24h timeout.
    if (!resolveApiKey(options)) return { status: 'failed', error: 'fal.ai API key is required' };

    const decoded = decodeJobId(jobId);
    // 6.1i — a legacy (un-namespaced) id can't route to the right model path; fail terminally
    // rather than polling a wrong/default endpoint that 404s until the 24h timeout.
    if (!decoded) return { status: 'failed', error: 'fal.ai legacy job id (no model namespace) cannot be polled' };
    const { model, requestId } = decoded;
    const statusRes = await this._fetch(
      `https://queue.fal.run/${model}/requests/${requestId}/status`,
      { headers: this._headers(options) },
    );
    if (!statusRes.ok) {
      const body = await statusRes.text();
      if (isTransientStatus(statusRes.status)) throw new Error(`fal.ai status poll transient error ${statusRes.status}: ${redactError(body, 200)}`);
      return { status: 'failed', error: redactError(body) };
    }
    const status = (await statusRes.json()) as FalQueueStatusResponse;

    if (status.status === 'COMPLETED') {
      const resultRes = await this._fetch(
        `https://queue.fal.run/${model}/requests/${requestId}`,
        { headers: this._headers(options) },
      );
      // Post-success result fetch: a 429/5xx here must retry (the render already succeeded).
      if (!resultRes.ok) {
        const body = await resultRes.text();
        if (isTransientStatus(resultRes.status)) throw new Error(`fal.ai result fetch transient error ${resultRes.status}: ${redactError(body, 200)}`);
        return { status: 'failed', error: redactError(body) };
      }
      const result = (await resultRes.json()) as FalResultResponse;
      const artifactUrl =
        result.video?.url ||
        result.audio?.url ||
        result.audio_file?.url ||
        result.images?.[0]?.url;
      if (!artifactUrl) return { status: 'failed', error: 'fal.ai job completed without output' };
      return {
        status: 'completed',
        artifactUrl,
        metadata: { provider: this.identifier, model, seed: result.seed },
      };
    }
    if (status.status === 'FAILED' || status.status === 'CANCELLED') {
      return { status: 'failed', error: redactError(status.error || `fal.ai job ${status.status}`) };
    }
    return { status: 'pending' };
  }
}

const _meta = new FalAdapter(undefined as unknown as SafeFetchPort);

export const falMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new FalAdapter(rt.fetch),
};
