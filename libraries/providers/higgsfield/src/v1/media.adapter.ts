import { metadata as providerMetadata } from './metadata';
import {
  BearerTokenMediaAdapter,
  pollMediaJob,
  MediaProviderCapabilities,
  MediaCredentialField,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaPollResult,
  redactError,
  isTransientStatus,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// Higgsfield (platform.higgsfield.ai) — own-key media provider. Auth is a TWO-part credential
// (`KEY_ID` + `KEY_SECRET`) sent as a single header `Authorization: Key <id>:<secret>` (see the
// official higgsfield-js V2 client). Every generation is submit-and-poll: POST the input fields
// directly to the model endpoint → `{ request_id, status }`, then poll `GET /requests/{id}/status`
// until `completed` (or `nsfw`/`failed`); the result is `images[].url` (image) or `video.url`
// (video). There is no completion webhook wired here → video relies on the media-jobs-poll cron
// (like Runway/Wan); image keeps the synchronous contract (§11.2) via bounded internal polling.
//
// Three model surfaces, routed by operation + model:
//   image  → Soul text-to-image      POST /v1/text2image/soul
//   video  → DoP image-to-video      POST /v1/image2video/dop   (model = dop-lite|dop-turbo|dop-standard)
//   video  → Speak audio→talk-video  POST /v1/speak/higgsfield  (model = 'speak', routing marker only)
const BASE = 'https://platform.higgsfield.ai';

// 2.1 — a 429/5xx on a status poll is transient: THROW (via the shared `isTransientStatus`) so the
// lifecycle retries the render rather than permanently failing a job whose generation may still be fine.
const SOUL_ENDPOINT = '/v1/text2image/soul';
const DOP_ENDPOINT = '/v1/image2video/dop';
const SPEAK_ENDPOINT = '/v1/speak/higgsfield';

interface HiggsfieldResponse {
  status?: 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw';
  request_id?: string;
  images?: { url?: string }[];
  video?: { url?: string };
  detail?: unknown;
}

export class HiggsfieldAdapter extends BearerTokenMediaAdapter {
  readonly identifier = 'higgsfield';
  readonly name = 'Higgsfield';
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

  // Two-part key — the V2 client expects `Authorization: Key KEY_ID:KEY_SECRET`. A combined
  // "id:secret" pasted into a single field is also accepted (apiKey fallback).
  readonly credentialFields: MediaCredentialField[] = [
    { key: 'keyId', label: 'API Key ID', type: 'string', required: true, placeholder: 'Higgsfield key id' },
    { key: 'keySecret', label: 'API Key Secret', type: 'password', required: true, placeholder: 'Higgsfield key secret' },
  ];

  // Override the base's bearer header with Higgsfield's two-part Key scheme.
  protected _headers(options?: MediaCredentialOptions): Record<string, string> {
    const creds = options?.credentials || {};
    let id = creds.keyId;
    let secret = creds.keySecret;
    // Fallback: a single "KEY_ID:KEY_SECRET" string in apiKey/key. 5.12 — split on the FIRST
    // colon only, so a secret that itself contains ':' is not truncated.
    const combined = options?.apiKey || creds.apiKey || creds.key;
    if ((!id || !secret) && combined && combined.includes(':')) {
      const idx = combined.indexOf(':');
      id = combined.slice(0, idx);
      secret = combined.slice(idx + 1);
    }
    if (!id || !secret) throw new Error('Higgsfield requires both an API Key ID and Key Secret');
    return {
      'Content-Type': 'application/json',
      Authorization: `Key ${id}:${secret}`,
    };
  }

  private async _submit(endpoint: string, body: Record<string, unknown>, options?: MediaCredentialOptions): Promise<string> {
    const res = await this._fetch(`${BASE}${endpoint}`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Higgsfield request failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as HiggsfieldResponse;
    if (!data.request_id) throw new Error('Higgsfield returned no request id');
    return data.request_id;
  }

  // Soul text-to-image (submit-and-poll). A reference image (image-to-image) rides the native
  // `image_reference` object; everything else passes straight through.
  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    this._headers(options); // validate credentials before any work
    const { image_url, ...rest } = this._clean(options?.input);
    const body: Record<string, unknown> = { prompt, ...rest };
    if (typeof image_url === 'string' && image_url) {
      body.image_reference = { type: 'image_url', image_url };
    }
    const requestId = await this._submit(SOUL_ENDPOINT, body, options);

    const urls = await pollMediaJob<string[]>({
      fetch: this._fetch,
      url: `${BASE}/requests/${requestId}/status`,
      headers: this._headers(options),
      attempts: 60,
      intervalMs: 2000,
      parse: (raw) => {
        const data = raw as HiggsfieldResponse;
        if (data.status === 'completed') {
          const imgs = (data.images || []).map((i) => i.url).filter((u): u is string => !!u);
          const artifactUrl = data.video?.url || imgs[0];
          if (!artifactUrl) return { status: 'failed', error: 'Higgsfield completed without output' };
          return { status: 'completed', result: imgs.length ? imgs : [artifactUrl] };
        }
        if (data.status === 'failed' || data.status === 'nsfw') {
          return { status: 'failed', error: data.status === 'nsfw' ? 'Blocked by NSFW filter' : 'Higgsfield generation failed' };
        }
        return { status: 'pending' };
      },
    });
    return {
      multi: urls.length > 1,
      image: urls[0],
      images: urls,
      metadata: { provider: this.identifier, model: 'soul', prompt },
    };
  }

  // Video: DoP image-to-video, or Speak (audio-driven talking video) when model === 'speak'.
  // The media-field URLs (resolved server-side) ride the native nested input objects.
  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    this._headers(options); // validate credentials before any work
    const model = options?.model || 'dop-standard';
    const { image_url, audio_url, ...rest } = this._clean(options?.input);

    let endpoint: string;
    let body: Record<string, unknown>;
    if (model === 'speak') {
      if (typeof image_url !== 'string' || !image_url) throw new Error('Higgsfield Speak requires a source image');
      if (typeof audio_url !== 'string' || !audio_url) throw new Error('Higgsfield Speak requires an audio file');
      endpoint = SPEAK_ENDPOINT;
      body = {
        prompt,
        input_image: { type: 'image_url', image_url },
        input_audio: { type: 'audio_url', audio_url },
        ...rest,
      };
    } else {
      if (typeof image_url !== 'string' || !image_url) throw new Error('Higgsfield DoP requires a source image');
      endpoint = DOP_ENDPOINT;
      body = {
        model,
        prompt,
        input_images: [{ type: 'image_url', image_url }],
        ...rest,
      };
    }

    const requestId = await this._submit(endpoint, body, options);
    return { jobId: requestId };
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Higgsfield does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Higgsfield does not support avatar generation');
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    // Missing/invalid credentials are a config error → terminal failed (matches openai/Sora),
    // not a thrown error the lifecycle would retry to the 24h timeout.
    let headers: Record<string, string>;
    try {
      headers = this._headers(options);
    } catch (err) {
      return { status: 'failed', error: (err as Error).message };
    }
    const res = await this._fetch(`${BASE}/requests/${jobId}/status`, { headers });
    if (!res.ok) {
      const body = await res.text();
      if (isTransientStatus(res.status)) throw new Error(`Higgsfield poll transient error ${res.status}: ${redactError(body, 200)}`);
      return { status: 'failed', error: redactError(body) };
    }
    const data = (await res.json()) as HiggsfieldResponse;

    if (data.status === 'completed') {
      const images = (data.images || []).map((i) => i.url).filter((u): u is string => !!u);
      const artifactUrl = data.video?.url || images[0];
      if (!artifactUrl) return { status: 'failed', error: 'Higgsfield completed without output' };
      // 6.1h — Soul returns a batch (batch_size: 4). Surface the extra takes via the generic
      // `extraArtifactUrls` (Suno pattern) so the lifecycle lands each as its own File, rather
      // than the old dead JSON stash in `metadata.source` that nothing consumed.
      const extras = data.video?.url ? [] : images.slice(1);
      return {
        status: 'completed',
        artifactUrl,
        ...(extras.length ? { extraArtifactUrls: extras } : {}),
        metadata: { provider: this.identifier },
      };
    }
    if (data.status === 'failed' || data.status === 'nsfw') {
      return { status: 'failed', error: data.status === 'nsfw' ? 'Blocked by NSFW filter' : 'Higgsfield generation failed' };
    }
    return { status: 'pending' };
  }

  // Auth probe with no generation cost: a status GET on a non-existent request returns 401 on bad
  // credentials, but a 404/422 (request not found) on valid credentials.
  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    let headers: Record<string, string>;
    try {
      headers = this._headers(options);
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
    try {
      const res = await this._fetch(`${BASE}/requests/00000000-0000-0000-0000-000000000000/status`, { headers });
      // 5.6 — 401/403 (a wrong keySecret returns 403) is an auth failure; only an expected
      // status (2xx / 404 / 422 for the fake request id) counts as connected. A 5xx / other
      // unexpected status must NOT be reported as success.
      if (res.status === 401 || res.status === 403) return { ok: false, message: 'Invalid Higgsfield API credentials' };
      if (res.ok || res.status === 404 || res.status === 422) return { ok: true, message: 'Connection successful' };
      return { ok: false, message: `Higgsfield returned ${res.status}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

const _meta = new HiggsfieldAdapter(undefined as unknown as SafeFetchPort);

export const higgsfieldMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new HiggsfieldAdapter(rt.fetch),
};
