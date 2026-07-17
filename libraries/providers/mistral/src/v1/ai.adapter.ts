import { createMistral } from '@ai-sdk/mistral';
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

const MISTRAL_CAPABILITIES: AICapabilities = {
  text: true,
  image: false,
  vision: true,
  embeddings: true,
  speech: false,
  tools: true,
};

const MISTRAL_CREDENTIAL_FIELDS: CredentialField[] = [
  { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: '...' },
];

const MISTRAL_MODELS: ModelInfo[] = [
  { id: 'mistral-large-latest', label: 'Mistral Large', kind: 'text', capabilities: { ...MISTRAL_CAPABILITIES, embeddings: false } },
  { id: 'mistral-small-latest', label: 'Mistral Small', kind: 'text', capabilities: { ...MISTRAL_CAPABILITIES, embeddings: false } },
  { id: 'pixtral-large-latest', label: 'Pixtral Large', kind: 'text', capabilities: { ...MISTRAL_CAPABILITIES, vision: true, embeddings: false } },
  { id: 'ministral-3b-latest', label: 'Ministral 3B', kind: 'text', capabilities: { ...MISTRAL_CAPABILITIES, vision: false, embeddings: false } },
  { id: 'mistral-embed', label: 'Mistral Embed', kind: 'embedding', dimension: 1024, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
];

const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';

export class MistralAdapter implements AIProviderAdapter {
  readonly identifier = 'mistral';
  readonly name = 'Mistral AI';
  readonly type = 'direct' as const;
  readonly credentialFields = MISTRAL_CREDENTIAL_FIELDS;
  readonly capabilities = MISTRAL_CAPABILITIES;
  readonly privacy = {
    dataRetention: 'Per Mistral AI privacy policy',
    trainingOnData: false,
    description: 'Mistral AI API',
  };

  // 0.4: SSRF-safe fetch, injected by the provider module's create/validate.
  private _safeFetch?: SafeFetchPort;

  setSafeFetch(fetch: SafeFetchPort): void {
    this._safeFetch = fetch;
  }

  private _buildProvider(creds: Record<string, string>) {
    return createMistral({ apiKey: creds.apiKey });
  }

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    return MISTRAL_MODELS;
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) return { ok: false, error: 'API key is required' };
    // 0.4: only over the SSRF-safe fetch — never the global fetch.
    if (!this._safeFetch) return { ok: false, error: 'cannot validate' };
    try {
      const response = await this._safeFetch(`${MISTRAL_BASE_URL}/models`, {
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
      configuration: { baseURL: MISTRAL_BASE_URL },
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

const adapter = new MistralAdapter();

export const mistralAiModule: ProviderModule<any, any> = {
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
