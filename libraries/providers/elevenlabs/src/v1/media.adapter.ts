import { metadata as providerMetadata } from './metadata';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaPollResult,
  MediaInputValue,
  resolveApiKey,
  redactError,
  isTransientStatus,
  SafeFetchPort,
  ProviderModule,
  mediaUpstreamError,
  mediaUpstreamFailure,
  mediaUpstreamFromPoll,
} from '@postmill-ai/provider-kernel';

// Image & Video (Flows API, launched 2026-09-26): async submit-and-collect on
// POST /v1/flows/{image,video} → {id, status:'pending'}, then GET /v1/flows/{image,video}/{id}
// until completed (carries a signed `content_url`, ~1h expiry — the lifecycle downloads
// immediately) or failed (carries `failure_reason` + `error_message`). Requires an
// ElevenLabs Pro plan (else 402 paid_plan_required — surfaced as an upstream quota error).
// There is no Postmill-reachable webhook on the ElevenLabs workspace side, so
// `options.webhookUrl` is deliberately NOT forwarded; completion comes from the
// media-jobs-poll cron (video) or bounded inline polling (image).
const FLOWS_BASE = 'https://api.elevenlabs.io/v1/flows';

const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';
const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';
const DEFAULT_VIDEO_MODEL = 'veo-3.1-fast-generate-001';

// The Flows API REJECTS unknown request fields and each model accepts only its own
// params, so descriptor input is whitelisted per model — never forwarded wholesale.
// ByteDance seedream/seedance and creatify-aurora are intentionally absent (they need
// explicit ElevenLabs approval / non-text inputs); a model not listed here still
// submits with just `model_id` + `prompt`.
const IMAGE_MODEL_FIELDS: Record<string, readonly string[]> = {
  'gemini-3.1-flash-image': ['aspect_ratio', 'resolution'],
  'gemini-3-pro-image': ['aspect_ratio', 'resolution'],
  'gemini-2.5-flash-image': ['aspect_ratio'],
  'gpt-image-1': ['aspect_ratio', 'quality', 'background'],
  'gpt-image-2': ['aspect_ratio', 'resolution', 'quality'],
};
const VIDEO_MODEL_FIELDS: Record<string, readonly string[]> = {
  'veo-3.1-fast-generate-001': ['duration_secs', 'aspect_ratio', 'resolution', 'generate_audio'],
  'veo-3.1-generate-001': ['duration_secs', 'aspect_ratio', 'resolution', 'generate_audio'],
};

// Docs polling guidance: images at most once every 2s (most finish in seconds) — the
// synchronous generateImage contract is kept with a bounded 90s inline poll. Video is
// polled by the lifecycle (≥10s interval per the docs), never inline.
const IMAGE_POLL_INTERVAL_MS = 2000;
const IMAGE_POLL_DEADLINE_MS = 90_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface FlowsCreateResponse {
  id?: string;
  status?: string;
}

interface FlowsGeneration {
  id?: string;
  status?: 'pending' | 'generating' | 'completed' | 'failed';
  content_url?: string;
  content_mime_type?: string;
  failure_reason?: string;
  error_message?: string;
}

function pickFields(
  whitelist: Record<string, readonly string[]>,
  model: string,
  input: Record<string, MediaInputValue>,
): Record<string, MediaInputValue> {
  const allowed = whitelist[model];
  if (!allowed) return {};
  const out: Record<string, MediaInputValue> = {};
  for (const key of allowed) {
    const value = input[key];
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

export class ElevenLabsAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'elevenlabs';
  readonly name = 'ElevenLabs';
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
    outpaint: false,
  };

  private _key(options?: MediaCredentialOptions): string {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('ElevenLabs API key is required');
    return apiKey;
  }

  private async _submitFlow(
    modality: 'image' | 'video',
    model: string,
    prompt: string,
    options?: MediaGenerateOptions,
  ): Promise<string> {
    const apiKey = this._key(options);
    const res = await this._fetch(`${FLOWS_BASE}/${modality}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        model_id: model,
        prompt,
        ...pickFields(modality === 'image' ? IMAGE_MODEL_FIELDS : VIDEO_MODEL_FIELDS, model, options?.input || {}),
      }),
    });
    if (!res.ok) throw await mediaUpstreamError(this, res, modality);
    const data = (await res.json()) as FlowsCreateResponse;
    if (!data.id) throw new Error('ElevenLabs returned no generation id');
    return data.id;
  }

  // Flows image generation is task-based; bounded inline polling (2s interval, 90s
  // deadline, per the docs' image polling guidance) keeps the synchronous image contract.
  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const model = options?.model || DEFAULT_IMAGE_MODEL;
    const id = await this._submitFlow('image', model, prompt, options);

    const deadline = Date.now() + IMAGE_POLL_DEADLINE_MS;
    while (Date.now() < deadline) {
      await sleep(IMAGE_POLL_INTERVAL_MS);
      const poll = await this.pollJob(`image::${id}`, options);
      if (poll.status === 'completed' && poll.artifactUrl) {
        return {
          multi: false,
          image: poll.artifactUrl,
          images: [poll.artifactUrl],
          metadata: { provider: this.identifier, model, mime: poll.metadata?.mime },
        };
      }
      if (poll.status === 'failed') {
        throw mediaUpstreamFromPoll(this, poll.error || 'unknown error', 'image');
      }
    }
    throw new Error('ElevenLabs image generation timed out');
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const model = options?.model || DEFAULT_VIDEO_MODEL;
    const id = await this._submitFlow('video', model, prompt, options);
    // The modality rides in the job id so pollJob knows which GET endpoint to hit.
    return { jobId: `video::${id}` };
  }

  // ElevenLabs TTS is synchronous — return the artifact inline.
  async generateAudio(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const audio = await this.textToSpeech(prompt, options);
    const base64 = Buffer.isBuffer(audio) ? audio.toString('base64') : audio;
    return {
      jobId: `elevenlabs-audio-${Date.now()}`,
      artifactUrl: `data:audio/mpeg;base64,${base64}`,
      metadata: { provider: this.identifier, mime: 'audio/mpeg' },
    };
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('ElevenLabs does not support avatar generation');
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    // Missing key is a config error → terminal failed (matches the fal/qwen adapters), not a
    // thrown error the lifecycle would retry to the 24h timeout.
    const apiKey = resolveApiKey(options);
    if (!apiKey) return { status: 'failed', error: 'ElevenLabs API key is required' };

    const sep = jobId.indexOf('::');
    const modality = sep === -1 ? '' : jobId.slice(0, sep);
    const id = sep === -1 ? '' : jobId.slice(sep + 2);
    if ((modality !== 'image' && modality !== 'video') || !/^[A-Za-z0-9_-]+$/.test(id)) {
      return { status: 'failed', error: 'ElevenLabs job id is malformed (expected "image::<id>" or "video::<id>")' };
    }

    const res = await this._fetch(`${FLOWS_BASE}/${modality}/${id}`, {
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) {
      const body = await res.text();
      // 429/5xx on a status poll is transient: THROW so the lifecycle retries.
      if (isTransientStatus(res.status)) {
        throw new Error(`ElevenLabs poll transient error ${res.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: mediaUpstreamFailure(this, res.status, body, modality) };
    }
    const data = (await res.json()) as FlowsGeneration;

    if (data.status === 'completed') {
      if (!data.content_url) return { status: 'failed', error: 'ElevenLabs generation completed without output' };
      return {
        status: 'completed',
        artifactUrl: data.content_url,
        metadata: { provider: this.identifier, mime: data.content_mime_type },
      };
    }
    if (data.status === 'failed') {
      const reason = data.failure_reason ? ` (${data.failure_reason})` : '';
      return {
        status: 'failed',
        error: mediaUpstreamFailure(this, undefined, `generation failed${reason}: ${data.error_message || 'unknown error'}`, modality),
      };
    }
    // pending | generating
    return { status: 'pending' };
  }

  async listVoices(options?: MediaGenerateOptions): Promise<Array<{ id: string; label: string; previewUrl?: string }>> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('ElevenLabs API key is required');
    const res = await this._fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) throw await mediaUpstreamError(this, res, 'audio');
    const data = (await res.json()) as {
      voices?: Array<{ voice_id?: string; name?: string; preview_url?: string }>;
    };
    return (data.voices || []).map((v) => ({
      id: v.voice_id || '',
      label: v.name || v.voice_id || '',
      previewUrl: v.preview_url,
    }));
  }

  async textToSpeech(text: string, options?: MediaGenerateOptions): Promise<Buffer | string> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('ElevenLabs API key is required');

    // Studio descriptor fields arrive in `options.input` (native ElevenLabs params); fall
    // back to the legacy top-level options so existing AiMediaService callers are unchanged.
    const input = (options?.input || {}) as Record<string, MediaInputValue>;
    const voiceId =
      (typeof input.voice_id === 'string' && input.voice_id) ||
      options?.voiceId ||
      options?.voice ||
      '21m00Tcm4TlvDq8ikWAM';
    const model =
      options?.model ||
      (typeof input.model_id === 'string' ? input.model_id : undefined) ||
      // eleven_monolingual_v1 / eleven_multilingual_v1 were retired upstream (HTTP 400
      // unsupported_model) — default to the current quality model.
      DEFAULT_TTS_MODEL;

    const voiceSettings: Record<string, number | boolean> = {
      stability:
        input.stability !== undefined ? Number(input.stability) : options?.voiceSettings?.stability ?? 0.5,
      similarity_boost:
        input.similarity_boost !== undefined
          ? Number(input.similarity_boost)
          : options?.voiceSettings?.similarityBoost ?? 0.75,
    };
    if (input.style !== undefined) voiceSettings.style = Number(input.style);
    if (input.use_speaker_boost !== undefined) voiceSettings.use_speaker_boost = Boolean(input.use_speaker_boost);

    const res = await this._fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: voiceSettings,
      }),
    });

    if (!res.ok) throw await mediaUpstreamError(this, res, 'audio');
    return Buffer.from(await res.arrayBuffer());
  }
}

const _meta = new ElevenLabsAdapter(undefined as unknown as SafeFetchPort);

export const elevenlabsMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new ElevenLabsAdapter(rt.fetch),
};
