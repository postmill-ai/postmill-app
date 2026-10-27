import { metadata as providerMetadata } from './metadata';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaPollResult,
  OutpaintMode,
  resolveApiKey,
  redactError,
  isTransientStatus,
  validateModelId,
  SafeFetchPort,
  LoggerPort,
  ProviderModule,
  mediaUpstreamError,
  mediaUpstreamFailure,
  mediaUpstreamFromBody,
} from '@postmill-ai/provider-kernel';

const BASE = 'https://api.replicate.com/v1';

// `Prefer: wait` must stay ≤ the outbound `safeFetch` budget (30 s) — a longer wait is killed
// client-side while the prediction keeps running (and billing). We ask for a short blocking
// window and fall back to polling the returned prediction id (2.4).
const PREFER_WAIT_SECONDS = 25;
// flux-schnell was retired upstream ("No adapter found" 500s in prod); flux-1.1-pro is
// allowlisted, cost-tabled, and verified live.
const DEFAULT_IMAGE_MODEL = 'black-forest-labs/flux-1.1-pro';
// cjwbw/rembg was deleted upstream (every call 404'd in prod). 851-labs/background-remover
// is allowlisted, takes the same `{ image }` input, and returns a single image URL.
const DEFAULT_BG_REMOVE_MODEL = '851-labs/background-remover';
const DEFAULT_UPSCALE_MODEL = 'nightmareai/real-esrgan';
const DEFAULT_INPAINT_MODEL = 'stability-ai/stable-diffusion-inpainting';
// flux-fill-pro carries the dedicated `outpaint` input (zoom-out / make-square /
// directional) — declared in this package's metadata under `image-outpaint`.
const DEFAULT_OUTPAINT_MODEL = 'black-forest-labs/flux-fill-pro';
// flux-fill-pro marks `prompt` REQUIRED (live 422 "input: prompt is required" when
// omitted — it sits outside the tunables `fields` list in metadata.ts because the
// snapshot filters prompt-type fields out). Outpainting is often prompt-less, so
// fall back to a neutral seamless-extension instruction.
const DEFAULT_OUTPAINT_PROMPT =
  'Extend the image naturally beyond its borders, seamlessly matching the existing style, lighting, colors, and content.';

// Canonical OutpaintMode → flux-fill-pro `outpaint` select token.
const OUTPAINT_TOKENS: Record<OutpaintMode, string> = {
  'zoom-1.5x': 'Zoom out 1.5x',
  'zoom-2x': 'Zoom out 2x',
  'make-square': 'Make square',
  left: 'Left outpaint',
  right: 'Right outpaint',
  top: 'Top outpaint',
  bottom: 'Bottom outpaint',
};

type ReplicateOutput = string | string[] | Record<string, unknown> | undefined;

interface ReplicatePredictionResponse {
  id?: string;
  status?: string;
  output?: ReplicateOutput;
  error?: string;
}

// Outputs are usually a URL string or string[], but some models return an
// OBJECT of named artifacts (riffusion: `{ audio, spectrogram }` — prod job
// cmvfsa458000jsynvm3hc2380 failed "succeeded without output" on exactly that
// shape). Object preference: exact `audio`/`video`/`image` key → any key
// matching /audio|video|image|url|output|file/i → first non-empty string
// value. One level deep; string/string[] behavior is unchanged.
function firstOutputUrl(output: ReplicateOutput): string | undefined {
  if (Array.isArray(output)) return output.find((u) => typeof u === 'string');
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object') {
    const entries = Object.entries(output).filter(
      (e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0
    );
    for (const key of ['audio', 'video', 'image']) {
      const hit = entries.find(([k]) => k === key);
      if (hit) return hit[1];
    }
    const fuzzy = entries.find(([k]) => /audio|video|image|url|output|file/i.test(k));
    if (fuzzy) return fuzzy[1];
    return entries[0]?.[1];
  }
  return undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A Replicate model reference is either a version HASH (64-hex, no slash) → `/predictions`
// with a `version` field, or an `owner/name` SLUG → `/models/{slug}/predictions` (2.5). A slug
// passed as `version` is rejected with a 422, so route it to the models endpoint instead.
function isVersionHash(model: string): boolean {
  return !model.includes('/');
}

const VIDEO_DURATION_CHOICES: Record<string, number[]> = {
  'google/veo-3.1': [4, 6, 8],
  'bytedance/seedance-1-pro': [5, 10],
  'kwaivgi/kling-v2.5-turbo-pro': [5, 10],
};

function hasInputValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function validateVideoInput(modelId: string, input: Record<string, unknown>): void {
  const duration = input.duration;
  if (modelId === 'minimax/video-01' && hasInputValue(duration)) {
    throw new Error(
      'Video-01 has a fixed duration of approximately 6 seconds; remove the duration from the media default',
    );
  }
  const choices = VIDEO_DURATION_CHOICES[modelId];
  if (choices && hasInputValue(duration)) {
    const seconds = Number(duration);
    if (!Number.isInteger(seconds) || !choices.includes(seconds)) {
      throw new Error(
        `${modelId} duration must be ${choices.join(' or ')} seconds; update the media default or selected duration`,
      );
    }
  }

  if (modelId !== 'google/veo-3.1') return;
  const references = input.reference_images;
  if (references === undefined || references === null) return;
  if (!Array.isArray(references)) {
    throw new Error('Veo reference_images must be an array of 1–3 image URLs');
  }
  if (references.length === 0) return;
  if (references.length > 3) {
    throw new Error('Veo accepts between 1 and 3 subject/style reference images');
  }
  if (references.some((item) => typeof item !== 'string' || !item)) {
    throw new Error('Each Veo reference image must be a provider-reachable URL');
  }
  if (input.aspect_ratio !== '16:9') {
    throw new Error('Veo subject/style references require a 16:9 aspect ratio');
  }
  if (Number(input.duration) !== 8) {
    throw new Error('Veo subject/style references require an 8-second duration');
  }
  if (hasInputValue(input.last_frame)) {
    throw new Error('Veo last-frame transitions cannot be combined with subject/style references');
  }
}

export class ReplicateMediaAdapter implements MediaProviderAdapter {
  constructor(
    private readonly _fetch: SafeFetchPort,
    private readonly _logger?: LoggerPort,
  ) {}
  readonly identifier = 'replicate';
  readonly name = 'Replicate';
  readonly capabilities: MediaProviderCapabilities = {
    image: true,
    video: true,
    audio: true,
    avatar: true,
    tts: false,
    stt: false,
    upscale: true,
    bgRemove: true,
    inpaint: true,
    outpaint: true,
    videoToVideo: true,
    videoUpscale: true,
    videoBg: true,
  };

  private _headers(options?: MediaCredentialOptions, preferWait?: number): Record<string, string> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('Replicate API key is required');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(preferWait ? { Prefer: `wait=${preferWait}` } : {}),
    };
  }

  private async _createPrediction(
    options: MediaGenerateOptions | undefined,
    input: Record<string, string | number | boolean | undefined>,
    preferWait?: number,
  ): Promise<ReplicatePredictionResponse> {
    const headers = this._headers(options, preferWait);
    const model = options?.version;
    if (!model) throw new Error('Replicate model/version is required');
    const body = {
      input: { ...input, ...this._filterTunableInput(model, options?.input) },
      ...(options?.webhookUrl
        ? { webhook: options.webhookUrl, webhook_events_filter: ['completed'] }
        : {}),
    };
    // Slug → /models/{slug}/predictions (input only); hash → /predictions with `version` (2.5).
    if (isVersionHash(model)) {
      const res = await this._fetch(`${BASE}/predictions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ version: model, ...body }),
      });
      if (!res.ok) throw await mediaUpstreamError(this, res);
      return (await res.json()) as ReplicatePredictionResponse;
    }
    const res = await this._fetch(`${BASE}/models/${validateModelId(model)}/predictions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (res.status === 404) {
      // /models/{slug}/predictions only accepts Replicate OFFICIAL models — a
      // community model (e.g. meta/musicgen, the text-to-music catalog entry)
      // 404s there. Resolve the latest version hash and submit via
      // /predictions, the same shape ReplicateRunnerService uses.
      const version = await this._resolveLatestVersionId(model, options);
      const retry = await this._fetch(`${BASE}/predictions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ version, ...body }),
      });
      if (!retry.ok) throw await mediaUpstreamError(this, retry);
      return (await retry.json()) as ReplicatePredictionResponse;
    }
    if (!res.ok) throw await mediaUpstreamError(this, res);
    return (await res.json()) as ReplicatePredictionResponse;
  }

  // GET /v1/models/{slug} → latest_version.id, for the community-model fallback above.
  private async _resolveLatestVersionId(
    model: string,
    options?: MediaCredentialOptions,
  ): Promise<string> {
    const res = await this._fetch(`${BASE}/models/${validateModelId(model)}`, {
      headers: this._headers(options),
    });
    if (!res.ok) throw await mediaUpstreamError(this, res);
    const data = (await res.json()) as { latest_version?: { id?: string } };
    const id = data.latest_version?.id;
    if (!id) throw new Error(`Replicate model ${model} has no latest version to run`);
    return id;
  }

  // Org media-default tunables (`options.input`) are model-generic — a tunable
  // valid for one model 422s another because Replicate rejects unknown inputs
  // (prod failure: `aspect_ratio` is invalid for kling-v2.1 image-to-video).
  // Strip tunable keys the target model's metadata schema does not declare.
  // Core adapter-managed inputs (prompt fields, native source fields) are
  // always allowed; a model absent from the metadata (custom version hash,
  // undeclared community model) keeps the historical verbatim passthrough.
  private _filterTunableInput(
    model: string,
    input: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!input) return input;
    const allowed = ReplicateMediaAdapter._declaredInputFields(model);
    if (!allowed) return input;
    let next: Record<string, unknown> | null = null;
    for (const [key, value] of Object.entries(input)) {
      if (allowed.has(key)) {
        if (next) next[key] = value;
      } else {
        this._logger?.warn(
          `Replicate ${model}: dropping unsupported media-default tunable "${key}" (not in the model's input schema)`,
        );
        next = next ?? { ...input };
        delete next[key];
      }
    }
    return next ?? input;
  }

  private static _declaredInputFields(model: string): Set<string> | null {
    if (isVersionHash(model)) return null;
    const mediaModels = providerMetadata.mediaModels as
      | Record<string, { id: string; fields?: { name: string }[] }[]>
      | undefined;
    const allowed = new Set<string>(['prompt', 'prompt_a', 'prompt_b']);
    let declared = false;
    for (const models of Object.values(mediaModels ?? {})) {
      for (const entry of models) {
        if (entry.id !== model) continue;
        declared = true;
        for (const field of entry.fields ?? []) allowed.add(field.name);
      }
    }
    if (!declared) return null;
    // Adapter-managed inputs are always legal tunable overrides (an explicit
    // org tunable wins over the adapter's own mapping — see generateImage's
    // source handling), even when the metadata field list omits them.
    const i2vField = ReplicateMediaAdapter._I2V_SOURCE_FIELD[model];
    if (i2vField) allowed.add(i2vField);
    if (model === 'google/veo-3.1') {
      allowed.add('last_frame');
      allowed.add('reference_images');
    }
    const v2vField = ReplicateMediaAdapter._V2V_SOURCE_FIELD[model];
    if (v2vField) allowed.add(v2vField);
    const i2iField = ReplicateMediaAdapter._i2iInputField(model);
    if (i2iField) allowed.add(i2iField);
    allowed.add(ReplicateMediaAdapter._bgRemoveInputField(model));
    return allowed;
  }

  // A blocking (`Prefer: wait`) create may still return `starting`/`processing` when the window
  // elapses. Rather than returning `''`/throwing "no output" (2.4), poll the prediction id until
  // it reaches a terminal state, keeping the synchronous image/upscale/rembg/inpaint contract.
  private async _resolvePrediction(
    data: ReplicatePredictionResponse,
    options?: MediaCredentialOptions,
  ): Promise<ReplicatePredictionResponse> {
    if (data.status === 'succeeded' || data.status === 'failed' || data.status === 'canceled') {
      return data;
    }
    if (!data.id) throw new Error('Replicate returned no prediction id');
    // 500ms granularity: most predictions finish inside the `Prefer: wait` window, so a coarse
    // sleep was adding up to 2s of dead time after completion (rembg felt slow). 120 × 500ms
    // keeps the same ~60s poll ceiling as before.
    for (let attempt = 0; attempt < 120; attempt++) {
      await sleep(500);
      const res = await this._fetch(`${BASE}/predictions/${data.id}`, {
        headers: this._headers(options),
      });
      if (!res.ok) {
        const body = await res.text();
        // Transient poll error: the prediction may still be fine — surface for a retry.
        if (isTransientStatus(res.status)) {
          throw new Error(`Replicate poll transient error ${res.status}: ${redactError(body, 200)}`);
        }
        throw mediaUpstreamFromBody(this, res.status, body, 'image');
      }
      const polled = (await res.json()) as ReplicatePredictionResponse;
      if (polled.status === 'succeeded' || polled.status === 'failed' || polled.status === 'canceled') {
        return polled;
      }
    }
    throw new Error('Replicate prediction timed out');
  }

  // Flux-family image models take an `aspect_ratio` input token. The coarse
  // aspect hint maps onto it; an explicit `options.input.aspect_ratio` (org
  // default tunables) wins because `_createPrediction` spreads input last.
  private static readonly ASPECT_RATIO: Record<string, string> = {
    square: '1:1',
    wide: '16:9',
    tall: '9:16',
  };

  // Model → native init-image field for the models `metadata.mediaModels`
  // declares under `image-to-image` (the guard is the metadata declaration;
  // this map is only the field-name knowledge): the flux-kontext family
  // takes `input_image`, flux-dev takes `image`. A declared model with no
  // known field returns null — guessing a field name ships broken input.
  private static _i2iInputField(model: string): string | null {
    const declared = (
      (providerMetadata.mediaModels as Record<string, { id: string }[]> | undefined)?.[
        'image-to-image'
      ] ?? []
    ).some((m) => m.id === model);
    if (!declared) return null;
    if (model.includes('flux-kontext')) return 'input_image';
    if (model === 'black-forest-labs/flux-dev') return 'image';
    return null;
  }

  // Model → native image field for the models `metadata.mediaModels` declares
  // under `image-bg-remove` (same declaration-guard discipline as
  // `_i2iInputField`): bria/remove-background takes `image_url`,
  // 851-labs/background-remover takes `image`. An undeclared/custom model keeps
  // the historical `image` field rather than throwing — bg-remove predates the
  // guard and custom versions rely on it. `options.input` still spreads last in
  // `_createPrediction`, so an explicit org tunable wins.
  private static _bgRemoveInputField(model: string): string {
    const declared = (
      (providerMetadata.mediaModels as Record<string, { id: string }[]> | undefined)?.[
        'image-bg-remove'
      ] ?? []
    ).some((m) => m.id === model);
    if (declared && model === 'bria/remove-background') return 'image_url';
    return 'image';
  }

  // Model → native source-footage field for source-driven video generation,
  // following the `_i2iInputField`/`_bgRemoveInputField` declaration-guard
  // pattern: the guard is the metadata declaration (a model only receives a
  // source when this package's `metadata.mediaModels` declares it under a
  // source-driven category), this map is only the field-name knowledge —
  // verified against the live Replicate input schemas. Image-to-video models
  // take a first-frame IMAGE (`first_frame_image` / `image` / `start_image`);
  // video-to-video (restyle/edit) models take a source VIDEO (`video`). A model
  // declared in neither category, or declared but with no known field, returns
  // null — hardcoding `video_url` for every model shipped a 422 for all of
  // them (no allowlisted model accepts that name).
  private static readonly _I2V_SOURCE_FIELD: Record<string, string> = {
    'google/veo-3.1': 'image',
    'minimax/video-01': 'first_frame_image',
    'bytedance/seedance-1-pro': 'image',
    'kwaivgi/kling-v2.5-turbo-pro': 'start_image',
  };
  private static readonly _V2V_SOURCE_FIELD: Record<string, string> = {
    'wan-video/wan-2.7-videoedit': 'video',
  };

  // Model → native prompt field for the music models `metadata.mediaModels`
  // declares under `text-to-music`/`music-to-music` (same declaration-guard
  // discipline as `_videoSourceInputField`): riffusion's schema takes
  // `prompt_a`/`prompt_b` and has NO `prompt` input, so the Designer music
  // path (generateAudio → generateVideo) 422'd every riffusion job by sending
  // `{ prompt }`. A declared model with no entry keeps the default `prompt`.
  private static readonly _PROMPT_FIELD: Record<string, string> = {
    'riffusion/riffusion': 'prompt_a',
  };

  // riffusion's CLIP text encoder hard-caps at 77 tokens (prod failure:
  // "Sizes of tensors must match... Expected size 77 but got size 154").
  // ~300 chars ≈ 75 tokens — truncate with a warning rather than fail a paid job.
  // The video models cap prompt length too (veo rejects past ~1024 chars;
  // kling ~2500; seedance ~2000) — over-long prompts 422 the whole job.
  // Mirrored in ReplicateRunnerService._PROMPT_MAX_CHARS (the studio/runner
  // path bypasses this adapter).
  private static readonly _PROMPT_MAX_CHARS: Record<string, number> = {
    'riffusion/riffusion': 300,
    'google/veo-3.1': 1024,
    'bytedance/seedance-1-pro': 2000,
    'kwaivgi/kling-v2.5-turbo-pro': 2500,
  };

  private static _promptInputField(model: string | undefined): string | null {
    if (!model) return null;
    const mediaModels = providerMetadata.mediaModels as
      | Record<string, { id: string }[]>
      | undefined;
    const declared = ['text-to-music', 'music-to-music'].some((category) =>
      (mediaModels?.[category] ?? []).some((m) => m.id === model),
    );
    if (!declared) return null;
    return ReplicateMediaAdapter._PROMPT_FIELD[model] ?? null;
  }

  private _promptInput(
    model: string | undefined,
    prompt: string,
  ): Record<string, string> {
    const field = ReplicateMediaAdapter._promptInputField(model);
    // The cap applies to every model with an entry (music AND video), not only
    // the music-declared ones with a renamed prompt field.
    const maxChars = model
      ? ReplicateMediaAdapter._PROMPT_MAX_CHARS[model]
      : undefined;
    if (maxChars && prompt.length > maxChars) {
      this._logger?.warn(
        `Replicate ${model} prompt truncated from ${prompt.length} to ${maxChars} chars (upstream token limit)`,
      );
      prompt = prompt.slice(0, maxChars);
    }
    if (!field) return { prompt };
    return { [field]: prompt };
  }

  private static _videoSourceInputField(
    model: string,
  ): { field: string; kind: 'image' | 'video' } | null {
    const mediaModels = providerMetadata.mediaModels as
      | Record<string, { id: string }[]>
      | undefined;
    const declaredIn = (category: string) =>
      (mediaModels?.[category] ?? []).some((m) => m.id === model);
    if (declaredIn('video-to-video')) {
      const field = ReplicateMediaAdapter._V2V_SOURCE_FIELD[model];
      return field ? { field, kind: 'video' } : null;
    }
    if (declaredIn('image-to-video')) {
      const field = ReplicateMediaAdapter._I2V_SOURCE_FIELD[model];
      return field ? { field, kind: 'image' } : null;
    }
    return null;
  }

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const aspectRatio = options?.aspect
      ? ReplicateMediaAdapter.ASPECT_RATIO[options.aspect]
      : undefined;
    // The resolved model rides back in the metadata: callers persist it with
    // the job, and "which model painted this?" is otherwise unanswerable from
    // the logs (the default is implicit).
    const model = options?.version || options?.model || DEFAULT_IMAGE_MODEL;
    // image-to-image: a `sourceUrl` lands in the model's native init-image
    // field, but ONLY for models the package metadata declares under
    // `image-to-image` — anything else throws rather than silently dropping
    // the conditioning (an unconditioned image must never ship labelled as
    // reference-matched; the caller falls back to text-to-image explicitly).
    // `options.input` still spreads last in `_createPrediction`, so an
    // explicit org tunable wins over this mapping.
    const sourceInput: Record<string, string> = {};
    if (options?.sourceUrl) {
      const field = ReplicateMediaAdapter._i2iInputField(model);
      if (!field) {
        throw new Error(
          `Replicate model ${model} does not accept image-to-image input`,
        );
      }
      sourceInput[field] = options.sourceUrl;
    }
    const created = await this._createPrediction(
      { ...options, version: model },
      { prompt, ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}), ...sourceInput },
      PREFER_WAIT_SECONDS,
    );
    const data = await this._resolvePrediction(created, options);
    if (data.status === 'failed' || data.status === 'canceled') {
      throw mediaUpstreamFromBody(this, undefined, String(data.error || 'unknown error'), 'image');
    }
    const output = data.output;
    if (!output) throw new Error('Replicate returned no output');

    if (Array.isArray(output)) {
      const urls = output.filter((u): u is string => typeof u === 'string');
      if (urls.length === 0) throw new Error('Replicate returned no image URLs');
      return { multi: urls.length > 1, image: urls[0], images: urls, metadata: { provider: this.identifier, model } };
    }
    if (typeof output === 'string') {
      return { multi: false, image: output, images: [output], metadata: { provider: this.identifier, model } };
    }
    // Object outputs (named artifacts) resolve through the same preference
    // helper the poll path uses.
    const url = firstOutputUrl(output);
    if (url) {
      return { multi: false, image: url, images: [url], metadata: { provider: this.identifier, model } };
    }
    throw new Error(`Unexpected Replicate output format: ${JSON.stringify(output)}`);
  }

  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    // Source-driven video: a source lands in the model's NATIVE field, resolved
    // per model by `_videoSourceInputField` (declaration-guarded by the package
    // metadata). `options.input.video_url` is the explicit v2v contract signal;
    // it is consumed here (mapped onto the native field) rather than forwarded
    // verbatim — no allowlisted model accepts a `video_url` input, so passing it
    // through 422'd every source-driven call. `options.sourceUrl` is the legacy
    // carrier (i2v image from AiDefaultsService.imageToVideo, v2v video from
    // videoToVideo). Unknown/undeclared models throw instead of guessing.
    const explicitVideoUrl =
      typeof options?.input?.video_url === 'string' ? options.input.video_url : undefined;
    const sourceUrl = explicitVideoUrl ?? options?.sourceUrl;

    const modelId = options?.version || options?.model;
    if (modelId === 'kwaivgi/kling-v2.1-master') {
      throw new Error('Replicate model kwaivgi/kling-v2.1-master is discontinued. Use kwaivgi/kling-v2.5-turbo-pro instead.');
    }
    if (sourceUrl && !modelId) {
      throw new Error(
        'Replicate source-driven video generation requires an explicit model/version; no default is configured',
      );
    }

    // The prompt lands in the model's NATIVE prompt field (`prompt` for most;
    // `prompt_a` for riffusion — see `_promptInputField`). `options.input` still
    // spreads last in `_createPrediction`, so an explicit org tunable wins.
    const input: Record<string, string | number | boolean | undefined> = this._promptInput(modelId, prompt);
    let passthroughInput = options?.input;
    if (sourceUrl) {
      const source = ReplicateMediaAdapter._videoSourceInputField(modelId!);
      if (!source) {
        throw new Error(
          `Replicate model ${modelId} does not declare an image-to-video or video-to-video source input`,
        );
      }
      if (explicitVideoUrl && source.kind !== 'video') {
        throw new Error(
          `Replicate model ${modelId} does not accept a video source input (image-to-video only)`,
        );
      }
      input[source.field] = sourceUrl;
      if (explicitVideoUrl) {
        passthroughInput = { ...options!.input };
        delete passthroughInput.video_url;
      }
    }

    if (modelId) validateVideoInput(modelId, { ...input, ...passthroughInput });
    if (
      modelId === 'google/veo-3.1' &&
      (passthroughInput?.reference_images === null ||
        (Array.isArray(passthroughInput?.reference_images) &&
          passthroughInput.reference_images.length === 0))
    ) {
      passthroughInput = { ...passthroughInput };
      delete passthroughInput.reference_images;
    }

    const opts: MediaGenerateOptions = { ...options, input: passthroughInput, version: modelId };
    const data = await this._createPrediction(opts, input);
    if (!data.id) throw new Error('Replicate returned no prediction id');
    return { jobId: data.id };
  }

  generateAudio(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    return this.generateVideo(prompt, options);
  }

  generateAvatar(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    return this.generateVideo(prompt, options);
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    // Missing key is a permanent config error → terminal failed, not a thrown error the
    // lifecycle would retry to the 24h timeout.
    if (!resolveApiKey(options)) return { status: 'failed', error: 'Replicate API key is required' };

    const res = await this._fetch(`${BASE}/predictions/${jobId}`, {
      headers: this._headers(options),
    });

    if (!res.ok) {
      const body = await res.text();
      // 3.4 — a 429/5xx poll is transient (render may still be fine): THROW so the lifecycle
      // retries instead of permanently failing a paid, still-running prediction.
      if (isTransientStatus(res.status)) {
        throw new Error(`Replicate poll transient error ${res.status}: ${redactError(body, 200)}`);
      }
      return { status: 'failed', error: mediaUpstreamFailure(this, res.status, body) };
    }
    const data = (await res.json()) as ReplicatePredictionResponse;

    switch (data.status) {
      case 'succeeded': {
        const url = firstOutputUrl(data.output);
        if (!url) return { status: 'failed', error: 'Replicate prediction succeeded without output' };
        return { status: 'completed', artifactUrl: url, metadata: { provider: this.identifier } };
      }
      case 'failed':
      case 'canceled':
        return { status: 'failed', error: mediaUpstreamFailure(this, undefined, data.error || 'Unknown error') };
      default:
        return { status: 'pending' };
    }
  }

  // Resolve a create response to a single output URL, polling if it is still processing when
  // the blocking window elapses (2.4 — never return '' for an in-flight prediction).
  private async _createAndResolveUrl(
    options: MediaGenerateOptions | undefined,
    input: Record<string, string | number | boolean | undefined>,
  ): Promise<string> {
    const created = await this._createPrediction(options, input, PREFER_WAIT_SECONDS);
    const data = await this._resolvePrediction(created, options);
    if (data.status === 'failed' || data.status === 'canceled') {
      throw mediaUpstreamFromBody(this, undefined, String(data.error || 'unknown error'));
    }
    const url = firstOutputUrl(data.output);
    if (!url) throw new Error('Replicate prediction succeeded without output');
    return url;
  }

  async upscaleImage(imageUrl: string, options?: MediaGenerateOptions): Promise<string> {
    return this._createAndResolveUrl(
      { ...options, version: options?.version || options?.model || DEFAULT_UPSCALE_MODEL },
      { image: imageUrl, scale: options?.scale || 4 },
    );
  }

  async removeBackground(imageUrl: string, options?: MediaGenerateOptions): Promise<string> {
    const model = options?.version || options?.model || DEFAULT_BG_REMOVE_MODEL;
    return this._createAndResolveUrl(
      { ...options, version: model },
      { [ReplicateMediaAdapter._bgRemoveInputField(model)]: imageUrl },
    );
  }

  async inpaintImage(imageUrl: string, maskUrl: string, prompt: string, options?: MediaGenerateOptions): Promise<string> {
    return this._createAndResolveUrl(
      { ...options, version: options?.version || options?.model || DEFAULT_INPAINT_MODEL },
      { image: imageUrl, mask: maskUrl, prompt },
    );
  }

  async outpaintImage(imageUrl: string, mode: OutpaintMode, prompt?: string, options?: MediaGenerateOptions): Promise<string> {
    return this._createAndResolveUrl(
      { ...options, version: options?.version || options?.model || DEFAULT_OUTPAINT_MODEL },
      {
        image: imageUrl,
        outpaint: OUTPAINT_TOKENS[mode] ?? OUTPAINT_TOKENS['zoom-1.5x'],
        prompt: prompt?.trim() || DEFAULT_OUTPAINT_PROMPT,
      },
    );
  }

  async upscaleVideo(videoUrl: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    // NEEDS-LIVE-SMOKE-TEST: verify model id and input field names against a real Replicate key.
    const data = await this._createPrediction(
      { ...options, version: options?.version || 'lucataco/real-esrgan-video' },
      { video: videoUrl, scale: options?.scale || 4 },
    );
    if (!data.id) throw new Error('Replicate returned no prediction id');
    return { jobId: data.id };
  }

  async removeVideoBackground(videoUrl: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    // Default rembg-video (general salient objects — products, pets) over
    // robust_video_matting (people-only matting) when the org hasn't pinned a
    // model; mirrors the metadata/allowlist ordering.
    const model =
      options?.model || options?.version || 'lucataco/rembg-video';
    // Live schemas (verified 2026-10): robust_video_matting takes `input_video`
    // + `output_type` and mattes PEOPLE only; lucataco/rembg-video takes
    // `video` + `background_color` and handles general salient objects
    // (products, pets). Default the rembg background to chroma green for parity
    // with the green-screen flow; org media-defaults tunables still win because
    // `_createPrediction` spreads `options.input` last.
    const input =
      model === 'lucataco/rembg-video'
        ? { video: videoUrl, background_color: '#00FF00' }
        : { input_video: videoUrl, output_type: 'green-screen' };
    const data = await this._createPrediction({ ...options, version: model }, input);
    if (!data.id) throw new Error('Replicate returned no prediction id');
    return { jobId: data.id };
  }

  // Free auth check: GET /v1/models is an unmetered catalog read — the settings
  // Test button must not fall back to a billed prediction.
  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) return { ok: false, message: 'Replicate API key is required' };
    const res = await this._fetch(`${BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return { ok: true, message: 'Connection successful' };
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Invalid API key' };
    throw new Error(`Replicate connection test failed (${res.status}): ${redactError(await res.text(), 200)}`);
  }
}

const _meta = new ReplicateMediaAdapter(undefined as unknown as SafeFetchPort);

export const replicateMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new ReplicateMediaAdapter(rt.fetch, rt.logger),
};
