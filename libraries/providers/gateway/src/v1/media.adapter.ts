import { createGateway, experimental_generateVideo as generateVideo } from 'ai';
import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from 'undici';
import { metadata as providerMetadata } from './metadata';
import {
  AiSdkMediaAdapter,
  MediaProviderCapabilities,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaModelOption,
  MediaOperation,
  MediaCredentialField,
  resolveApiKey,
  ProviderModule,
} from '@gitroom/provider-kernel';

// Vercel AI Gateway — image is delegated to the AI-SDK gateway provider (base class); video
// uses AI SDK v6's experimental `generateVideo` (`gateway.video(modelId)`), which is
// inherently synchronous (one long await — minutes). We extend the Undici timeout to 15 min
// per Vercel's docs and complete the job inline (no poll/webhook). Speech is not exposed by
// the gateway AI-SDK adapter, so audio is omitted here.
const GATEWAY_BASE = 'https://ai-gateway.vercel.sh/v1';

// 5.7 — the AI-SDK returns the video in memory; reject oversize BEFORE base64-inflating (~1.33×)
// so a huge render can't blow the 2 GB heap. Matches the lifecycle's MAX_ARTIFACT_BYTES.
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

// One long-lived dispatcher so a multi-minute video render isn't killed by the default 5-min
// fetch timeout. Created lazily to avoid touching undici when the gateway is never used.
//
// 6.1d — FIXED-HOST SSRF EXEMPTION: this deliberately bypasses the kernel `SafeFetchPort`
// because the 30 s SafeFetchPort timeout cannot cover a synchronous multi-minute render.
// It is sound because the destination is NOT user-controlled — the AI-SDK `createGateway` client
// always targets the fixed Vercel gateway host (GATEWAY_BASE, `ai-gateway.vercel.sh`); the only
// user inputs (`model`, the source `image`) ride as request-body params, never as the fetch URL.
// We use the imported `undiciFetch` (not the global fetch) so the call still runs through the
// same undici stack as the rest of the app and is gated by the host check below.
let _videoDispatcher: Agent | undefined;
function videoFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (!_videoDispatcher) {
    _videoDispatcher = new Agent({ headersTimeout: 15 * 60 * 1000, bodyTimeout: 15 * 60 * 1000 });
  }
  // Defence-in-depth: refuse to send this long-timeout dispatcher anywhere but the gateway host.
  const target = url instanceof Request ? url.url : String(url);
  if (!target.startsWith(GATEWAY_BASE) && !target.startsWith('https://ai-gateway.vercel.sh/')) {
    throw new Error('Gateway video dispatcher may only target the Vercel AI Gateway host');
  }
  return undiciFetch(target, { ...(init || {}), dispatcher: _videoDispatcher } as UndiciRequestInit) as unknown as Promise<Response>;
}

interface GatewayModelsResponse {
  data?: { id?: string; name?: string; type?: string; modality?: string }[];
}

export class GatewayMediaAdapter extends AiSdkMediaAdapter {
  readonly identifier = 'gateway';
  readonly name = 'Vercel AI';
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
  override readonly credentialFields: MediaCredentialField[] = [
    { key: 'apiKey', label: 'Gateway API Key', type: 'password', required: true, placeholder: 'vck_…' },
  ];

  override async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const model = options?.model;
    if (!model) throw new Error('Gateway video generation requires a model');
    const apiKey = options?.credentials?.apiKey || resolveApiKey(options);
    if (!apiKey) throw new Error('Vercel AI API key is required');

    const gw = createGateway({ apiKey, fetch: videoFetch });
    const input = options?.input || {};
    // Image-to-video: the resolved source image rides as the structured prompt.
    const image = typeof input.image === 'string' ? input.image : undefined;
    const result = await generateVideo({
      model: gw.video(model),
      prompt: image ? { image, text: prompt } : prompt,
      ...(input.seconds !== undefined ? { duration: Number(input.seconds) } : {}),
      ...(typeof input.aspect_ratio === 'string' ? { aspectRatio: input.aspect_ratio } : {}),
      ...(typeof input.resolution === 'string' ? { resolution: input.resolution } : {}),
    } as Parameters<typeof generateVideo>[0]);

    const video = result.videos?.[0];
    if (!video) throw new Error('Gateway returned no video');
    const mime = (video as { mediaType?: string }).mediaType || 'video/mp4';
    // 5.7 — check the raw byte size before base64-inflating; the SDK already materialized the
    // bytes, so guard the heap here rather than after a second in-memory copy.
    const rawBytes = video.uint8Array
      ? video.uint8Array.length
      : video.base64
        ? Math.floor((video.base64.length * 3) / 4)
        : 0;
    if (rawBytes > MAX_ARTIFACT_BYTES) throw new Error('Gateway video exceeds the size limit');
    const b64 = video.base64 || Buffer.from(video.uint8Array).toString('base64');
    return {
      jobId: `gateway-video-${b64.length}`,
      artifactUrl: `data:${mime};base64,${b64}`,
      metadata: { provider: this.identifier, model, mime, prompt },
    };
  }

  // The gateway exposes its full catalog at /v1/models with a type tag; filter by modality
  // so the dynamic dropdown lists real image/video models (the AI adapter only hardcodes a
  // few text models).
  override async listModels(operation: MediaOperation, options?: MediaCredentialOptions): Promise<MediaModelOption[]> {
    const apiKey = options?.credentials?.apiKey || resolveApiKey(options);
    if (!apiKey || !this._fetch) return [];
    try {
      const res = await this._fetch(`${GATEWAY_BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!res.ok) return [];
      const body = (await res.json()) as GatewayModelsResponse;
      const want = operation === 'image' ? 'image' : operation === 'video' ? 'video' : 'audio';
      return (body.data || [])
        .filter((m) => m.id && (m.type === want || m.modality === want || (m.type || '').includes(want)))
        .map((m) => ({ id: m.id as string, label: m.name || (m.id as string) }));
    } catch {
      return [];
    }
  }
}

const _meta = new GatewayMediaAdapter();

export const gatewayMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new GatewayMediaAdapter(rt.fetch),
};
