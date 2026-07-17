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
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

const BASE = 'https://api.dev.runwayml.com/v1';
const API_VERSION = '2024-11-06';

interface RunwayTaskCreateResponse {
  id?: string;
}

interface RunwayTaskStatusResponse {
  status?: string;
  output?: string[];
  failure?: string;
  failureCode?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class RunwayAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'runway';
  readonly name = 'Runway';
  readonly capabilities: MediaProviderCapabilities = {
    image: true,
    video: true,
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
    if (!apiKey) throw new Error('Runway API key is required');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Runway-Version': API_VERSION,
    };
  }

  // Runway image generation is task-based; bounded internal polling keeps the
  // synchronous image contract (§11.2) — near-real-time or fail.
  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const model = options?.model || 'gen4_image';
    const input = (options?.input || {}) as Record<string, unknown>;
    const res = await this._fetch(`${BASE}/text_to_image`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({
        promptText: prompt,
        model,
        ratio: '1360:768',
        ...(options?.aspectRatio ? { ratio: options.aspectRatio } : {}),
        ...input,
      }),
    });
    if (!res.ok) throw new Error(`Runway image generation failed: ${redactError(await res.text())}`);
    const { id } = (await res.json()) as RunwayTaskCreateResponse;
    if (!id) throw new Error('Runway returned no task id');

    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(2000);
      const poll = await this.pollJob(id, options);
      if (poll.status === 'completed' && poll.artifactUrl) {
        return {
          multi: false,
          image: poll.artifactUrl,
          images: [poll.artifactUrl],
          metadata: { provider: this.identifier, model },
        };
      }
      if (poll.status === 'failed') {
        throw new Error(`Runway image generation failed: ${poll.error || 'unknown error'}`);
      }
    }
    throw new Error('Runway image generation timed out');
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    // Source image arrives as the native `promptImage` field in `options.input` (the
    // studio's media picker) or the legacy `options.sourceUrl`. Other native params
    // (duration, ratio, seed) ride `options.input` straight into the body.
    const input = (options?.input || {}) as Record<string, unknown>;
    const { promptImage: inputImage, ...rest } = input;
    const promptImage =
      (typeof inputImage === 'string' ? inputImage : undefined) || options?.sourceUrl;
    if (!promptImage) {
      throw new Error('Runway video generation requires a source image');
    }
    const model = options?.model || 'gen4_turbo';
    const res = await this._fetch(`${BASE}/image_to_video`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({
        promptImage,
        promptText: prompt,
        model,
        duration: options?.durationSeconds || 5,
        ratio: '1280:720',
        ...(options?.aspectRatio ? { ratio: options.aspectRatio } : {}),
        ...rest,
      }),
    });
    if (!res.ok) throw new Error(`Runway video generation failed: ${redactError(await res.text())}`);
    const { id } = (await res.json()) as RunwayTaskCreateResponse;
    if (!id) throw new Error('Runway returned no task id');
    return { jobId: id };
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Runway does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Runway does not support avatar generation');
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    if (!resolveApiKey(options)) return { status: 'failed', error: 'Runway API key is required' };

    const res = await this._fetch(`${BASE}/tasks/${jobId}`, {
      headers: this._headers(options),
    });
    if (!res.ok) {
      const body = await res.text();
      // 3.4 — a 429/5xx poll is transient: THROW so the lifecycle retries rather than
      // permanently failing a still-rendering task.
      if (isTransientStatus(res.status)) {
        throw new Error(`Runway poll transient error ${res.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: redactError(body) };
    }
    const data = (await res.json()) as RunwayTaskStatusResponse;

    if (data.status === 'SUCCEEDED') {
      const artifactUrl = data.output?.[0];
      if (!artifactUrl) return { status: 'failed', error: 'Runway task succeeded without output' };
      return { status: 'completed', artifactUrl, metadata: { provider: this.identifier } };
    }
    if (data.status === 'FAILED' || data.status === 'CANCELLED') {
      return { status: 'failed', error: redactError(data.failure || data.failureCode || 'Runway task failed') };
    }
    return { status: 'pending' };
  }
}

const _meta = new RunwayAdapter(undefined as unknown as SafeFetchPort);

export const runwayMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new RunwayAdapter(rt.fetch),
};
