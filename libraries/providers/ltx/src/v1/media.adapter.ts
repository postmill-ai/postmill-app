import { metadata as providerMetadata } from './metadata';
import {
  BearerTokenMediaAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaPollResult,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// LTX Studio (Lightricks) official developer API — own-key Bearer provider configured at
// Settings → Media. Video-only: text-to-video, image-to-video, and audio-to-video, all on the LTX-2 /
// LTX-2.3 model family. Every generation is async: POST /v2/<op> returns `{ id }`, then poll
// GET /v2/<op>/{id} until `status: completed`, reading the output from `result.video_url`.
//
// The poll path mirrors the submit path, so the operation must travel with the job id — we namespace
// the returned jobId as `<op>:<id>` (the HeyGen pattern) and pollJob splits it back out. There is no
// completion webhook → video relies on the media-jobs-poll cron (like Runway/Wan).
const BASE = 'https://api.ltx.video';

// 2.1 — a 429/5xx on a status poll is transient: THROW so the lifecycle retries the render
// rather than permanently failing a job whose generation may still be fine.
const isTransientStatus = (s: number): boolean => s === 429 || s >= 500;

// 5.11 — the poll id is namespaced `<op>:<id>`; an unrecognized prefix must be treated as a
// BARE text-to-video id (never silently routed with the prefix stripped).
const LTX_OPS = new Set<LtxOp>(['text-to-video', 'image-to-video', 'audio-to-video']);

// Sub-operation → async submit/poll path segment. Routed by the media inputs present in the request
// (the studio descriptor's media-field names are LTX's native params): an audio source → audio-to-video,
// an image source → image-to-video, otherwise text-to-video.
type LtxOp = 'text-to-video' | 'image-to-video' | 'audio-to-video';

interface LtxSubmitResponse {
  id?: string;
  created_at?: string;
  detail?: unknown;
}

interface LtxStatusResponse {
  status?: 'queued' | 'pending' | 'processing' | 'running' | 'completed' | 'failed' | 'error' | 'canceled';
  result?: { video_url?: string };
  error?: string;
  detail?: unknown;
}

export class LtxAdapter extends BearerTokenMediaAdapter {
  readonly identifier = 'ltx';
  readonly name = 'LTX Studio';
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

  async generateImage(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    throw new Error('LTX Studio does not support image generation');
  }

  // Text/image/audio → video. The endpoint is chosen by the media inputs present; the model id and
  // every other native param (resolution, duration, fps, generate_audio, camera_motion, last_frame_uri)
  // ride straight into the body. Returns the LTX job id namespaced with its operation for pollJob.
  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const headers = this._headers(options);
    const model = options?.model || 'ltx-2-3-pro';
    const cleaned = this._clean(options?.input);

    let op: LtxOp;
    if (cleaned.audio_uri) op = 'audio-to-video';
    else if (cleaned.image_uri) op = 'image-to-video';
    else op = 'text-to-video';

    const body: Record<string, unknown> = { model, ...cleaned };
    if (prompt) body.prompt = prompt;

    const res = await this._fetch(`${BASE}/v2/${op}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`LTX Studio video generation failed: ${await res.text()}`);
    const id = ((await res.json()) as LtxSubmitResponse).id;
    if (!id) throw new Error('LTX Studio returned no job id');
    return { jobId: `${op}:${id}` };
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('LTX Studio does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('LTX Studio does not support avatar generation');
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    // Missing key is a config error → terminal failed (matches openai/Sora), not a thrown
    // error the lifecycle would retry to the 24h timeout.
    let headers: Record<string, string>;
    try {
      headers = this._headers(options);
    } catch (err) {
      return { status: 'failed', error: (err as Error).message };
    }

    // jobId is `<op>:<id>`; an unrecognized (or absent) prefix is treated as a bare
    // text-to-video id — never routed with the prefix silently stripped.
    const sep = jobId.indexOf(':');
    const prefix = sep > 0 ? jobId.slice(0, sep) : '';
    const known = LTX_OPS.has(prefix as LtxOp);
    const op = known ? prefix : 'text-to-video';
    const id = known ? jobId.slice(sep + 1) : jobId;

    const res = await this._fetch(`${BASE}/v2/${op}/${id}`, { headers });
    if (!res.ok) {
      const body = await res.text();
      if (isTransientStatus(res.status)) throw new Error(`LTX Studio poll transient error ${res.status}: ${body.slice(0, 200)}`);
      return { status: 'failed', error: body };
    }
    const data = (await res.json()) as LtxStatusResponse;

    if (data.status === 'completed') {
      const artifactUrl = data.result?.video_url;
      if (!artifactUrl) return { status: 'failed', error: 'LTX Studio completed without output' };
      return { status: 'completed', artifactUrl, metadata: { provider: this.identifier } };
    }
    if (data.status === 'failed' || data.status === 'error' || data.status === 'canceled') {
      return { status: 'failed', error: data.error || 'LTX Studio generation failed' };
    }
    return { status: 'pending' };
  }

  // Auth probe with no generation cost: a status GET on a non-existent job returns 401 on bad
  // credentials, but a 404 (job not found) on valid credentials.
  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    let headers: Record<string, string>;
    try {
      headers = this._headers(options);
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
    try {
      const res = await this._fetch(`${BASE}/v2/text-to-video/00000000-0000-0000-0000-000000000000`, { headers });
      if (res.status === 401 || res.status === 403) return { ok: false, message: 'Invalid LTX Studio API key' };
      // 5.6 — only an expected status (2xx, or the not-found/unprocessable a valid key produces
      // for a fake job id) counts as connected; a 5xx/unexpected status is NOT success.
      if (res.ok || res.status === 404 || res.status === 422) return { ok: true, message: 'Connection successful' };
      return { ok: false, message: `LTX Studio returned ${res.status}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

const _meta = new LtxAdapter(undefined as unknown as SafeFetchPort);

export const ltxMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new LtxAdapter(rt.fetch),
};
