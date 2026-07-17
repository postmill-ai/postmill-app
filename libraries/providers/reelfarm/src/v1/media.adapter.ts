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
} from '@gitroom/provider-kernel';

// Reel.Farm official developer API (https://reel.farm/api-docs) — own-key Bearer provider
// configured at Settings → Media. Video-only: a natural-language prompt renders an AI TikTok
// slideshow video. Generation is async:
//   POST /slideshows/generate            → { slideshow_id, status }
//   GET  /slideshows/{id}/status         → { status, video_id?, video_status? }   (no mp4 URL here)
//   GET  /videos/{video_id}              → the rendered video object (carries video_url)
// There is no completion webhook → it relies on the media-jobs-poll cron (like Runway/LTX). The
// status endpoint does NOT carry the mp4 URL, so pollJob fetches /videos/{video_id} once a video
// export exists and reads `video_url`.
//
// Built source-grounded WITHOUT a live key: the slideshow `/videos/{id}` response field that
// carries the rendered mp4 (`video_url`) is documented for ugc/greenscreen videos and inferred for
// slideshows — confirm against a real key during a smoke test (the repo's standard caveat for
// own-key studios built blind, cf. LTX/Wan).
const BASE = 'https://reel.farm/api/v1';

interface ReelFarmGenerateResponse {
  slideshow_id?: number | string;
  status?: string;
  message?: string;
}

interface ReelFarmStatusResponse {
  slideshow_id?: number | string;
  status?: 'draft' | 'generating' | 'rendering' | 'completed' | 'failed';
  video_id?: string;
  video_status?: string;
}

interface ReelFarmVideoResponse {
  video_id?: string;
  video_url?: string;
  status?: string;
  finished?: boolean;
  failed?: boolean;
}

export class ReelFarmAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'reelfarm';
  readonly name = 'Reel.Farm';
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
    if (!apiKey) throw new Error('Reel.Farm API key is required');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
  }

  // Optional background images ride as a 0-indexed `images` URL array. The descriptor exposes a
  // few `image_N` media fields; the studio resolves each to a provider-reachable URL, and we
  // collect the non-empty ones in order.
  private _collectImages(input?: Record<string, MediaInputValue>): string[] {
    const images: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const v = input?.[`image_${i}`];
      if (typeof v === 'string' && v) images.push(v);
    }
    return images;
  }

  async generateImage(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    throw new Error('Reel.Farm does not support image generation');
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const headers = this._headers(options);
    if (!prompt) throw new Error('Reel.Farm requires a prompt');

    const body: Record<string, unknown> = { additional_context: prompt };
    const images = this._collectImages(options?.input);
    if (images.length) body.images = images;

    const res = await this._fetch(`${BASE}/slideshows/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Reel.Farm slideshow generation failed: ${redactError(await res.text())}`);
    const id = ((await res.json()) as ReelFarmGenerateResponse).slideshow_id;
    if (id === undefined || id === null) throw new Error('Reel.Farm returned no slideshow id');
    return { jobId: String(id) };
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Reel.Farm does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Reel.Farm does not support avatar generation');
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    if (!resolveApiKey(options)) return { status: 'failed', error: 'Reel.Farm API key is required' };
    const headers = this._headers(options);

    const statusRes = await this._fetch(`${BASE}/slideshows/${jobId}/status`, { headers });
    if (!statusRes.ok) {
      const body = await statusRes.text();
      // 3.4 — a 429/5xx status poll is transient: THROW so the still-rendering slideshow retries.
      if (isTransientStatus(statusRes.status)) {
        throw new Error(`Reel.Farm status poll transient error ${statusRes.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: redactError(body) };
    }
    const status = (await statusRes.json()) as ReelFarmStatusResponse;

    if (status.status === 'failed') {
      return { status: 'failed', error: 'Reel.Farm slideshow generation failed' };
    }
    // The mp4 only exists once a video export has been created; until then keep polling.
    if (!status.video_id) return { status: 'pending' };

    const videoRes = await this._fetch(`${BASE}/videos/${status.video_id}`, { headers });
    // The render already succeeded; a transient error must retry, not fail. A non-transient
    // error stays pending (the export may still be finalizing).
    if (!videoRes.ok) {
      if (isTransientStatus(videoRes.status)) {
        throw new Error(`Reel.Farm video fetch transient error ${videoRes.status}`);
      }
      return { status: 'pending' };
    }
    const video = (await videoRes.json()) as ReelFarmVideoResponse;

    if (video.failed) return { status: 'failed', error: 'Reel.Farm video render failed' };
    if (video.video_url) {
      return { status: 'completed', artifactUrl: video.video_url, metadata: { provider: this.identifier } };
    }
    return { status: 'pending' };
  }

  // Auth probe with no generation cost.
  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    let headers: Record<string, string>;
    try {
      headers = this._headers(options);
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
    try {
      const res = await this._fetch(`${BASE}/account`, { headers });
      if (res.status === 401 || res.status === 403) return { ok: false, message: 'Invalid Reel.Farm API key' };
      return { ok: true, message: 'Connection successful' };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

const _meta = new ReelFarmAdapter(undefined as unknown as SafeFetchPort);

export const reelfarmMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new ReelFarmAdapter(rt.fetch),
};
