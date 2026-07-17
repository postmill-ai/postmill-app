import { metadata as providerMetadata } from './metadata';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaPollResult,
  MediaModelOption,
  MediaOperation,
  MediaInputValue,
  resolveApiKey,
  redactError,
  isTransientStatus,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// Genviral Partner API (https://docs.genviral.io) — own-key Bearer provider configured at
// Settings → Media. The Bearer token is a single `public_id.secret` string. Video-only Studio AI
// generation, async:
//   POST /studio/videos          → { ok, data: { video_id, status, output_url } }
//   GET  /studio/videos/{id}     → { ok, data: { status, output_url } }   status: processing|succeeded|failed
//   GET  /studio/models          → catalog for the dynamic model dropdown
// `model_id` is required and chosen from the live catalog (routed to underlying providers — fal /
// Sora / Seedance, etc.). No completion webhook → relies on the media-jobs-poll cron (like Runway).
//
// Built source-grounded WITHOUT a live key: the `/studio/models` response shape is mapped
// defensively (id/name variants) and the model combobox accepts a typed id, so an unexpected
// catalog shape never blocks a render. Smoke-test the exact bodies against a real key.
const BASE = 'https://www.genviral.io/api/partner/v1';

// Flat studio fields that belong inside the request's nested `params` object; every other field
// (speech_text, voice_id, image_url, video_url, audio_url, negative_prompt) rides at the top level.
const PARAM_KEYS = new Set(['resolution', 'duration_seconds', 'fps', 'aspect_ratio', 'generate_audio']);

interface GenviralEnvelope<T> {
  ok?: boolean;
  code?: number;
  message?: string;
  data?: T;
}

interface GenviralVideoData {
  video_id?: string;
  status?: 'processing' | 'succeeded' | 'failed' | string;
  output_url?: string | null;
}

export class GenviralAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'genviral';
  readonly name = 'Genviral';
  readonly capabilities: MediaProviderCapabilities = {
    image: false,
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
    if (!apiKey) throw new Error('Genviral API key is required');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
  }

  async generateImage(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    throw new Error('Genviral does not support image generation');
  }

  // model (the studio `model` field) → required `model_id`; prompt → `prompt`; the resolution/
  // duration/fps/aspect_ratio/generate_audio fields are nested under `params`; all other non-empty
  // fields (incl. resolved media URLs: image_url/video_url/audio_url) ride at the top level.
  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const headers = this._headers(options);
    const model = options?.model;
    if (!model) throw new Error('Genviral requires a model');

    const top: Record<string, MediaInputValue> = {};
    const params: Record<string, MediaInputValue> = {};
    for (const [k, v] of Object.entries(options?.input || {})) {
      if (v === undefined || v === '') continue;
      if (PARAM_KEYS.has(k)) params[k] = v;
      else top[k] = v;
    }

    const body: Record<string, unknown> = { model_id: model, ...top };
    if (prompt) body.prompt = prompt;
    if (Object.keys(params).length) body.params = params;

    const res = await this._fetch(`${BASE}/studio/videos`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Genviral video generation failed: ${redactError(await res.text())}`);
    const envelope = (await res.json()) as GenviralEnvelope<GenviralVideoData>;
    // 6.1g — a 200 with `ok:false` is a terminal application error; surface it rather than
    // throwing "no video id" (which reads as a generic failure).
    if (envelope.ok === false) {
      throw new Error(`Genviral video generation failed: ${redactError(envelope.message || 'unknown error')}`);
    }
    const id = envelope.data?.video_id;
    if (!id) throw new Error('Genviral returned no video id');
    return { jobId: id };
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Genviral does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Genviral does not support avatar generation');
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    if (!resolveApiKey(options)) return { status: 'failed', error: 'Genviral API key is required' };

    const res = await this._fetch(`${BASE}/studio/videos/${jobId}`, { headers: this._headers(options) });
    if (!res.ok) {
      const body = await res.text();
      // 3.4 — transient poll error: THROW so the still-rendering video retries.
      if (isTransientStatus(res.status)) {
        throw new Error(`Genviral poll transient error ${res.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: redactError(body) };
    }
    const envelope = (await res.json()) as GenviralEnvelope<GenviralVideoData>;
    if (envelope.ok === false) {
      return { status: 'failed', error: redactError(envelope.message || 'Genviral video generation failed') };
    }
    const data = envelope.data;

    if (data?.status === 'succeeded') {
      if (!data.output_url) return { status: 'failed', error: 'Genviral completed without output' };
      return { status: 'completed', artifactUrl: data.output_url, metadata: { provider: this.identifier } };
    }
    if (data?.status === 'failed') {
      return { status: 'failed', error: 'Genviral video generation failed' };
    }
    return { status: 'pending' };
  }

  // Live model catalog → the studio's dynamic model dropdown. Only video has models here.
  async listModels(operation: MediaOperation, options?: MediaCredentialOptions): Promise<MediaModelOption[]> {
    if (operation !== 'video') return [];
    const res = await this._fetch(`${BASE}/studio/models`, { headers: this._headers(options) });
    if (!res.ok) return [];
    const body = (await res.json()) as unknown;
    // Tolerate { data: [...] } or a bare array; items may be strings or {id|model_id, name|label}.
    const list = Array.isArray(body)
      ? body
      : Array.isArray((body as { data?: unknown }).data)
        ? (body as { data: unknown[] }).data
        : [];
    return list
      .map((item): MediaModelOption | null => {
        if (typeof item === 'string') return { id: item, label: item };
        const o = item as Record<string, unknown>;
        const id = (o.id || o.model_id || o.slug) as string | undefined;
        if (!id) return null;
        const label = (o.name || o.label || o.title || id) as string;
        return { id, label };
      })
      .filter((m): m is MediaModelOption => m !== null);
  }

  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    let headers: Record<string, string>;
    try {
      headers = this._headers(options);
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
    try {
      const res = await this._fetch(`${BASE}/studio/models`, { headers });
      if (res.status === 401 || res.status === 403) return { ok: false, message: 'Invalid Genviral API key' };
      return { ok: true, message: 'Connection successful' };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

const _meta = new GenviralAdapter(undefined as unknown as SafeFetchPort);

export const genviralMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new GenviralAdapter(rt.fetch),
};
