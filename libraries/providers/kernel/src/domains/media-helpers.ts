import { SafeFetchPort } from '../ports';
import { AiCapability } from './ai';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaModelOption,
  MediaOperation,
  MediaInputValue,
  MediaCredentialField,
  MediaPollResult,
  resolveApiKey,
} from './media';

// ── AI-SDK media bridge ──────────────────────────────────────────────────────
// Bridges hub media adapters to the existing AI-SDK provider adapters so the hard auth
// (AWS SigV4 for Bedrock, deployment URLs for Azure, the Vercel gateway) is handled by the
// `@ai-sdk/*` provider packages rather than hand-rolled here. The media adapter resolves
// the matching AI adapter (same identifier) and runs its image model. Image only — video
// is not exposed by these AI-SDK provider packages (gateway video uses a separate path).
//
// The media adapters are constructed with plain `new` (no DI), so the bootstrap/MediaModule
// injects the AI registry once at startup via `setAiRegistry`; adapters then reach it
// through `reg()`. Expressed against a minimal registry shape (only `getAdapter` returning a
// kernel `AiCapability`) so this kernel helper never imports nestjs-libraries; the production
// `AIProviderRegistry` is structurally compatible.

export interface AiImageRegistry {
  getAdapter(id: string): AiCapability | undefined;
}

let _registry: AiImageRegistry | undefined;

export function setAiRegistry(registry: AiImageRegistry): void {
  _registry = registry;
}

function reg(): AiImageRegistry {
  if (!_registry) {
    throw new Error('AI provider registry is not available (AI module disabled?)');
  }
  return _registry;
}

// Sniff the real image mime from the leading base64 bytes so the data URL is correct
// regardless of which format the provider returned (completeJob decodes data: URLs).
function sniffImageMime(b64: string): string {
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('UklGR')) return 'image/webp';
  if (b64.startsWith('R0lGOD')) return 'image/gif';
  return 'image/png';
}

export interface AiSdkImageParams {
  identifier: string;
  credentials: Record<string, string>;
  prompt: string;
  model: string;
  size?: string;
  n?: number;
  aspectRatio?: string;
}

// Generate an image through the AI-SDK image model of the matching AI provider.
export async function generateImageViaAiSdk(params: AiSdkImageParams): Promise<MediaGenerationResult> {
  const { identifier, credentials, prompt, model, size, n, aspectRatio } = params;
  const adapter = reg().getAdapter(identifier);
  if (!adapter?.createImageModel) {
    throw new Error(`${identifier} does not support image generation`);
  }
  const imageModel = adapter.createImageModel(credentials, model);
  if (!imageModel) {
    throw new Error(`${identifier} could not build an image model for "${model}"`);
  }

  // Call the low-level model protocol directly (as ai-model.provider does) to sidestep the
  // provider-v5/v6 type seam; result.images are base64 strings.
  const result = await (imageModel as unknown as {
    doGenerate(opts: {
      prompt: string;
      n: number;
      size?: string;
      aspectRatio?: string;
      providerOptions: Record<string, unknown>;
    }): Promise<{ images?: string[] }>;
  }).doGenerate({
    prompt,
    n: n ?? 1,
    size,
    aspectRatio,
    providerOptions: {},
  });

  const images = (result.images ?? []).filter(Boolean);
  if (!images.length) throw new Error(`${identifier} returned no image`);
  const urls = images.map((b64) => `data:${sniffImageMime(b64)};base64,${b64}`);
  return {
    multi: urls.length > 1,
    image: urls[0],
    images: urls,
    metadata: { provider: identifier, model },
  };
}

// Image models for the studio's dynamic dropdown, reusing the AI adapter's catalog.
export async function listImageModelsViaAiSdk(
  identifier: string,
  credentials: Record<string, string>,
): Promise<MediaModelOption[]> {
  const adapter = reg().getAdapter(identifier);
  if (!adapter) return [];
  const models = await adapter.listModels(credentials);
  return models
    .filter((m) => m.kind === 'image' || m.capabilities?.image)
    .map((m) => ({ id: m.id, label: m.label || m.id }));
}

// Cheap auth check for AI-SDK-delegated hubs — validate the AI credentials.
export async function testConnectionViaAiSdk(
  identifier: string,
  credentials: Record<string, string>,
): Promise<{ ok: boolean; message: string }> {
  const adapter = reg().getAdapter(identifier);
  if (!adapter) return { ok: false, message: `Unknown provider "${identifier}"` };
  try {
    const res = await adapter.validateCredentials(credentials);
    return res.ok
      ? { ok: true, message: 'Connection successful' }
      : { ok: false, message: res.error || 'Invalid credentials' };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

// Base for hubs whose media auth is non-trivial (AWS SigV4, Azure deployment URLs, the
// Vercel gateway) — image generation is delegated to the matching AI-SDK provider adapter
// (same identifier) so the `@ai-sdk/*` package handles signing/credentials. Image only;
// subclasses with their own video API (e.g. Gateway) override `generateVideo`. Credentials
// flow from the org's Settings → AI config via the universal-credential fallback. The
// optional `_fetch` is threaded for subclasses that make their own HTTP calls (Gateway's
// model catalog); Bedrock/Azure don't use it.
export abstract class AiSdkMediaAdapter implements MediaProviderAdapter {
  constructor(protected readonly _fetch?: SafeFetchPort) {}

  abstract readonly identifier: string;
  abstract readonly name: string;
  abstract readonly capabilities: MediaProviderCapabilities;
  readonly credentialFields?: MediaCredentialField[];

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const model = options?.model;
    if (!model) throw new Error(`${this.name} image generation requires a model`);
    const input = options?.input || {};
    return generateImageViaAiSdk({
      identifier: this.identifier,
      credentials: options?.credentials || {},
      prompt,
      model,
      size: typeof input.size === 'string' ? input.size : undefined,
      n: typeof input.n === 'number' ? input.n : undefined,
      aspectRatio: typeof input.aspect_ratio === 'string' ? input.aspect_ratio : undefined,
    });
  }

  async generateVideo(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error(`${this.name} does not support video generation`);
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error(`${this.name} does not support audio generation`);
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error(`${this.name} does not support avatar generation`);
  }

  async listModels(operation: MediaOperation, options?: MediaCredentialOptions): Promise<MediaModelOption[]> {
    if (operation !== 'image') return [];
    return listImageModelsViaAiSdk(this.identifier, options?.credentials || {});
  }

  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    return testConnectionViaAiSdk(this.identifier, options?.credentials || {});
  }
}

// ── OpenAI-compatible media base ──────────────────────────────────────────────
// Shared base for hubs that expose an OpenAI-compatible media surface — image via
// `POST {base}/images/generations` (response `data[].url` | `data[].b64_json`) and TTS via
// `POST {base}/audio/speech` (binary audio, returned inline as a data: URL). Subclasses set
// `baseUrl`, `identifier`, `name`, `capabilities`, and default models; providers with a
// bespoke (usually async) video API override `generateVideo` + `pollJob`. Field names in
// `options.input` are the provider's native params and ride straight into the body.

interface OpenAiModelsResponse {
  data?: { id?: string; type?: string }[];
}

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
};

export abstract class OpenAiCompatibleMediaAdapter implements MediaProviderAdapter {
  constructor(protected readonly _fetch: SafeFetchPort) {}

  abstract readonly identifier: string;
  abstract readonly name: string;
  abstract readonly capabilities: MediaProviderCapabilities;

  // OpenAI-compatible API root, e.g. https://api.together.ai/v1
  protected abstract readonly baseUrl: string;
  protected defaultImageModel = '';
  protected defaultAudioModel = '';
  protected defaultVoice = 'alloy';

  protected _key(options?: MediaCredentialOptions): string {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error(`${this.name} API key is required`);
    return apiKey;
  }

  protected _headers(options?: MediaCredentialOptions): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this._key(options)}`,
    };
  }

  // Drop empty values so the provider's own defaults apply.
  protected _clean(raw?: Record<string, MediaInputValue>): Record<string, MediaInputValue> {
    const out: Record<string, MediaInputValue> = {};
    for (const [k, v] of Object.entries(raw || {})) {
      if (v === undefined || v === '') continue;
      out[k] = v;
    }
    return out;
  }

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const model = options?.model || this.defaultImageModel;
    const res = await this._fetch(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({ model, prompt, ...this._clean(options?.input) }),
    });
    if (!res.ok) throw new Error(`${this.name} image generation failed: ${await res.text()}`);
    const data = (await res.json()) as { data?: { url?: string; b64_json?: string }[] };
    const urls = (data.data || [])
      .map((d) => d.url || (d.b64_json ? `data:image/png;base64,${d.b64_json}` : undefined))
      .filter((u): u is string => !!u);
    if (!urls.length) throw new Error(`${this.name} returned no image`);
    return {
      multi: urls.length > 1,
      image: urls[0],
      images: urls,
      metadata: { provider: this.identifier, model, prompt },
    };
  }

  // OpenAI-compatible `/audio/speech` — synchronous binary; returned inline as a data: URL
  // (completeJob decodes it into the org's audio files, no webhook/poll).
  async generateAudio(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const model = options?.model || this.defaultAudioModel;
    const input = this._clean(options?.input);
    const voice = (input.voice as string) || options?.voice || this.defaultVoice;
    const format = (input.response_format as string) || options?.format || 'mp3';
    delete input.voice;
    delete input.response_format;
    const res = await this._fetch(`${this.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: this._headers(options),
      body: JSON.stringify({ model, input: prompt, voice, response_format: format, ...input }),
    });
    if (!res.ok) throw new Error(`${this.name} speech generation failed: ${await res.text()}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = AUDIO_MIME[format] || 'audio/mpeg';
    return {
      jobId: `${this.identifier}-audio-${buffer.length}`,
      artifactUrl: `data:${mime};base64,${buffer.toString('base64')}`,
      metadata: { provider: this.identifier, model, mime, prompt },
    };
  }

  async generateVideo(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error(`${this.name} does not support video generation`);
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error(`${this.name} does not support avatar generation`);
  }

  // Which `type` value the provider's `/models` catalog uses for a modality. Override when
  // a provider tags models differently (or has no catalog for a modality → []).
  protected _modelTypes(operation: MediaOperation): string[] {
    if (operation === 'image') return ['image'];
    if (operation === 'video') return ['video'];
    return ['audio', 'tts'];
  }

  async listModels(operation: MediaOperation, options?: MediaCredentialOptions): Promise<MediaModelOption[]> {
    const types = this._modelTypes(operation);
    if (!types.length) return [];
    const res = await this._fetch(`${this.baseUrl}/models`, { headers: this._headers(options) });
    if (!res.ok) return [];
    const body = (await res.json()) as OpenAiModelsResponse | { id?: string; type?: string }[];
    const list = Array.isArray(body) ? body : body.data || [];
    return list
      .filter((m) => m.id && (!m.type || types.includes(m.type)))
      .map((m) => ({ id: m.id as string, label: m.id as string }));
  }

  async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this._fetch(`${this.baseUrl}/models`, { headers: this._headers(options) });
      if (res.ok) return { ok: true, message: 'Connection successful' };
      return { ok: false, message: `${this.name} connection failed: ${await res.text()}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

// ── Bearer-token media base ───────────────────────────────────────────────────
// Minimal base for the many single-key media adapters whose auth is a plain
// `Authorization: Bearer <key>` header (DeepInfra, LTX, Higgsfield, Leonardo, Recraft,
// Fireworks, …). It factors out the two pieces every one of them hand-rolls — the bearer
// `_headers` (resolved through the shared `resolveApiKey`) and `_clean` (drop empty input
// values so the provider's own defaults apply). Everything provider-specific —
// `identifier`/`name`/`capabilities`, request shapes, and the generate/poll bodies — stays
// abstract for the subclass. `_fetch` is injected so the adapter routes through `safeFetch`.
export abstract class BearerTokenMediaAdapter implements MediaProviderAdapter {
  constructor(protected readonly _fetch: SafeFetchPort) {}

  abstract readonly identifier: string;
  abstract readonly name: string;
  abstract readonly capabilities: MediaProviderCapabilities;
  readonly credentialFields?: MediaCredentialField[];

  // Resolve the single API key, raising a consistent error when it is missing.
  protected _key(options?: MediaCredentialOptions): string {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error(`${this.name} API key is required`);
    return apiKey;
  }

  protected _headers(options?: MediaCredentialOptions): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this._key(options)}`,
    };
  }

  // Drop undefined / empty-string values so the provider's own defaults apply.
  protected _clean(raw?: Record<string, MediaInputValue>): Record<string, MediaInputValue> {
    const out: Record<string, MediaInputValue> = {};
    for (const [k, v] of Object.entries(raw || {})) {
      if (v === undefined || v === '') continue;
      out[k] = v;
    }
    return out;
  }

  abstract generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult>;
  abstract generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission>;
  abstract generateAudio(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission>;
  abstract generateAvatar(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission>;
}

// ── Shared async-job poll loop ────────────────────────────────────────────────
// Runs the GET-poll-until-terminal loop that every submit-and-poll media adapter copies
// (Runway/LTX/Wan/Leonardo/…). The per-provider response shape is the one thing that
// differs, so it is decoded by `parse` into `{ status, result?, error? }`:
//   - 'completed' → resolves with `result` (throws if a completed job carries no result),
//   - 'failed'    → throws `error`,
//   - 'pending'   → sleeps `intervalMs` and polls again.
// Exhausting `attempts` while still pending throws a timeout. The first poll fires
// immediately (no leading sleep) so an already-done job resolves without delay.
export interface PollMediaJobParse<T> {
  status: MediaPollResult['status'];
  result?: T;
  error?: string;
}

export interface PollMediaJobOptions<T> {
  fetch: SafeFetchPort;
  url: string;
  headers?: Record<string, string>;
  attempts: number;
  intervalMs: number;
  parse: (body: unknown) => PollMediaJobParse<T>;
}

export async function pollMediaJob<T>(options: PollMediaJobOptions<T>): Promise<T> {
  const { fetch, url, headers, attempts, intervalMs, parse } = options;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Media job poll failed (${res.status}): ${await res.text()}`);
    }

    const decoded = parse(await res.json());
    if (decoded.status === 'completed') {
      if (decoded.result === undefined) {
        throw new Error('Media job completed without a result');
      }
      return decoded.result;
    }
    if (decoded.status === 'failed') {
      throw new Error(decoded.error || 'Media job failed');
    }
  }

  throw new Error(`Media job did not complete after ${attempts} attempts`);
}
