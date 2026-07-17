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
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// Alibaba DashScope (Model Studio) — same host + API key as the Qwen LLM provider
// (`ai.module.ts`), so an org configures Qwen once and it works for both surfaces (the
// media settings service reads the AI Qwen key when no dedicated media credential
// exists). Image (Qwen-Image) and video (Wan2.x) are both async task APIs: POST with
// `X-DashScope-Async: enable` returns a `task_id`, then poll GET /tasks/{id}. There is no
// completion webhook → video relies on the media-jobs-poll cron (like Runway/Veo); image
// keeps the synchronous contract (§11.2) via bounded internal polling (like BFL/Runway).
const BASE = 'https://dashscope.aliyuncs.com/api/v1';

// DashScope splits a request into `input` (prompt + source refs) and `parameters`
// (everything else). The studio descriptor is flat, so route these names into `input`;
// all other native params ride into `parameters`.
const INPUT_KEYS = new Set(['negative_prompt', 'img_url']);

// 2.1 — a 429/5xx on a status poll is transient: THROW so the lifecycle retries the render
// rather than permanently failing a job whose generation may still be fine.
const isTransientStatus = (s: number): boolean => s === 429 || s >= 500;

interface DashScopeTaskCreate {
  output?: { task_id?: string; task_status?: string };
}

interface DashScopeTaskStatus {
  output?: {
    task_status?: string;
    video_url?: string;
    results?: { url?: string }[];
    message?: string;
    code?: string;
  };
  message?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class QwenMediaAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'qwen';
  readonly name = 'Qwen';
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

  private _headers(options?: MediaCredentialOptions, async = false): Record<string, string> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('Qwen (DashScope) API key is required');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    // Mandatory on task creation; omitting it returns "does not support synchronous calls".
    if (async) headers['X-DashScope-Async'] = 'enable';
    return headers;
  }

  // Split the flat descriptor params into DashScope's { model, input, parameters } shape.
  private _body(model: string, prompt: string, raw: Record<string, MediaInputValue>) {
    const input: Record<string, MediaInputValue> = { prompt };
    const parameters: Record<string, MediaInputValue> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === undefined || value === '') continue;
      if (INPUT_KEYS.has(key)) input[key] = value;
      else parameters[key] = value;
    }
    return { model, input, parameters };
  }

  // Qwen-Image is task-based; bounded internal polling keeps the synchronous image
  // contract (§11.2) — near-real-time or fail.
  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const model = options?.model || 'qwen-image-plus';
    const res = await this._fetch(`${BASE}/services/aigc/text2image/image-synthesis`, {
      method: 'POST',
      headers: this._headers(options, true),
      body: JSON.stringify(this._body(model, prompt, options?.input || {})),
    });
    if (!res.ok) throw new Error(`Qwen image generation failed: ${await res.text()}`);
    const taskId = ((await res.json()) as DashScopeTaskCreate).output?.task_id;
    if (!taskId) throw new Error('Qwen returned no task id');

    for (let attempt = 0; attempt < 40; attempt++) {
      await sleep(1500);
      const poll = await this.pollJob(taskId, options);
      if (poll.status === 'completed' && poll.artifactUrl) {
        return {
          multi: false,
          image: poll.artifactUrl,
          images: [poll.artifactUrl],
          metadata: { provider: this.identifier, model },
        };
      }
      if (poll.status === 'failed') {
        throw new Error(`Qwen image generation failed: ${poll.error || 'unknown error'}`);
      }
    }
    throw new Error('Qwen image generation timed out');
  }

  // Wan2.x text-to-video and image-to-video share one endpoint — the model id and the
  // presence of `input.img_url` (resolved server-side from the studio media picker)
  // select the mode. No webhook → completion comes from pollJob via the poll cron.
  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const model = options?.model || 'wan2.2-t2v-plus';
    const res = await this._fetch(`${BASE}/services/aigc/video-generation/video-synthesis`, {
      method: 'POST',
      headers: this._headers(options, true),
      body: JSON.stringify(this._body(model, prompt, options?.input || {})),
    });
    if (!res.ok) throw new Error(`Qwen video generation failed: ${await res.text()}`);
    const taskId = ((await res.json()) as DashScopeTaskCreate).output?.task_id;
    if (!taskId) throw new Error('Qwen returned no task id');
    return { jobId: taskId };
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Qwen does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Qwen does not support avatar generation');
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    // Missing key is a config error → terminal failed (matches openai/Sora), not a thrown
    // error the lifecycle would retry to the 24h timeout.
    if (!resolveApiKey(options)) return { status: 'failed', error: 'Qwen (DashScope) API key is required' };
    const res = await this._fetch(`${BASE}/tasks/${jobId}`, { headers: this._headers(options) });
    if (!res.ok) {
      const body = await res.text();
      if (isTransientStatus(res.status)) throw new Error(`Qwen poll transient error ${res.status}: ${body.slice(0, 200)}`);
      return { status: 'failed', error: body };
    }
    const data = (await res.json()) as DashScopeTaskStatus;
    const status = data.output?.task_status;

    if (status === 'SUCCEEDED') {
      // Video → output.video_url; image → output.results[0].url.
      const artifactUrl = data.output?.video_url || data.output?.results?.[0]?.url;
      if (!artifactUrl) return { status: 'failed', error: 'Qwen task succeeded without output' };
      return { status: 'completed', artifactUrl, metadata: { provider: this.identifier } };
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      return { status: 'failed', error: data.output?.message || data.message || 'Qwen task failed' };
    }
    return { status: 'pending' };
  }

  // Cheap auth check (no generation cost) via the OpenAI-compatible models list on the
  // same DashScope key — the studio's generateImage fallback would otherwise bill a render.
  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) return { ok: false, message: 'Qwen (DashScope) API key is required' };
    try {
      const res = await this._fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) return { ok: true, message: 'Connection successful' };
      return { ok: false, message: `Qwen connection failed: ${await res.text()}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

const _meta = new QwenMediaAdapter(undefined as unknown as SafeFetchPort);

export const qwenMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new QwenMediaAdapter(rt.fetch),
};
