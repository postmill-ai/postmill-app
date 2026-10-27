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
  readCappedArrayBuffer,
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
// polled by the lifecycle, with successful responses coalesced/throttled to ≥10s.
const IMAGE_POLL_INTERVAL_MS = 2000;
const IMAGE_POLL_DEADLINE_MS = 90_000;
const VIDEO_POLL_INTERVAL_MS = 10_000;
const MAX_CACHED_VIDEO_POLLS = 256;
const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const REFERENCE_IMAGE_INDEXES = [1, 2, 3] as const;

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

interface InlineImageReference {
  type: 'inline_base64';
  content_base64: string;
  mime_type: string;
}

interface VeoMediaFields {
  start_frame?: InlineImageReference;
  end_frame?: InlineImageReference;
  images?: Array<{ image: InlineImageReference; role: 'subject' | 'style' }>;
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

function inlineImageReference(bytes: Buffer, mime: string): InlineImageReference {
  const normalizedMime = mime.toLowerCase();
  if (!IMAGE_MIME_TYPES.has(normalizedMime)) {
    throw new Error(`ElevenLabs reference image MIME type "${mime || 'unknown'}" is not supported`);
  }
  if (bytes.length === 0) throw new Error('ElevenLabs reference image is empty');
  if (bytes.length > MAX_INLINE_IMAGE_BYTES) {
    throw new Error('ElevenLabs reference images must be 25 MB or smaller');
  }
  return {
    type: 'inline_base64',
    content_base64: bytes.toString('base64'),
    mime_type: normalizedMime,
  };
}

export class ElevenLabsAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  private readonly _videoPollCache = new Map<string, { at: number; result: MediaPollResult }>();
  private readonly _videoPollFlights = new Map<string, Promise<MediaPollResult>>();
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

  private async _readImageReference(value: string): Promise<InlineImageReference> {
    if (value.startsWith('data:')) {
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
      if (!match) throw new Error('ElevenLabs reference image data URL is invalid');
      return inlineImageReference(Buffer.from(match[2], 'base64'), match[1]);
    }
    if (!/^https?:\/\//.test(value)) {
      throw new Error('ElevenLabs reference image must resolve to a file URL');
    }
    const res = await this._fetch(value);
    if (!res.ok) throw new Error(`ElevenLabs reference image fetch failed (HTTP ${res.status})`);
    let bytes: Buffer;
    try {
      bytes = await readCappedArrayBuffer(res, MAX_INLINE_IMAGE_BYTES);
    } catch (err) {
      if (/too large|exceeded cap/i.test((err as Error).message)) {
        throw new Error('ElevenLabs reference images must be 25 MB or smaller');
      }
      throw err;
    }
    return inlineImageReference(bytes, res.headers.get('content-type')?.split(';')[0].trim() || '');
  }

  private async _veoMediaFields(model: string, input: Record<string, MediaInputValue>): Promise<VeoMediaFields> {
    const imageValue = (name: string): string | undefined => {
      const value = input[name];
      if (value === undefined || value === '') return undefined;
      if (typeof value !== 'string') throw new Error(`ElevenLabs ${name} must be an image file`);
      return value;
    };
    const start = imageValue('start_frame');
    const end = imageValue('end_frame');
    const references = REFERENCE_IMAGE_INDEXES.map((index) => ({
      index,
      value: imageValue(`reference_image_${index}`),
    })).filter((entry): entry is { index: 1 | 2 | 3; value: string } => !!entry.value);
    if (!start && !end && references.length === 0) return {};
    if (!VIDEO_MODEL_FIELDS[model]) throw new Error(`ElevenLabs model ${model} does not support Veo image inputs`);
    if (end && !start) throw new Error('ElevenLabs end frame requires a start frame');
    if (references.length > 0 && (start || end)) {
      throw new Error('ElevenLabs reference images cannot be combined with start or end frames');
    }
    if (references.length > 0 && Number(input.duration_secs) !== 8) {
      throw new Error('ElevenLabs reference-to-video requires an 8-second duration');
    }

    const out: VeoMediaFields = {};
    if (start) out.start_frame = await this._readImageReference(start);
    if (end) out.end_frame = await this._readImageReference(end);
    if (references.length > 0) {
      out.images = [];
      for (const { index, value } of references) {
        const role = input[`reference_image_${index}_role`] ?? 'subject';
        if (role !== 'subject' && role !== 'style') {
          throw new Error(`ElevenLabs reference image ${index} role must be subject or style`);
        }
        out.images.push({ image: await this._readImageReference(value), role });
      }
    }
    return out;
  }

  private async _submitFlow(
    modality: 'image' | 'video',
    model: string,
    prompt: string,
    options?: MediaGenerateOptions,
  ): Promise<string> {
    const apiKey = this._key(options);
    const input = options?.input || {};
    const mediaFields = modality === 'video' ? await this._veoMediaFields(model, input) : {};
    const res = await this._fetch(`${FLOWS_BASE}/${modality}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        model_id: model,
        prompt,
        ...pickFields(modality === 'image' ? IMAGE_MODEL_FIELDS : VIDEO_MODEL_FIELDS, model, input),
        ...mediaFields,
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
    return modality === 'video' ? this._pollVideo(id, apiKey) : this._pollFlow(modality, id, apiKey);
  }

  private async _pollVideo(id: string, apiKey: string): Promise<MediaPollResult> {
    const cached = this._videoPollCache.get(id);
    if (cached && Date.now() - cached.at < VIDEO_POLL_INTERVAL_MS) return cached.result;
    const existing = this._videoPollFlights.get(id);
    if (existing) return existing;

    const flight = this._pollFlow('video', id, apiKey)
      .then((result) => {
        this._videoPollCache.delete(id);
        this._videoPollCache.set(id, { at: Date.now(), result });
        while (this._videoPollCache.size > MAX_CACHED_VIDEO_POLLS) {
          const oldest = this._videoPollCache.keys().next().value;
          if (oldest !== undefined) this._videoPollCache.delete(oldest);
        }
        return result;
      })
      .finally(() => this._videoPollFlights.delete(id));
    this._videoPollFlights.set(id, flight);
    return flight;
  }

  private async _pollFlow(modality: 'image' | 'video', id: string, apiKey: string): Promise<MediaPollResult> {
    const res = await this._fetch(`${FLOWS_BASE}/${modality}/${id}`, {
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) {
      const error = await mediaUpstreamError(this, res, modality);
      // Transient failures are never cached or converted to a terminal result.
      if (isTransientStatus(res.status)) throw error;
      return { status: 'failed', error: error.message };
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

  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) return { ok: false, message: 'ElevenLabs API key is required' };
    const res = await this._fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) throw await mediaUpstreamError(this, res, 'audio');
    return { ok: true, message: 'Connection successful' };
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
