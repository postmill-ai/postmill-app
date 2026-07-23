import { createOpenAI } from '@ai-sdk/openai';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type {
  LanguageModelV2,
  EmbeddingModelV2,
  ImageModelV2,
  SpeechModelV2,
} from '@ai-sdk/provider-v5';
import type {
  AiCapability,
  AiProviderType,
  AiCredentialField,
  AiModelInfo,
  AiCapabilities,
  AiModelOptions,
} from './ai';
import type { SafeFetchPort } from '../ports';

/**
 * Tiny bounded LRU used to cache built provider clients keyed by credential
 * material. Capped so rotated keys age out instead of being retained
 * indefinitely, and so the map can't grow without bound (4.11, companion to the
 * resolution-service cache invalidation in 1.3). Read refreshes recency.
 */
export class BoundedProviderCache<V> {
  private readonly _map = new Map<string, V>();
  constructor(private readonly _max = 256) {}

  get(key: string): V | undefined {
    const value = this._map.get(key);
    if (value !== undefined) {
      // Refresh recency: re-insert so it becomes the most-recently-used entry.
      this._map.delete(key);
      this._map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    if (this._map.has(key)) {
      this._map.delete(key);
    } else if (this._map.size >= this._max) {
      const oldest = this._map.keys().next().value;
      if (oldest !== undefined) this._map.delete(oldest);
    }
    this._map.set(key, value);
  }

  get size(): number {
    return this._map.size;
  }
}

/**
 * 3.1: the SSRF-safe fetch (`safeFetch`) throws `Blocked URL` for a private /
 * non-public / non-HTTPS target. Recognising that message lets
 * `validateCredentials` propagate the SSRF rejection (the caller maps it to a
 * 400) instead of reflecting it, while treating every other failure as an
 * ordinary transport error. Match ONLY the SSRF signals ("blocked url" — the
 * safeFetch contract — or an explicit "ssrf" tag); anything broader (e.g. a bare
 * `refus`) would also match "connection refused"-style transport messages and
 * reclassify an ordinary ECONNREFUSED as an SSRF rejection.
 */
function isBlockedUrlError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /blocked url|ssrf/i.test(err.message);
}

/**
 * 3.1: a short, non-reflective summary for a transport failure (ENOTFOUND /
 * ECONNREFUSED / ETIMEDOUT / TLS / timeout) — enough for a "Test connection" to
 * report a failed connection, without echoing any fetched body back to the tenant.
 */
function transportErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  if (code) return `Could not reach the Base URL (${code})`;
  const message = (err as Error)?.message;
  return message && message.includes('timed out')
    ? message
    : 'Could not reach the Base URL';
}

/**
 * A model entry from a live `/models` listing, before capability classification.
 * `kind`/`capabilities` are optional overrides for providers whose live list is
 * already typed (e.g. Together's `type` field, Cohere's `endpoints`) — when
 * present they win over the id heuristics in `heuristicModelInfo`.
 */
export interface LiveModelEntry {
  id: string;
  label?: string;
  kind?: AiModelInfo['kind'];
  capabilities?: Partial<AiCapabilities>;
}

/**
 * Fetch the live model list from an OpenAI-compatible `GET {baseURL}/models`
 * endpoint (`{ data: [{ id, ... }] }` shape, Bearer auth). Returns `null` on ANY
 * failure — missing inputs, non-OK response, transport error, SSRF block, or an
 * empty/unexpected payload — so callers can fall back to their static catalog.
 * Never throws: the list path must not propagate SSRF or transport errors.
 */
export async function fetchOpenAIStyleModels(
  safeFetch: SafeFetchPort | undefined,
  baseURL: string | undefined,
  apiKey: string | undefined,
): Promise<LiveModelEntry[] | null> {
  if (!safeFetch || !baseURL || !apiKey) return null;
  try {
    const url = baseURL.replace(/(?<![/])\/+$/, '');
    const response = await safeFetch(`${url}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return null;
    const data: any = await response.json();
    const models = Array.isArray(data) ? data : data?.data;
    if (!Array.isArray(models) || models.length === 0) return null;
    const entries = models
      .filter((m: any) => m && typeof m.id === 'string' && m.id.length > 0)
      .map((m: any) => ({
        id: m.id as string,
        label: typeof m.name === 'string' && m.name ? m.name : undefined,
      }));
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

/**
 * Classify a live-only model id into an `AiModelInfo` using id heuristics, based
 * on the provider's default capabilities. Non-chat models (embeddings, image,
 * speech/transcription/moderation/realtime) get `text: false` so they don't
 * pollute the text-category dropdowns.
 */
export function heuristicModelInfo(
  id: string,
  providerCapabilities: AiCapabilities,
  label?: string,
): AiModelInfo {
  const lower = id.toLowerCase();
  let kind: AiModelInfo['kind'] = 'text';
  const caps: AiCapabilities = { ...providerCapabilities };
  if (lower.includes('embed')) {
    kind = 'embedding';
    caps.text = false; caps.image = false; caps.vision = false;
    caps.speech = false; caps.tools = false; caps.embeddings = true;
  } else if (lower.includes('dall-e') || lower.includes('image')) {
    kind = 'image';
    caps.text = false; caps.embeddings = false; caps.speech = false;
    caps.tools = false; caps.vision = false; caps.image = true;
  } else if (/(^|[^a-z])(tts|whisper|transcribe|speech|audio|moderation|realtime)/.test(lower)) {
    caps.text = false; caps.image = false; caps.vision = false;
    caps.embeddings = false; caps.tools = false; caps.speech = true;
  }
  return { id, label: label || id, kind, capabilities: caps };
}

/**
 * Classify one live entry: explicit `kind`/`capabilities` overrides win;
 * otherwise fall back to the id heuristics.
 */
function classifyLiveEntry(entry: LiveModelEntry, providerCapabilities: AiCapabilities): AiModelInfo {
  if (entry.kind !== undefined || entry.capabilities !== undefined) {
    return {
      id: entry.id,
      label: entry.label || entry.id,
      kind: entry.kind ?? 'text',
      capabilities: { ...providerCapabilities, ...entry.capabilities },
    };
  }
  return heuristicModelInfo(entry.id, providerCapabilities, entry.label);
}

/**
 * Merge a live model list with the adapter's static catalog. Live is the source
 * of truth for WHICH models exist (static entries absent upstream are dropped —
 * they were retired); static is the source of truth for curated metadata (label,
 * vision/reasoning flags) on ids it knows. Live-only ids get heuristic caps.
 * Ordering: curated entries first (static order), then live-only ids
 * alphabetically — keeps huge hub lists (OpenRouter 200+) usable.
 * A null/empty live list returns the static catalog unchanged (fallback path).
 */
export function mergeLiveModels(
  live: LiveModelEntry[] | null | undefined,
  staticModels: AiModelInfo[],
  providerCapabilities: AiCapabilities,
): AiModelInfo[] {
  if (!live || live.length === 0) return staticModels;
  const staticById = new Map(staticModels.map((m) => [m.id, m]));
  const curated: AiModelInfo[] = [];
  const extra: AiModelInfo[] = [];
  const seen = new Set<string>();
  for (const entry of live) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const known = staticById.get(entry.id);
    if (known) {
      curated.push(known);
    } else {
      extra.push(classifyLiveEntry(entry, providerCapabilities));
    }
  }
  extra.sort((a, b) => a.id.localeCompare(b.id));
  return [...curated, ...extra];
}

/**
 * Shared OpenAI-compatible AI adapter base. Lives in the kernel so the nine
 * `openai-compatible` provider packages (siliconflow, deepinfra, minimax, qwen,
 * meta-llama, gmihub, bitdeer, lightning, vultr) can construct it without
 * importing each other or `@gitroom/nestjs-libraries`.
 */
export class OpenAICompatibleAdapter implements AiCapability {
  readonly identifier: string;
  readonly name: string;
  readonly type: AiProviderType;
  readonly credentialFields: AiCredentialField[];
  readonly capabilities: AiCapabilities;
  readonly privacy = {
    dataRetention: 'Varies by provider — review the provider\'s data policy',
    trainingOnData: false,
    description: 'Generic OpenAI-compatible API provider',
  };
  private readonly _defaultModels: AiModelInfo[];
  private readonly _defaultBaseURL: string;
  private _providerCache = new BoundedProviderCache<ReturnType<typeof createOpenAI>>();
  // 0.4: the SSRF-safe fetch, injected by each provider module's create(ctx).
  // When absent (isolated unit context) the `${baseURL}/models` call is skipped
  // rather than falling back to the global fetch against a tenant baseURL.
  private _safeFetch?: SafeFetchPort;

  /** Inject the SSRF-safe fetch (called from the provider module's create/validate). */
  setSafeFetch(fetch: SafeFetchPort): void {
    this._safeFetch = fetch;
  }

  constructor(
    identifier: string,
    name: string,
    baseURL: string,
    capabilities?: Partial<AiCapabilities>,
    models?: AiModelInfo[],
    type: AiProviderType = 'hub',
  ) {
    this.identifier = identifier;
    this.name = name;
    this.type = type;
    // The provider's canonical endpoint. Used as the default when the org didn't
    // set a custom baseURL, so Base URL is not a required user setting.
    this._defaultBaseURL = baseURL;
    this.credentialFields = [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'Enter API key' },
      { key: 'baseURL', label: 'Base URL', type: 'string', required: false, placeholder: baseURL },
    ];
    this.capabilities = {
      text: true,
      image: capabilities?.image || false,
      vision: capabilities?.vision || false,
      embeddings: capabilities?.embeddings || false,
      speech: capabilities?.speech || false,
      tools: capabilities?.tools ?? true,
    };
    this._defaultModels = models || [
      { id: 'default', label: `${name} Default`, kind: 'text', capabilities: this.capabilities },
    ];
  }

  private _getProvider(creds: Record<string, string>) {
    const baseURL = creds.baseURL || this._defaultBaseURL;
    const key = `${creds.apiKey}||${baseURL}`;
    let provider = this._providerCache.get(key);
    if (!provider) {
      provider = createOpenAI({ apiKey: creds.apiKey, baseURL: baseURL || undefined });
      this._providerCache.set(key, provider);
    }
    return provider;
  }

  async listModels(creds: Record<string, string>): Promise<AiModelInfo[]> {
    // Live-first: fetch the tenant-visible catalog over the SSRF-safe fetch and
    // merge it with the static default list (curated metadata wins on known ids).
    // Without a safeFetch (isolated unit context) or on any failure, fall back to
    // the static catalog.
    const live = await fetchOpenAIStyleModels(
      this._safeFetch,
      creds.baseURL || this._defaultBaseURL,
      creds.apiKey,
    );
    return mergeLiveModels(live, this._defaultModels, this.capabilities);
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) return { ok: false, error: 'API key is required' };
    // 0.4: without the SSRF-safe fetch we cannot validate a tenant baseURL — do
    // NOT fall back to the global fetch. Return a generic non-validated result.
    if (!this._safeFetch) return { ok: false, error: 'cannot validate' };
    const baseURL = (creds.baseURL || this._defaultBaseURL || '').replace(/(?<![/])\/+$/, '');
    if (!baseURL) return { ok: false, error: 'Base URL is required to validate credentials' };
    // 3.1: distinguish an SSRF / URL-safety rejection from an ordinary transport
    // failure. safeFetch throws `Blocked URL` for a private/non-public baseURL —
    // let that propagate (the caller maps it to a 400) rather than reflecting a
    // fetched body back to the tenant. A transport error (ENOTFOUND / ECONNREFUSED
    // / ETIMEDOUT / TLS / timeout) from a typo'd Base URL is not security-relevant
    // → return `{ ok:false }` so "Test connection" reports a failed connection
    // instead of an unhandled Nest 500.
    let response: Response;
    try {
      response = await this._safeFetch(`${baseURL}/models`, {
        headers: { Authorization: `Bearer ${creds.apiKey}` },
      });
    } catch (err) {
      if (isBlockedUrlError(err)) throw err;
      return { ok: false, error: transportErrorMessage(err) };
    }
    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }
    return { ok: false, error: `Unexpected response: ${response.status}` };
  }

  createLanguageModel(creds: Record<string, string>, modelId: string, _opts?: AiModelOptions): LanguageModelV2 {
    return this._getProvider(creds).languageModel(modelId);
  }

  createImageModel(creds: Record<string, string>, modelId: string): ImageModelV2 | undefined {
    return this._getProvider(creds).imageModel?.(modelId);
  }

  createLangchainModel(creds: Record<string, string>, modelId: string, opts?: AiModelOptions): BaseChatModel {
    return new ChatOpenAI({
      openAIApiKey: creds.apiKey,
      configuration: { baseURL: creds.baseURL || this._defaultBaseURL || undefined },
      model: modelId,
      temperature: opts?.temperature,
      topP: opts?.topP,
      maxTokens: opts?.maxTokens,
    });
  }

  createEmbeddingModel(creds: Record<string, string>, modelId: string): EmbeddingModelV2<string> | undefined {
    return this._getProvider(creds).textEmbeddingModel?.(modelId);
  }

  createSpeechModel(creds: Record<string, string>, modelId: string): SpeechModelV2 | undefined {
    return this._getProvider(creds).speechModel?.(modelId);
  }
}
