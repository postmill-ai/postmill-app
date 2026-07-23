import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LanguageModelV2, ImageModelV2, EmbeddingModelV2 } from '@ai-sdk/provider-v5';
import { metadata as providerMetadata } from './metadata';
import {
  mergeLiveModels,
  type AiCapability as AIProviderAdapter,
  type AiCredentialField as CredentialField,
  type AiModelInfo as ModelInfo,
  type AiCapabilities as AICapabilities,
  type AiModelOptions as AIModelOptions,
  type LiveModelEntry,
  type ProviderModule,
  type SafeFetchPort,
} from '@gitroom/provider-kernel';

const GOOGLE_CAPABILITIES: AICapabilities = {
  text: true,
  image: true,
  vision: true,
  embeddings: true,
  speech: false,
  tools: true,
};

const GOOGLE_CREDENTIAL_FIELDS: CredentialField[] = [
  { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'AIza...' },
];

const GOOGLE_MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', kind: 'text', capabilities: { ...GOOGLE_CAPABILITIES, embeddings: false }, reasoning: true },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', kind: 'text', capabilities: { ...GOOGLE_CAPABILITIES, embeddings: false }, reasoning: true },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', kind: 'text', capabilities: { ...GOOGLE_CAPABILITIES, embeddings: false } },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', kind: 'text', capabilities: { ...GOOGLE_CAPABILITIES, embeddings: false } },
  { id: 'text-embedding-004', label: 'Text Embedding 004', kind: 'embedding', dimension: 768, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
  { id: 'text-embedding-005', label: 'Text Embedding 005', kind: 'embedding', dimension: 768, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
];

export class GoogleAdapter implements AIProviderAdapter {
  readonly identifier = 'google';
  readonly name = 'Google Gemini';
  readonly type = 'direct' as const;
  readonly credentialFields = GOOGLE_CREDENTIAL_FIELDS;
  readonly capabilities = GOOGLE_CAPABILITIES;
  readonly privacy = {
    dataRetention: 'Per Google AI Terms of Service — data may be retained for up to 30 days',
    trainingOnData: true,
    description: 'Google Gemini API',
  };

  // 0.4: SSRF-safe fetch, injected by the provider module's create/validate.
  private _safeFetch?: SafeFetchPort;

  setSafeFetch(fetch: SafeFetchPort): void {
    this._safeFetch = fetch;
  }

  private _buildProvider(creds: Record<string, string>) {
    return createGoogleGenerativeAI({ apiKey: creds.apiKey });
  }

  /**
   * Live model list from Google's `GET /v1beta/models` — shape
   * `{ models: [{ name: 'models/<id>', displayName, supportedGenerationMethods }] }`.
   * Auth uses the `x-goog-api-key` HEADER, not the documented `?key=` query param:
   * a key in the URL would land unredacted in Sentry fetch breadcrumbs (the
   * scrubber redacts by header/field name, not mid-URL substrings).
   * Only entries supporting 'generateContent' are kept; the `models/` prefix is
   * stripped for the id. Returns null on ANY failure so listModels falls back
   * to the static catalog. Never throws.
   */
  private async _fetchLiveModels(creds: Record<string, string>): Promise<LiveModelEntry[] | null> {
    if (!this._safeFetch || !creds.apiKey) return null;
    try {
      const response = await this._safeFetch(
        'https://generativelanguage.googleapis.com/v1beta/models',
        { headers: { 'x-goog-api-key': creds.apiKey } },
      );
      if (!response.ok) return null;
      const data: any = await response.json();
      const models = data?.models;
      if (!Array.isArray(models) || models.length === 0) return null;
      const entries: LiveModelEntry[] = [];
      for (const m of models) {
        if (!m || typeof m.name !== 'string') continue;
        const methods: any[] = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
        if (!methods.includes('generateContent')) continue;
        const id = m.name.replace(/^models\//, '');
        if (!id) continue;
        const label = typeof m.displayName === 'string' && m.displayName ? m.displayName : undefined;
        entries.push({ id, label });
      }
      return entries.length > 0 ? entries : null;
    } catch {
      return null;
    }
  }

  async listModels(creds: Record<string, string>): Promise<ModelInfo[]> {
    // Live-first: merge the upstream catalog with the static list (curated
    // metadata wins on known ids). Any failure falls back to the static list.
    const live = await this._fetchLiveModels(creds);
    return mergeLiveModels(live, GOOGLE_MODELS, this.capabilities);
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) return { ok: false, error: 'API key is required' };
    try {
      const provider = this._buildProvider(creds);
      const model = provider.languageModel('gemini-2.5-flash');
      await (model as any).doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text' as const, text: 'ping' }] }],
        maxOutputTokens: 1,
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Unknown error' };
    }
  }

  createLanguageModel(creds: Record<string, string>, modelId: string, _opts?: AIModelOptions): LanguageModelV2 {
    return this._buildProvider(creds).languageModel(modelId);
  }

  createLangchainModel(_creds: Record<string, string>, _modelId: string, _opts?: AIModelOptions): BaseChatModel {
    throw new Error('Google Generative AI LangChain integration is not installed. Use languageModel() instead.');
  }

  createImageModel(creds: Record<string, string>, modelId: string): ImageModelV2 | undefined {
    return this._buildProvider(creds).imageModel?.(modelId);
  }

  createEmbeddingModel(creds: Record<string, string>, modelId: string): EmbeddingModelV2<string> | undefined {
    return this._buildProvider(creds).textEmbeddingModel?.(modelId);
  }
}

const adapter = new GoogleAdapter();

export const googleAiModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'ai',
    providerId: adapter.identifier,
    version: 'v1',
    displayName: adapter.name,
    status: 'active',
    credentialFields: (adapter as any).credentialFields || [],
    capabilities: (adapter as any).capabilities,
  },
  create: (ctx) => {
    adapter.setSafeFetch(ctx.fetch);
    return adapter as any;
  },
  validateCredentials: async (ctx) => {
    adapter.setSafeFetch(ctx.fetch);
    return adapter.validateCredentials(ctx.credentials);
  },
};
