import { metadata as providerMetadata } from './metadata';
import {
  OpenAiCompatibleMediaAdapter,
  MediaProviderCapabilities,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaPollResult,
  MediaOperation,
  MediaModelOption,
  MediaInputValue,
  resolveApiKey,
  redactError,
  isTransientStatus,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// Together AI — same key as the Together LLM provider (registry id `togetherai`), reused
// via the universal-credential fallback. Image + TTS ride the shared OpenAI-compatible base
// (`/v1/images/generations`, `/v1/audio/speech`). Video is Together's own async job API
// (`POST /v1/videos` → poll `GET /v1/videos/{id}`, `outputs.video_url` on completion) — no
// webhook, so it completes via the media-jobs-poll cron / on-read poll. Image-to-video puts
// the source frame under the native `media.frame_images[]` object.
interface TogetherVideoCreate {
  id?: string;
  status?: string;
}

interface TogetherVideoStatus {
  status?: string;
  error?: { message?: string; code?: string };
  outputs?: { video_url?: string } | { video_url?: string }[];
}

export class TogetherAiMediaAdapter extends OpenAiCompatibleMediaAdapter {
  readonly identifier = 'togetherai';
  readonly name = 'Together AI';
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

  protected readonly baseUrl = 'https://api.together.ai/v1';
  protected override defaultImageModel = 'black-forest-labs/FLUX.1-schnell';
  protected override defaultAudioModel = 'cartesia/sonic-2';
  protected override defaultVoice = 'helpful woman';

  override async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const model = options?.model;
    if (!model) throw new Error('Together video generation requires a model');
    const res = await this._fetch(`${this.baseUrl}/videos`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({ model, prompt, ...this._videoBody(options?.input) }),
    });
    if (!res.ok) throw new Error(`Together video generation failed: ${redactError(await res.text())}`);
    const id = ((await res.json()) as TogetherVideoCreate).id;
    if (!id) throw new Error('Together returned no video id');
    return { jobId: id };
  }

  // Map the flat studio input to Together's video body; a `frame_image` URL (from the media
  // picker, resolved server-side) becomes the native `media.frame_images[]` for i2v.
  private _videoBody(raw?: Record<string, MediaInputValue>): Record<string, unknown> {
    const input = this._clean(raw);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (k === 'frame_image') continue;
      body[k] = v;
    }
    if (typeof input.frame_image === 'string' && input.frame_image) {
      body.media = { frame_images: [input.frame_image] };
    }
    return body;
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    if (!resolveApiKey(options)) return { status: 'failed', error: 'Together AI API key is required' };

    const res = await this._fetch(`${this.baseUrl}/videos/${jobId}`, { headers: this._headers(options) });
    if (!res.ok) {
      const body = await res.text();
      // 3.4 — transient poll error: THROW so the still-rendering video retries.
      if (isTransientStatus(res.status)) {
        throw new Error(`Together poll transient error ${res.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: redactError(body) };
    }
    const data = (await res.json()) as TogetherVideoStatus;
    const status = data.status;
    if (status === 'completed') {
      const out = Array.isArray(data.outputs) ? data.outputs[0] : data.outputs;
      const url = out?.video_url;
      if (!url) return { status: 'failed', error: 'Together video completed without a url' };
      return { status: 'completed', artifactUrl: url, metadata: { provider: this.identifier } };
    }
    if (status === 'failed' || status === 'error' || status === 'canceled') {
      return { status: 'failed', error: redactError(data.error?.message || 'Together video generation failed') };
    }
    return { status: 'pending' };
  }

  // Together's /models catalog tags image models `type: image`; video/audio aren't reliably
  // tagged there, so those fall back to the descriptor's curated options + free entry.
  protected override _modelTypes(operation: MediaOperation): string[] {
    if (operation === 'image') return ['image'];
    return [];
  }

  override async listModels(operation: MediaOperation, options?: MediaCredentialOptions): Promise<MediaModelOption[]> {
    if (operation !== 'image') return [];
    return super.listModels(operation, options);
  }
}

const _meta = new TogetherAiMediaAdapter(undefined as unknown as SafeFetchPort);

export const togetheraiMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new TogetherAiMediaAdapter(rt.fetch),
};
