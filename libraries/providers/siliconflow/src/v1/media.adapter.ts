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
  readCappedArrayBuffer,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// Cap a fetched source frame before base64-inlining it into the i2v request body (6.1j).
const MAX_SOURCE_IMAGE_BYTES = 32 * 1024 * 1024;

// SiliconFlow — same key as the SiliconFlow LLM provider (registry id `siliconflow`), reused
// via the universal-credential fallback. Image + TTS ride the OpenAI-compatible base
// (`/v1/images/generations`, `/v1/audio/speech`). Video is SiliconFlow's async job API
// (`POST /v1/video/submit` → poll `POST /v1/video/status`), no webhook → poll-cron / on-read
// completion. Image-to-video needs the source frame as base64.
interface SiliconFlowSubmit {
  requestId?: string;
}

interface SiliconFlowStatus {
  status?: string;
  reason?: string;
  results?: { videos?: { url?: string }[] };
}

export class SiliconFlowMediaAdapter extends OpenAiCompatibleMediaAdapter {
  readonly identifier = 'siliconflow';
  readonly name = 'SiliconFlow';
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

  protected readonly baseUrl = 'https://api.siliconflow.com/v1';
  protected override defaultImageModel = 'black-forest-labs/FLUX.1-schnell';
  protected override defaultAudioModel = 'fishaudio/fish-speech-1.5';
  protected override defaultVoice = 'fishaudio/fish-speech-1.5:alex';

  override async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const model = options?.model;
    if (!model) throw new Error('SiliconFlow video generation requires a model');
    const input = this._clean(options?.input);
    const body: Record<string, MediaInputValue> = { model, prompt };
    for (const [k, v] of Object.entries(input)) {
      if (k === 'image') continue;
      body[k] = v;
    }
    // i2v source frame must be base64; resolve from the public URL the studio passed.
    if (typeof input.image === 'string' && input.image) {
      body.image = await this._toBase64(input.image, options);
    }
    const res = await this._fetch(`${this.baseUrl}/video/submit`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`SiliconFlow video generation failed: ${redactError(await res.text())}`);
    const requestId = ((await res.json()) as SiliconFlowSubmit).requestId;
    if (!requestId) throw new Error('SiliconFlow returned no requestId');
    return { jobId: requestId };
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    if (!resolveApiKey(options)) return { status: 'failed', error: 'SiliconFlow API key is required' };

    const res = await this._fetch(`${this.baseUrl}/video/status`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({ requestId: jobId }),
    });
    if (!res.ok) {
      const body = await res.text();
      // 3.4 — transient poll error: THROW so the still-rendering video retries.
      if (isTransientStatus(res.status)) {
        throw new Error(`SiliconFlow poll transient error ${res.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: redactError(body) };
    }
    const data = (await res.json()) as SiliconFlowStatus;
    const status = (data.status || '').toLowerCase();
    if (status === 'succeed' || status === 'succeeded' || status === 'success') {
      const url = data.results?.videos?.[0]?.url;
      if (!url) return { status: 'failed', error: 'SiliconFlow video completed without a url' };
      return { status: 'completed', artifactUrl: url, metadata: { provider: this.identifier } };
    }
    if (status === 'failed' || status === 'error') {
      return { status: 'failed', error: redactError(data.reason || 'SiliconFlow video generation failed') };
    }
    return { status: 'pending' };
  }

  private async _toBase64(url: string, _options?: MediaCredentialOptions): Promise<string> {
    try {
      const res = await this._fetch(url, {});
      if (!res.ok) return url;
      // 6.1j — cap the source frame (content-length pre-check + streamed cap) before base64.
      const buf = await readCappedArrayBuffer(res as any, MAX_SOURCE_IMAGE_BYTES);
      const mime = res.headers.get('content-type') || 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return url;
    }
  }

  // SiliconFlow's /models catalog tags image models; video/audio fall back to the
  // descriptor's curated options + free entry.
  protected override _modelTypes(operation: MediaOperation): string[] {
    if (operation === 'image') return ['image'];
    return [];
  }

  override async listModels(operation: MediaOperation, options?: MediaCredentialOptions): Promise<MediaModelOption[]> {
    if (operation !== 'image') return [];
    return super.listModels(operation, options);
  }
}

const _meta = new SiliconFlowMediaAdapter(undefined as unknown as SafeFetchPort);

export const siliconflowMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new SiliconFlowMediaAdapter(rt.fetch),
};
