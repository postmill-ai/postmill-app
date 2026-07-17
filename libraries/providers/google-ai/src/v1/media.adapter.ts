import { metadata as providerMetadata } from './metadata';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaInputValue,
  MediaJobSubmission,
  MediaPollResult,
  resolveApiKey,
  redactError,
  validateModelId,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// Google AI Studio — the Gemini Developer API (generativelanguage.googleapis.com), keyed by a
// single Gemini API key (AIza…). This is the SAME key the org configures under Settings → AI →
// "Google Gemini", so the media settings service treats `google` as a universal-credential
// provider (UNIVERSAL_AI_CREDENTIAL) and reads the AI key when no dedicated media credential
// exists — configure once, works for both surfaces. Distinct from `vertex` (enterprise GCP,
// service-account auth).
//
// Image is synchronous: "Nano Banana" (gemini-2.5-flash-image via :generateContent → inline
// base64) and Imagen (:predict → predictions[].bytesBase64Encoded) — routed by the model id.
// Video is Veo (:predictLongRunning → operation name, polled to completion). Veo's finished MP4
// is auth-only bytes at the returned file URI, so pollJob downloads it WITH the key and returns
// a data: URL — the lifecycle decodes it (the default unauthenticated re-download would 401).
// No completion webhook → video relies on the media-jobs-poll cron (like Runway/Veo on Vertex).
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';
const DEFAULT_VIDEO_MODEL = 'veo-3.0-generate-001';

// 2.1 — a 429/5xx on a status poll is transient: THROW so the lifecycle retries the render
// rather than permanently failing a job whose generation may still be fine.
const isTransientStatus = (s: number): boolean => s === 429 || s >= 500;

// 5.7 — the auth-only MP4 is buffered then base64-inflated; reject via content-length BEFORE
// buffering. Matches the lifecycle's MAX_ARTIFACT_BYTES.
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

// 2.3 — stream the body with a running byte counter, aborting once it passes the cap, so a
// chunked / no-content-length body can't be fully buffered into the heap before the size check.
// Returns null when the cap is exceeded (the caller maps that to a terminal failure).
async function readCapped(res: Response, cap: number): Promise<Buffer | null> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > cap ? null : buf;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks);
}

interface PredictResponse {
  predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
}

interface GenerateContentResponse {
  candidates?: {
    content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
  }[];
}

interface VeoOperation {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: { video?: { uri?: string; bytesBase64Encoded?: string; mimeType?: string } }[];
    };
  };
}

export class GoogleAiMediaAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'google';
  readonly name = 'Google AI Studio';
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

  private _key(options?: MediaCredentialOptions): string {
    const key = resolveApiKey(options);
    if (!key) throw new Error('Google AI Studio requires a Gemini API key');
    return key;
  }

  private _headers(key: string): Record<string, string> {
    return { 'Content-Type': 'application/json', 'x-goog-api-key': key };
  }

  // Drop undefined / empty values so native params only ride when set.
  private _clean(input: Record<string, MediaInputValue>): Record<string, MediaInputValue> {
    const out: Record<string, MediaInputValue> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined || v === '') continue;
      out[k] = v;
    }
    return out;
  }

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const key = this._key(options);
    const model = validateModelId(options?.model || DEFAULT_IMAGE_MODEL);
    const input = this._clean((options?.input || {}) as Record<string, MediaInputValue>);

    // Imagen uses the predict endpoint; Gemini-native image models (Nano Banana) use
    // generateContent and return the image inline on the candidate parts.
    if (model.startsWith('imagen')) {
      const parameters: Record<string, MediaInputValue> = {
        sampleCount: input.sampleCount !== undefined ? Number(input.sampleCount) : options?.n || 1,
      };
      if (typeof input.aspectRatio === 'string') parameters.aspectRatio = input.aspectRatio;
      if (typeof input.personGeneration === 'string') parameters.personGeneration = input.personGeneration;
      const res = await this._fetch(`${BASE}/models/${model}:predict`, {
        method: 'POST',
        headers: this._headers(key),
        body: JSON.stringify({ instances: [{ prompt }], parameters }),
      });
      if (!res.ok) throw new Error(`Google AI Studio image generation failed: ${redactError(await res.text())}`);
      const data = (await res.json()) as PredictResponse;
      const images = (data.predictions || [])
        .filter((p) => !!p.bytesBase64Encoded)
        .map((p) => `data:${p.mimeType || 'image/png'};base64,${p.bytesBase64Encoded}`);
      if (images.length === 0) throw new Error('Google AI Studio returned no images');
      return {
        multi: images.length > 1,
        image: images[0],
        images,
        metadata: { provider: this.identifier, model, mime: data.predictions?.[0]?.mimeType },
      };
    }

    const generationConfig: Record<string, MediaInputValue | object> = { responseModalities: ['IMAGE'] };
    if (typeof input.aspectRatio === 'string') generationConfig.imageConfig = { aspectRatio: input.aspectRatio };
    const res = await this._fetch(`${BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: this._headers(key),
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
    });
    if (!res.ok) throw new Error(`Google AI Studio image generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as GenerateContentResponse;
    const parts = data.candidates?.[0]?.content?.parts || [];
    const images = parts
      .filter((p) => !!p.inlineData?.data)
      .map((p) => `data:${p.inlineData?.mimeType || 'image/png'};base64,${p.inlineData?.data}`);
    if (images.length === 0) throw new Error('Google AI Studio returned no images');
    return {
      multi: images.length > 1,
      image: images[0],
      images,
      metadata: { provider: this.identifier, model, mime: parts[0]?.inlineData?.mimeType },
    };
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const key = this._key(options);
    const model = validateModelId(options?.model || DEFAULT_VIDEO_MODEL);
    const input = this._clean((options?.input || {}) as Record<string, MediaInputValue>);
    const parameters: Record<string, MediaInputValue> = {};
    const aspectRatio = options?.aspectRatio || input.aspectRatio;
    if (typeof aspectRatio === 'string') parameters.aspectRatio = aspectRatio;
    if (typeof input.resolution === 'string') parameters.resolution = input.resolution;
    if (typeof input.negativePrompt === 'string') parameters.negativePrompt = input.negativePrompt;
    const durationSeconds = options?.durationSeconds ?? input.durationSeconds;
    if (durationSeconds !== undefined) parameters.durationSeconds = Number(durationSeconds);

    const res = await this._fetch(`${BASE}/models/${model}:predictLongRunning`, {
      method: 'POST',
      headers: this._headers(key),
      body: JSON.stringify({ instances: [{ prompt }], parameters }),
    });
    if (!res.ok) throw new Error(`Google AI Studio video generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as VeoOperation;
    if (!data.name) throw new Error('Google AI Studio returned no operation name');
    // The operation name is a full resource path (models/{model}/operations/{id}) polled at
    // GET /v1beta/{name} — self-contained, no namespacing needed.
    return { jobId: data.name };
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Google AI Studio audio generation is not supported via the media adapter');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Google AI Studio does not support avatar generation');
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    // Missing key is a config error → terminal failed (matches openai/Sora), not a thrown
    // error the lifecycle would retry to the 24h timeout.
    const key = resolveApiKey(options);
    if (!key) return { status: 'failed', error: 'Google AI Studio requires a Gemini API key' };
    const headers = this._headers(key);
    const res = await this._fetch(`${BASE}/${jobId}`, { headers });
    if (!res.ok) {
      const body = await res.text();
      if (isTransientStatus(res.status)) throw new Error(`Veo poll transient error ${res.status}: ${body.slice(0, 200)}`);
      return { status: 'failed', error: body };
    }
    const data = (await res.json()) as VeoOperation;

    if (!data.done) return { status: 'pending' };
    if (data.error) return { status: 'failed', error: data.error.message || 'Veo generation failed' };

    const video = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video;
    const mime = video?.mimeType || 'video/mp4';
    if (video?.bytesBase64Encoded) {
      return {
        status: 'completed',
        artifactUrl: `data:${mime};base64,${video.bytesBase64Encoded}`,
        metadata: { provider: this.identifier, mime },
      };
    }
    if (video?.uri) {
      // The file URI is auth-only — download with the key and inline it as a data URL so the
      // lifecycle's unauthenticated re-download doesn't 401 (the Sora pattern).
      const fileRes = await this._fetch(video.uri, { headers });
      // 2.2 — classify the download leg: a 429/5xx is transient (THROW to retry the paid render),
      // but a permanent 4xx (expired/deleted file) is terminal — return failed rather than
      // re-polling every sweep for 24h.
      if (!fileRes.ok) {
        if (isTransientStatus(fileRes.status)) {
          const body = await fileRes.text();
          throw new Error(`Veo video download transient error ${fileRes.status}: ${body.slice(0, 200)}`);
        }
        return { status: 'failed', error: `Veo video download failed (${fileRes.status})` };
      }
      // 5.7 — reject oversize via content-length before buffering + base64-inflating.
      const declared = Number(fileRes.headers.get('content-length') || 0);
      if (declared > MAX_ARTIFACT_BYTES) return { status: 'failed', error: 'Veo video exceeds the size limit' };
      const buffer = await readCapped(fileRes, MAX_ARTIFACT_BYTES);
      if (!buffer) return { status: 'failed', error: 'Veo video exceeds the size limit' };
      const base64 = buffer.toString('base64');
      return {
        status: 'completed',
        artifactUrl: `data:${mime};base64,${base64}`,
        metadata: { provider: this.identifier, mime },
      };
    }
    return { status: 'failed', error: 'Veo operation finished without video output' };
  }

  // Validate the key cheaply by listing models rather than spending a generation.
  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    const key = resolveApiKey(options);
    if (!key) return { ok: false, message: 'Google AI Studio requires a Gemini API key' };
    try {
      const res = await this._fetch(`${BASE}/models`, { headers: this._headers(key) });
      if (!res.ok) return { ok: false, message: `Connection failed: ${res.status}` };
      return { ok: true, message: 'Connection successful' };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

const _meta = new GoogleAiMediaAdapter(undefined as unknown as SafeFetchPort);

export const googleaiMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new GoogleAiMediaAdapter(rt.fetch),
};
