import { metadata as providerMetadata } from './metadata';
import {
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaPollResult,
  MediaInputValue,
  resolveApiKey,
  redactError,
  validateModelId,
  isTransientStatus,
  SafeFetchPort,
  ProviderModule,
  BearerTokenMediaAdapter,
  mediaUpstreamError,
  mediaUpstreamFailure,
  mediaUpstreamFromBody,
  mediaUpstreamFromPoll,
} from '@postmill-ai/provider-kernel';

// Kling AI direct (official API, api-singapore.klingai.com) at /media/kling-ai — separate from
// the fal-hosted Kling models in /media/fal. This package is the dedicated integration for real
// klingai.com API keys. Auth is a single Bearer API key from
// https://kling.ai/dev/api-key — the legacy AK/SK JWT scheme is rejected by the current API
// (401 / code 1002) and deliberately not implemented.
//
// The vendor runs TWO API design standards at once (docs: https://kling.ai/document-api):
// - Video (new standard, path-per-model): POST /text-to-video/<model> and
//   POST /image-to-video/<model> → `{code, message, data: {id, status}}`; both poll through
//   the unified GET /tasks?task_ids=<id> (status: submitted|processing|succeeded|failed,
//   result in data[].outputs[type=video].url, failure reason in data[].message). There is no
//   negative_prompt / cfg_scale / mode on this standard — settings are duration (int seconds),
//   aspect_ratio (t2v only), resolution (720p/1080p), audio (native|off, kling-3.0/2.6 only).
// - Image (legacy /v1 standard): POST /v1/images/generations (model_name in the body) →
//   `{code, message, data: {task_id, task_status}}`; poll GET /v1/images/generations/{id}
//   (task_status: submitted|processing|succeed|failed — note `succeed`, result in
//   data.task_result.images[].url). generateImage keeps the framework's synchronous contract
//   via bounded internal polling (Qwen pattern); video is submit + external poll.
//
// Every response is an envelope: `code !== 0` is an error even on HTTP 200, `message` says why.
// testConnection hits the FREE task-list endpoint — never a billable render.
const BASE = 'https://api-singapore.klingai.com';

const DEFAULT_VIDEO_MODEL = 'kling-3.0-turbo';
const DEFAULT_IMAGE_MODEL = 'kling-v3';

// `settings.audio` exists only on kling-3.0 / kling-2.6: kling-3.0-turbo always renders native
// audio (no field), kling-2.5-turbo has no native audio at all. Forward the user's choice only
// where the vendor documents the field.
const AUDIO_SETTING_MODELS = new Set(['kling-3.0', 'kling-2.6']);

// Vendor business codes that mean "try again later" on reads (per the vendor error table:
// system busy / concurrency / internal timeout). On a poll these must THROW so the lifecycle
// retries instead of burning the job.
const TRANSIENT_CODES = new Set([1302, 1303, 5000, 5001, 5002]);

interface KlingEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

// New-standard task record (GET /tasks?task_ids=).
interface KlingTaskRecord {
  id?: string;
  status?: string; // submitted | processing | succeeded | failed
  message?: string;
  outputs?: { type?: string; url?: string }[];
}

// Legacy-standard image task (POST/GET /v1/images/generations).
interface KlingImageTask {
  task_id?: string;
  task_status?: string; // submitted | processing | succeed | failed
  task_status_msg?: string;
  task_result?: { images?: { url?: string }[] };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Video job ids carry the task type (`t2v::<task_id>` / `i2v::<task_id>`) like fal's
// `<model>::<request_id>` namespacing — the submit endpoints differ, and the prefix documents
// which one created the task. Both poll through the unified /tasks query today.
type KlingVideoKind = 't2v' | 'i2v';

function encodeJobId(kind: KlingVideoKind, taskId: string): string {
  return `${kind}::${taskId}`;
}

// A job id without a recognized prefix is a legacy/foreign id; signalling a decode failure
// beats guessing an endpoint.
function decodeJobId(jobId: string): { kind: KlingVideoKind; taskId: string } | null {
  const idx = jobId.indexOf('::');
  if (idx === -1) return null;
  const kind = jobId.slice(0, idx);
  const taskId = jobId.slice(idx + 2);
  if ((kind !== 't2v' && kind !== 'i2v') || !taskId) return null;
  return { kind, taskId };
}

export class KlingMediaAdapter extends BearerTokenMediaAdapter {
  readonly identifier = 'kling';
  readonly name = 'Kling AI';
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
    outpaint: false,
  };

  // Throw on a non-zero envelope code (HTTP 200 can still be a business error). Transient
  // vendor codes throw a plain retryable error; the rest become an attributed upstream error.
  private _assertEnvelope<T>(envelope: KlingEnvelope<T>, status: number | undefined, operation: string): KlingEnvelope<T> {
    if (typeof envelope?.code === 'number' && envelope.code !== 0) {
      const detail = envelope.message || `code ${envelope.code}`;
      if (TRANSIENT_CODES.has(envelope.code)) {
        throw new Error(`Kling AI transient error ${envelope.code}: ${redactError(detail, 200)}`);
      }
      throw mediaUpstreamFromBody(this, status, detail, operation);
    }
    return envelope;
  }

  // settings block for the new-standard video endpoints — whitelisted per task type so
  // descriptor params the current API doesn't have (negative_prompt, cfg_scale, mode) can
  // never leak into the body.
  private _videoSettings(model: string, input: Record<string, MediaInputValue>, withAspect: boolean) {
    const settings: Record<string, MediaInputValue> = {};
    if (input.duration !== undefined && input.duration !== '') {
      const duration = Number(input.duration);
      if (Number.isFinite(duration)) settings.duration = duration;
    }
    if (withAspect && typeof input.aspect_ratio === 'string' && input.aspect_ratio) {
      settings.aspect_ratio = input.aspect_ratio;
    }
    if (typeof input.resolution === 'string' && input.resolution) {
      settings.resolution = input.resolution;
    }
    if (AUDIO_SETTING_MODELS.has(model) && (input.audio === 'native' || input.audio === 'off')) {
      settings.audio = input.audio;
    }
    return settings;
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const model = validateModelId(options?.model || DEFAULT_VIDEO_MODEL);
    const input = this._clean(options?.input);
    const image = (input.image || input.first_frame) as string | undefined;
    const imageTail = (input.image_tail || input.last_frame) as string | undefined;
    const kind: KlingVideoKind = image ? 'i2v' : 't2v';

    const body: Record<string, unknown> =
      kind === 'i2v'
        ? {
            contents: [
              { type: 'prompt', text: prompt },
              { type: 'first_frame', url: image },
              ...(imageTail ? [{ type: 'last_frame', url: imageTail }] : []),
            ],
            settings: this._videoSettings(model, input, false),
          }
        : {
            prompt,
            settings: this._videoSettings(model, input, true),
          };
    if (options?.webhookUrl) body.options = { callback_url: options.webhookUrl };

    const res = await this._fetch(`${BASE}/${kind === 'i2v' ? 'image-to-video' : 'text-to-video'}/${model}`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await mediaUpstreamError(this, res, 'video');
    const envelope = this._assertEnvelope((await res.json()) as KlingEnvelope<{ id?: string }>, res.status, 'video');
    const taskId = envelope.data?.id;
    if (!taskId) throw new Error('Kling AI returned no task id');
    return { jobId: encodeJobId(kind, taskId) };
  }

  // Image generation is a task API on the legacy /v1 standard; bounded internal polling keeps
  // the framework's synchronous generateImage contract (near-real-time or fail).
  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const model = validateModelId(options?.model || DEFAULT_IMAGE_MODEL);
    const input = this._clean(options?.input);
    // The i2i contract: a source image routes into the native reference field — never dropped.
    const image = options?.sourceUrl || (input.image as string | undefined);
    const body: Record<string, unknown> = { model_name: model, prompt };
    // The vendor rejects negative_prompt in the image-to-image scenario.
    if (!image && typeof input.negative_prompt === 'string' && input.negative_prompt) {
      body.negative_prompt = input.negative_prompt;
    }
    if (image) body.image = image;
    if (typeof input.aspect_ratio === 'string' && input.aspect_ratio) body.aspect_ratio = input.aspect_ratio;
    if (typeof input.resolution === 'string' && input.resolution) body.resolution = input.resolution;
    const n = options?.n ?? (input.n !== undefined ? Number(input.n) : undefined);
    if (n !== undefined && Number.isFinite(n)) body.n = n;

    const res = await this._fetch(`${BASE}/v1/images/generations`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await mediaUpstreamError(this, res, 'image');
    const envelope = this._assertEnvelope((await res.json()) as KlingEnvelope<KlingImageTask>, res.status, 'image');
    const taskId = envelope.data?.task_id;
    if (!taskId) throw new Error('Kling AI returned no task id');

    for (let attempt = 0; attempt < 40; attempt++) {
      await sleep(1500);
      const poll = await this._pollImageTask(taskId, options);
      if (poll.status === 'completed' && poll.artifactUrl) {
        return {
          multi: (poll.extraArtifactUrls?.length ?? 0) > 0,
          image: poll.artifactUrl,
          images: [poll.artifactUrl, ...(poll.extraArtifactUrls || [])],
          metadata: { provider: this.identifier, model },
        };
      }
      if (poll.status === 'failed') {
        throw mediaUpstreamFromPoll(this, poll.error || 'unknown error', 'image');
      }
    }
    throw new Error('Kling AI image generation timed out');
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Kling AI does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Kling AI does not support avatar generation');
  }

  // Legacy-standard image task poll — internal to generateImage, but kept to the same
  // transient-throw / terminal-failed semantics as pollJob.
  private async _pollImageTask(taskId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    const res = await this._fetch(`${BASE}/v1/images/generations/${taskId}`, {
      headers: this._headers(options),
    });
    if (!res.ok) {
      const body = await res.text();
      if (isTransientStatus(res.status)) {
        throw new Error(`Kling AI image poll transient error ${res.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: mediaUpstreamFailure(this, res.status, body, 'image') };
    }
    const envelope = (await res.json()) as KlingEnvelope<KlingImageTask>;
    if (typeof envelope.code === 'number' && envelope.code !== 0) {
      if (TRANSIENT_CODES.has(envelope.code)) {
        throw new Error(`Kling AI image poll transient error ${envelope.code}: ${redactError(envelope.message || '', 200)}`);
      }
      return { status: 'failed', error: mediaUpstreamFailure(this, undefined, envelope.message || `code ${envelope.code}`, 'image') };
    }
    const task = envelope.data;
    if (task?.task_status === 'succeed') {
      const urls = (task.task_result?.images || [])
        .map((i) => i.url)
        .filter((u): u is string => typeof u === 'string' && u.length > 0);
      if (!urls.length) return { status: 'failed', error: 'Kling AI task succeeded without output' };
      return {
        status: 'completed',
        artifactUrl: urls[0],
        extraArtifactUrls: urls.slice(1),
        metadata: { provider: this.identifier },
      };
    }
    if (task?.task_status === 'failed') {
      return {
        status: 'failed',
        error: mediaUpstreamFailure(this, undefined, task.task_status_msg || 'Kling AI image task failed', 'image'),
      };
    }
    return { status: 'pending' };
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    // Missing key is a config error → terminal failed, not a thrown error the lifecycle would
    // retry to the 24h timeout.
    if (!resolveApiKey(options)) return { status: 'failed', error: 'Kling AI API key is required' };

    const decoded = decodeJobId(jobId);
    if (!decoded) {
      return { status: 'failed', error: 'Kling AI legacy job id (no task-type namespace) cannot be polled' };
    }
    const { taskId } = decoded;

    const res = await this._fetch(`${BASE}/tasks?task_ids=${encodeURIComponent(taskId)}`, {
      headers: this._headers(options),
    });
    if (!res.ok) {
      const body = await res.text();
      if (isTransientStatus(res.status)) {
        throw new Error(`Kling AI poll transient error ${res.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: mediaUpstreamFailure(this, res.status, body, 'video') };
    }
    const envelope = (await res.json()) as KlingEnvelope<KlingTaskRecord[]>;
    if (typeof envelope.code === 'number' && envelope.code !== 0) {
      if (TRANSIENT_CODES.has(envelope.code)) {
        throw new Error(`Kling AI poll transient error ${envelope.code}: ${redactError(envelope.message || '', 200)}`);
      }
      return { status: 'failed', error: mediaUpstreamFailure(this, undefined, envelope.message || `code ${envelope.code}`, 'video') };
    }

    // The vendor answers 200 + empty data for an id it cannot see; reads may lag the create
    // by a moment, so an absent record is "keep polling", never a terminal failure.
    const task = (Array.isArray(envelope.data) ? envelope.data : []).find((t) => t.id === taskId);
    if (!task) return { status: 'pending' };

    if (task.status === 'succeeded') {
      const artifactUrl = (task.outputs || []).find((o) => o.type === 'video' && o.url)?.url;
      if (!artifactUrl) return { status: 'failed', error: 'Kling AI task succeeded without output' };
      return { status: 'completed', artifactUrl, metadata: { provider: this.identifier } };
    }
    if (task.status === 'failed') {
      return {
        status: 'failed',
        error: mediaUpstreamFailure(this, undefined, task.message || 'Kling AI video task failed', 'video'),
      };
    }
    // submitted | processing (and any status word the vendor adds later) → keep polling.
    return { status: 'pending' };
  }

  // Free auth check: the task-list endpoint bills no render. 401/403 (incl. the vendor's
  // code-1002 AK/SK rejection) means the key is wrong.
  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) return { ok: false, message: 'Kling AI API key is required' };
    try {
      const res = await this._fetch(`${BASE}/v1/images/generations?pageNum=1&pageSize=1`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const envelope = (await res.json()) as KlingEnvelope<unknown>;
        if (typeof envelope.code === 'number' && envelope.code !== 0) {
          return { ok: false, message: `Kling AI rejected the key: ${redactError(envelope.message || `code ${envelope.code}`, 200)}` };
        }
        return { ok: true, message: 'Connection successful' };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'Kling AI rejected the API key (401/403) — paste the API Key from https://kling.ai/dev/api-key' };
      }
      return { ok: false, message: `Kling AI connection failed: ${redactError(await res.text(), 200)}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

const _meta = new KlingMediaAdapter(undefined as unknown as SafeFetchPort);

export const klingMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new KlingMediaAdapter(rt.fetch),
};
