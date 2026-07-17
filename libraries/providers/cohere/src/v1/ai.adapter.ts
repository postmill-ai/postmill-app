import { createCohere } from '@ai-sdk/cohere';
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

const COHERE_CAPABILITIES: AICapabilities = {
  text: true,
  image: false,
  vision: false,
  embeddings: true,
  speech: false,
  tools: true,
};

const COHERE_CREDENTIAL_FIELDS: CredentialField[] = [
  { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: '...' },
];

const COHERE_MODELS: ModelInfo[] = [
  { id: 'command-r-plus', label: 'Command R+', kind: 'text', capabilities: { ...COHERE_CAPABILITIES, embeddings: false } },
  { id: 'command-r', label: 'Command R', kind: 'text', capabilities: { ...COHERE_CAPABILITIES, embeddings: false } },
  { id: 'command', label: 'Command', kind: 'text', capabilities: { ...COHERE_CAPABILITIES, embeddings: false } },
  { id: 'embed-english-v3.0', label: 'Embed English v3', kind: 'embedding', dimension: 1024, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
  { id: 'embed-multilingual-v3.0', label: 'Embed Multilingual v3', kind: 'embedding', dimension: 1024, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
];

const COHERE_BASE_URL = 'https://api.cohere.com/v1';

export class CohereAdapter implements AIProviderAdapter {
  readonly identifier = 'cohere';
  readonly name = 'Cohere';
  readonly type = 'direct' as const;
  readonly credentialFields = COHERE_CREDENTIAL_FIELDS;
  readonly capabilities = COHERE_CAPABILITIES;
  readonly privacy = {
    dataRetention: 'Per Cohere privacy policy',
    trainingOnData: false,
    description: 'Cohere API',
  };

  // 0.4: SSRF-safe fetch, injected by the provider module's create/validate.
  private _safeFetch?: SafeFetchPort;

  setSafeFetch(fetch: SafeFetchPort): void {
    this._safeFetch = fetch;
  }

  private _buildProvider(creds: Record<string, string>) {
    return createCohere({ apiKey: creds.apiKey });
  }

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    return COHERE_MODELS;
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) return { ok: false, error: 'API key is required' };
    // 0.4: only over the SSRF-safe fetch — never the global fetch.
    if (!this._safeFetch) return { ok: false, error: 'cannot validate' };
    try {
      const response = await this._safeFetch(`${COHERE_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${creds.apiKey}` },
      });
      if (response.ok) return { ok: true };
      const errorText = await response.text().catch(() => '');
      return { ok: false, error: `API error: ${response.status} ${errorText}` };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Unknown error' };
    }
  }

  createLanguageModel(creds: Record<string, string>, modelId: string, _opts?: AIModelOptions): LanguageModelV2 {
    return this._buildProvider(creds).languageModel(modelId) as unknown as LanguageModelV2;
  }

  createLangchainModel(creds: Record<string, string>, modelId: string, opts?: AIModelOptions): BaseChatModel {
    return new ChatOpenAI({
      openAIApiKey: creds.apiKey,
      configuration: { baseURL: COHERE_BASE_URL },
      model: modelId,
      temperature: opts?.temperature,
      topP: opts?.topP,
      maxTokens: opts?.maxTokens,
    });
  }

  createEmbeddingModel(creds: Record<string, string>, modelId: string): EmbeddingModelV2<string> | undefined {
    return this._buildProvider(creds).textEmbeddingModel?.(modelId);
  }
}

const adapter = new CohereAdapter();

export const cohereAiModule: ProviderModule<any, any> = {
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
