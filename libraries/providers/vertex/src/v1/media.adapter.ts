import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaCredentialField,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaInputValue,
  MediaJobSubmission,
  MediaPollResult,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';
import { GoogleAuth } from 'google-auth-library';

import { metadata as providerMetadata } from './metadata';
interface VertexPredictResponse {
  predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
}

interface VertexOperationResponse {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: {
    videos?: { gcsUri?: string; bytesBase64Encoded?: string; mimeType?: string }[];
  };
}

interface VertexCredentials {
  accessToken: string;
  projectId: string;
  region: string;
}

const DEFAULT_IMAGE_MODEL = 'imagen-3.0-generate-002';
const DEFAULT_VIDEO_MODEL = 'veo-2.0-generate-001';
const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

// 2.1 — a 429/5xx on a status poll is transient: THROW so the lifecycle retries the render
// rather than permanently failing a job whose generation may still be fine.
const isTransientStatus = (s: number): boolean => s === 429 || s >= 500;

// 5.7/5.14 — the GCS object is downloaded with the minted token then base64-inflated; reject
// oversize via content-length before buffering. Matches the lifecycle's MAX_ARTIFACT_BYTES.
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

// 5.14 — turn a `gs://bucket/object` URI into the authenticated JSON-API media download URL.
// The lifecycle's safeFetch cannot fetch a gs:// scheme, so the completed render must be inlined.
function gcsMediaUrl(gcsUri: string): string {
  const rest = gcsUri.replace(/^gs:\/\//, '');
  const slash = rest.indexOf('/');
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`;
}

export class VertexMediaAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'vertex';
  readonly name = 'Google Vertex';
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

  // Vertex uses GCP credentials, not a single API key. The service-account JSON is the
  // durable credential — short-lived access tokens are minted from it per call (a raw
  // `accessToken` may still be passed for advanced use, but expires in ~1h). Field keys
  // match the AI Vertex adapter so an org configures the same three values for both.
  readonly credentialFields: MediaCredentialField[] = [
    { key: 'project', label: 'GCP Project ID', type: 'string', required: true, placeholder: 'my-gcp-project' },
    { key: 'location', label: 'GCP Location', type: 'string', required: true, placeholder: 'us-central1' },
    {
      key: 'googleCredentials',
      label: 'GCP Service Account JSON',
      type: 'textarea',
      required: true,
      placeholder: 'Paste your service account key JSON',
      help: 'A short-lived access token is minted from this key on each request.',
    },
  ];

  // Mint a short-lived OAuth token from the service-account JSON (preferred), falling back
  // to a raw access token / apiKey for advanced callers. Returns the project + region too.
  private async _credentials(options?: MediaCredentialOptions): Promise<VertexCredentials> {
    const creds = options?.credentials || {};
    const projectId = creds.project || creds.projectId;
    const region = creds.location || creds.region || 'us-central1';
    if (!projectId) {
      throw new Error('Vertex AI requires a GCP project ID');
    }

    let accessToken = creds.accessToken || options?.apiKey;
    if (!accessToken && creds.googleCredentials) {
      let parsed: object;
      try {
        parsed = JSON.parse(creds.googleCredentials);
      } catch {
        throw new Error('Vertex AI service account JSON is not valid JSON');
      }
      const auth = new GoogleAuth({ credentials: parsed, scopes: [VERTEX_SCOPE] });
      const client = await auth.getClient();
      accessToken = (await client.getAccessToken()).token || undefined;
    }
    if (!accessToken) {
      throw new Error('Vertex AI requires a service account JSON (or an access token)');
    }
    return { accessToken, projectId, region };
  }

  private _modelUrl(creds: VertexCredentials, model: string, verb: string): string {
    return (
      `https://${creds.region}-aiplatform.googleapis.com/v1/projects/${creds.projectId}` +
      `/locations/${creds.region}/publishers/google/models/${model}:${verb}`
    );
  }

  private _headers(creds: VertexCredentials): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.accessToken}`,
    };
  }

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const creds = await this._credentials(options);
    const input = (options?.input || {}) as Record<string, MediaInputValue>;
    const model = options?.model || DEFAULT_IMAGE_MODEL;
    const sampleCount = input.sampleCount !== undefined ? Number(input.sampleCount) : options?.n || 1;
    const parameters: Record<string, MediaInputValue> = { sampleCount };
    if (typeof input.aspectRatio === 'string' && input.aspectRatio) parameters.aspectRatio = input.aspectRatio;
    if (typeof input.negativePrompt === 'string' && input.negativePrompt) parameters.negativePrompt = input.negativePrompt;
    const res = await this._fetch(this._modelUrl(creds, model, 'predict'), {
      method: 'POST',
      headers: this._headers(creds),
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters,
      }),
    });
    if (!res.ok) throw new Error(`Vertex AI image generation failed: ${await res.text()}`);
    const data = (await res.json()) as VertexPredictResponse;
    const images = (data.predictions || [])
      .filter((p) => !!p.bytesBase64Encoded)
      .map((p) => `data:${p.mimeType || 'image/png'};base64,${p.bytesBase64Encoded}`);
    if (images.length === 0) throw new Error('Vertex AI returned no images');
    return {
      multi: images.length > 1,
      image: images[0],
      images,
      metadata: { provider: this.identifier, model, mime: data.predictions?.[0]?.mimeType },
    };
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const creds = await this._credentials(options);
    const input = (options?.input || {}) as Record<string, MediaInputValue>;
    const model = options?.model || DEFAULT_VIDEO_MODEL;
    const aspectRatio =
      options?.aspectRatio || (typeof input.aspectRatio === 'string' ? input.aspectRatio : undefined);
    const durationSeconds =
      options?.durationSeconds ?? (input.durationSeconds !== undefined ? Number(input.durationSeconds) : undefined);
    const sampleCount = input.sampleCount !== undefined ? Number(input.sampleCount) : undefined;
    const negativePrompt = typeof input.negativePrompt === 'string' ? input.negativePrompt : undefined;
    const res = await this._fetch(this._modelUrl(creds, model, 'predictLongRunning'), {
      method: 'POST',
      headers: this._headers(creds),
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          ...(aspectRatio ? { aspectRatio } : {}),
          ...(durationSeconds ? { durationSeconds } : {}),
          ...(sampleCount ? { sampleCount } : {}),
          ...(negativePrompt ? { negativePrompt } : {}),
        },
      }),
    });
    if (!res.ok) throw new Error(`Vertex AI video generation failed: ${await res.text()}`);
    const data = (await res.json()) as VertexOperationResponse;
    if (!data.name) throw new Error('Vertex AI returned no operation name');
    // The operation name embeds the model path needed by fetchPredictOperation.
    return { jobId: data.name };
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Vertex AI audio generation is not supported via the media adapter');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Vertex AI does not support avatar generation');
  }

  // Validate credentials without spending an image generation: minting a token exercises
  // the service-account JSON, project, and scope. (capabilities.image would otherwise make
  // the generic test path call Imagen.)
  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    try {
      await this._credentials(options);
      return { ok: true, message: 'Credentials valid (access token minted)' };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    // 2.1 — a config error (missing project / invalid service-account JSON / no credentials) is
    // TERMINAL: return failed rather than throwing, which the lifecycle would re-poll for ~24h. A
    // genuine token-mint NETWORK error stays transient (rethrow) so the lifecycle retries.
    let creds: VertexCredentials;
    try {
      creds = await this._credentials(options);
    } catch (err) {
      const message = (err as Error).message || 'Vertex AI credential error';
      // `requires`/`not valid JSON` are this adapter's own _credentials throws;
      // `invalid_grant` is google-auth's terminal signal for a revoked/expired/
      // malformed service-account key — equally a config error, not transient.
      if (/requires|not valid JSON|invalid credentials|invalid_grant/i.test(message)) {
        return { status: 'failed', error: message };
      }
      throw err;
    }
    // Operation names look like:
    // projects/{p}/locations/{r}/publishers/google/models/{model}/operations/{id}
    const modelMatch = jobId.match(/models\/([^/]+)\//);
    const model = modelMatch?.[1] || DEFAULT_VIDEO_MODEL;
    const res = await this._fetch(this._modelUrl(creds, model, 'fetchPredictOperation'), {
      method: 'POST',
      headers: this._headers(creds),
      body: JSON.stringify({ operationName: jobId }),
    });
    if (!res.ok) {
      const body = await res.text();
      if (isTransientStatus(res.status)) throw new Error(`Vertex AI poll transient error ${res.status}: ${body.slice(0, 200)}`);
      return { status: 'failed', error: body };
    }
    const data = (await res.json()) as VertexOperationResponse;

    if (!data.done) return { status: 'pending' };
    if (data.error) return { status: 'failed', error: data.error.message || 'Vertex AI operation failed' };

    const video = data.response?.videos?.[0];
    const mime = video?.mimeType || 'video/mp4';
    if (video?.bytesBase64Encoded) {
      return {
        status: 'completed',
        artifactUrl: `data:${mime};base64,${video.bytesBase64Encoded}`,
        metadata: { provider: this.identifier, model, mime },
      };
    }
    if (video?.gcsUri) {
      // 5.14 — the lifecycle's safeFetch cannot download a gs:// URL. Fetch the object with the
      // minted access token and inline it as a data URL (the Sora/Gemini pattern).
      const fileRes = await this._fetch(gcsMediaUrl(video.gcsUri), { headers: this._headers(creds) });
      // 2.2 — classify the download leg: a 429/5xx is transient (THROW to retry the paid render),
      // but a permanent 4xx (expired/deleted object) is terminal — return failed rather than
      // re-polling every sweep for 24h.
      if (!fileRes.ok) {
        if (isTransientStatus(fileRes.status)) {
          const body = await fileRes.text();
          throw new Error(`Vertex AI GCS download transient error ${fileRes.status}: ${body.slice(0, 200)}`);
        }
        return { status: 'failed', error: `Vertex AI GCS download failed (${fileRes.status})` };
      }
      const declared = Number(fileRes.headers.get('content-length') || 0);
      if (declared > MAX_ARTIFACT_BYTES) return { status: 'failed', error: 'Vertex AI video exceeds the size limit' };
      const buffer = await readCapped(fileRes, MAX_ARTIFACT_BYTES);
      if (!buffer) return { status: 'failed', error: 'Vertex AI video exceeds the size limit' };
      return {
        status: 'completed',
        artifactUrl: `data:${mime};base64,${buffer.toString('base64')}`,
        metadata: { provider: this.identifier, model, mime },
      };
    }
    return { status: 'failed', error: 'Vertex AI operation finished without video output' };
  }
}

const _meta = new VertexMediaAdapter(undefined as unknown as SafeFetchPort);

export const vertexMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new VertexMediaAdapter(rt.fetch),
};
