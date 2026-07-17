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

const BASE = 'https://api.minimax.io/v1';

// Cap the inline (data-URL) audio the sync T2A path decodes so a malformed/oversized hex
// payload can't blow up memory (6.1e). 64 MB of decoded audio ≈ 128 MB of hex text.
const MAX_INLINE_AUDIO_BYTES = 64 * 1024 * 1024;

interface MiniMaxBaseResp {
  base_resp?: { status_code?: number; status_msg?: string };
}

interface MiniMaxImageResponse extends MiniMaxBaseResp {
  data?: { image_urls?: string[] };
}

interface MiniMaxVideoSubmitResponse extends MiniMaxBaseResp {
  task_id?: string;
}

interface MiniMaxVideoQueryResponse extends MiniMaxBaseResp {
  status?: string;
  file_id?: string;
}

interface MiniMaxFileResponse extends MiniMaxBaseResp {
  file?: { download_url?: string };
}

interface MiniMaxAudioResponse extends MiniMaxBaseResp {
  data?: { audio?: string };
}

export class MiniMaxMediaAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'minimax';
  readonly name = 'MiniMax';
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
    if (!apiKey) throw new Error('MiniMax API key is required');
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  }

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const model = options?.model || 'image-01';
    const res = await this._fetch(`${BASE}/image_generation`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({
        model,
        prompt,
        n: options?.n || 1,
        response_format: 'url',
        ...(options?.aspectRatio ? { aspect_ratio: options.aspectRatio } : {}),
      }),
    });
    if (!res.ok) throw new Error(`MiniMax image generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as MiniMaxImageResponse;
    const urls = (data.data?.image_urls || []).filter((u) => typeof u === 'string' && u.length > 0);
    if (urls.length === 0) {
      throw new Error(`MiniMax returned no images: ${data.base_resp?.status_msg || 'unknown error'}`);
    }
    return {
      multi: urls.length > 1,
      image: urls[0],
      images: urls,
      metadata: { provider: this.identifier, model },
    };
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const model = options?.model || 'video-01';
    // Native params (first_frame_image, prompt_optimizer, …) ride `options.input`.
    // `subject_image` is a flattened convenience field folded into MiniMax's nested
    // `subject_reference` array (S2V models).
    const input = (options?.input || {}) as Record<string, unknown>;
    const { subject_image, ...rest } = input;
    const res = await this._fetch(`${BASE}/video_generation`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({
        model,
        prompt,
        ...rest,
        ...(typeof subject_image === 'string'
          ? { subject_reference: [{ type: 'character', image: [subject_image] }] }
          : {}),
        ...(options?.webhookUrl ? { callback_url: options.webhookUrl } : {}),
      }),
    });
    if (!res.ok) throw new Error(`MiniMax video generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as MiniMaxVideoSubmitResponse;
    if (!data.task_id) {
      throw new Error(`MiniMax returned no task id: ${data.base_resp?.status_msg || 'unknown error'}`);
    }
    return { jobId: data.task_id };
  }

  // MiniMax T2A is synchronous — return the artifact inline.
  async generateAudio(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const model = options?.model || 'speech-01-turbo';
    const res = await this._fetch(`${BASE}/t2a_v2`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({
        model,
        text: prompt,
        stream: false,
        voice_setting: { voice_id: options?.voiceId || options?.voice || 'female-shaonv', speed: 1 },
        audio_setting: { format: 'mp3' },
      }),
    });
    if (!res.ok) throw new Error(`MiniMax audio generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as MiniMaxAudioResponse;
    if (!data.data?.audio) {
      throw new Error(`MiniMax returned no audio: ${data.base_resp?.status_msg || 'unknown error'}`);
    }
    // MiniMax returns hex-encoded audio bytes. Validate the hex shape and cap the size before
    // decoding so a malformed/oversized payload can't corrupt the clip or exhaust memory (6.1e).
    const hex = data.data.audio;
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
      throw new Error('MiniMax returned malformed (non-hex) audio');
    }
    if (hex.length / 2 > MAX_INLINE_AUDIO_BYTES) {
      throw new Error('MiniMax audio exceeds the inline size cap');
    }
    const base64 = Buffer.from(hex, 'hex').toString('base64');
    return {
      jobId: `minimax-audio-${Date.now()}`,
      artifactUrl: `data:audio/mpeg;base64,${base64}`,
      metadata: { provider: this.identifier, model, mime: 'audio/mpeg' },
    };
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('MiniMax does not support avatar generation');
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    if (!resolveApiKey(options)) return { status: 'failed', error: 'MiniMax API key is required' };

    const res = await this._fetch(`${BASE}/query/video_generation?task_id=${encodeURIComponent(jobId)}`, {
      headers: this._headers(options),
    });
    if (!res.ok) {
      const body = await res.text();
      // 3.4 — transient query error: THROW so the still-rendering job retries.
      if (isTransientStatus(res.status)) {
        throw new Error(`MiniMax query poll transient error ${res.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: redactError(body) };
    }
    const data = (await res.json()) as MiniMaxVideoQueryResponse;

    if (data.status === 'Success' && data.file_id) {
      const fileRes = await this._fetch(`${BASE}/files/retrieve?file_id=${encodeURIComponent(data.file_id)}`, {
        headers: this._headers(options),
      });
      // 3.4 — the render already succeeded; a transient error on the file-retrieve leg must
      // retry, not permanently fail a completed generation.
      if (!fileRes.ok) {
        const body = await fileRes.text();
        if (isTransientStatus(fileRes.status)) {
          throw new Error(`MiniMax file retrieve transient error ${fileRes.status}: ${redactError(body, 200)}`);
        }
        return { status: 'failed', error: redactError(body) };
      }
      const file = (await fileRes.json()) as MiniMaxFileResponse;
      if (!file.file?.download_url) {
        return { status: 'failed', error: 'MiniMax file has no download URL' };
      }
      return {
        status: 'completed',
        artifactUrl: file.file.download_url,
        metadata: { provider: this.identifier, mime: 'video/mp4' },
      };
    }
    if (data.status === 'Fail') {
      return { status: 'failed', error: redactError(data.base_resp?.status_msg || 'MiniMax video generation failed') };
    }
    return { status: 'pending' };
  }
}

const _meta = new MiniMaxMediaAdapter(undefined as unknown as SafeFetchPort);

export const minimaxMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new MiniMaxMediaAdapter(rt.fetch),
};
