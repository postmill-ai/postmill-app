import { createGroq } from '@ai-sdk/groq';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LanguageModelV2, EmbeddingModelV2 } from '@ai-sdk/provider-v5';
import { metadata as providerMetadata } from './metadata';
import {
  type AiCapability as AIProviderAdapter,
  type AiCredentialField as CredentialField,
  type AiModelInfo as ModelInfo,
  type AiCapabilities as AICapabilities,
  type AiModelOptions as AIModelOptions,
  type ProviderModule,
  type SafeFetchPort,
} from '@gitroom/provider-kernel';

const GROQ_CAPABILITIES: AICapabilities = {
  text: true,
  image: false,
  vision: true,
  embeddings: true,
  speech: false,
  tools: true,
};

const GROQ_CREDENTIAL_FIELDS: CredentialField[] = [
  { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'gsk_...' },
];

const GROQ_MODELS: ModelInfo[] = [
  { id: 'llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true } },
  { id: 'llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true } },
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true } },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true } },
  { id: 'llama-3.2-90b-vision-preview', label: 'Llama 3.2 90B Vision', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true } },
  { id: 'llama-3.2-11b-vision-preview', label: 'Llama 3.2 11B Vision', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true } },
  { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true } },
  { id: 'gemma2-9b-it', label: 'Gemma 2 9B', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true } },
  { id: 'all-minilm-l6-v2', label: 'All-MiniLM-L6-v2', kind: 'embedding', dimension: 384, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
  { id: 'text-embedding-ada-002', label: 'Text Embedding Ada 002', kind: 'embedding', dimension: 1536, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
];

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export class GroqAdapter implements AIProviderAdapter {
  readonly identifier = 'groq';
  readonly name = 'Groq';
  // Hub: LPU inference host serving open-weight models (Llama/Mixtral/Gemma/etc.) — not a model maker.
  readonly type = 'hub' as const;
  readonly credentialFields = GROQ_CREDENTIAL_FIELDS;
  readonly capabilities = GROQ_CAPABILITIES;
  readonly privacy = {
    dataRetention: 'Per Groq privacy policy — data may be retained for up to 30 days',
    trainingOnData: false,
    description: 'Groq LPU Inference API',
  };

  // 0.4: SSRF-safe fetch, injected by the provider module's create/validate.
  private _safeFetch?: SafeFetchPort;

  setSafeFetch(fetch: SafeFetchPort): void {
    this._safeFetch = fetch;
  }

  private _buildProvider(creds: Record<string, string>) {
    return createGroq({ apiKey: creds.apiKey });
  }

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    return GROQ_MODELS;
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) return { ok: false, error: 'API key is required' };
    // 0.4: only over the SSRF-safe fetch — never the global fetch.
    if (!this._safeFetch) return { ok: false, error: 'cannot validate' };
    try {
      const response = await this._safeFetch(`${GROQ_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${creds.apiKey}` },
      });
      if (response.ok) return { ok: true };
      const errorText = await response.text().catch(() => '');
      return { ok: false, error: `API error: ${response.status} ${errorText}` };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Unknown error' };
    }
  }

  /** @note groq SDK returns specificationVersion "v3" — cast through unknown to satisfy the v2 interface */
  createLanguageModel(creds: Record<string, string>, modelId: string, _opts?: AIModelOptions): LanguageModelV2 {
    return this._buildProvider(creds).languageModel(modelId) as unknown as LanguageModelV2;
  }

  createLangchainModel(creds: Record<string, string>, modelId: string, opts?: AIModelOptions): BaseChatModel {
    return new ChatOpenAI({
      openAIApiKey: creds.apiKey,
      configuration: { baseURL: GROQ_BASE_URL },
      model: modelId,
      temperature: opts?.temperature,
      topP: opts?.topP,
      maxTokens: opts?.maxTokens,
    });
  }

  /** @note groq SDK returns specificationVersion "v3" */
  createEmbeddingModel(creds: Record<string, string>, modelId: string): EmbeddingModelV2<string> | undefined {
    return this._buildProvider(creds).textEmbeddingModel?.(modelId) as unknown as EmbeddingModelV2<string> | undefined;
  }
}

const adapter = new GroqAdapter();

export const groqAiModule: ProviderModule<any, any> = {
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
