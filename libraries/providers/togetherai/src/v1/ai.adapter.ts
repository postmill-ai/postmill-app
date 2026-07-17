import { createTogetherAI } from '@ai-sdk/togetherai';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LanguageModelV2, ImageModelV2, EmbeddingModelV2 } from '@ai-sdk/provider-v5';
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

const TOGETHER_AI_CAPABILITIES: AICapabilities = {
  text: true,
  image: true,
  vision: true,
  embeddings: true,
  speech: false,
  tools: true,
};

const TOGETHER_AI_CREDENTIAL_FIELDS: CredentialField[] = [
  { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'Enter Together AI API key' },
];

const TOGETHER_AI_MODELS: ModelInfo[] = [
  { id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', label: 'Llama 4 Scout', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true } },
  { id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct', label: 'Llama 4 Maverick', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true } },
  { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true } },
  { id: 'meta-llama/Llama-3.1-405B-Instruct-Turbo', label: 'Llama 3.1 405B', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true } },
  { id: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo', label: 'Llama 3.2 90B Vision', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true } },
  { id: 'mistralai/Mixtral-8x22B-Instruct-v0.1', label: 'Mixtral 8x22B', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true } },
  { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true }, reasoning: true },
  { id: 'black-forest-labs/FLUX.1-dev', label: 'FLUX.1 Dev', kind: 'image', capabilities: { text: false, image: true, vision: false, embeddings: false, speech: false, tools: false } },
  { id: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX.1 Schnell', kind: 'image', capabilities: { text: false, image: true, vision: false, embeddings: false, speech: false, tools: false } },
  { id: 'stabilityai/stable-diffusion-xl-base-1.0', label: 'Stable Diffusion XL', kind: 'image', capabilities: { text: false, image: true, vision: false, embeddings: false, speech: false, tools: false } },
  { id: 'togethercomputer/m2-bert-80M-8k-retrieval', label: 'M2-BERT 80M 8K', kind: 'embedding', dimension: 768, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
  { id: 'BAAI/bge-base-en-v1.5', label: 'BGE Base EN v1.5', kind: 'embedding', dimension: 768, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
  { id: 'sentence-transformers/all-MiniLM-L6-v2', label: 'All-MiniLM-L6-v2', kind: 'embedding', dimension: 384, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
];

const TOGETHER_AI_BASE_URL = 'https://api.together.xyz/v1';

export class TogetherAIAdapter implements AIProviderAdapter {
  readonly identifier = 'togetherai';
  readonly name = 'Together AI';
  // Hub: inference platform hosting 200+ open-weight models (not a model maker).
  readonly type = 'hub' as const;
  readonly credentialFields = TOGETHER_AI_CREDENTIAL_FIELDS;
  readonly capabilities = TOGETHER_AI_CAPABILITIES;
  readonly privacy = {
    dataRetention: 'Per Together AI privacy policy — data not used for training',
    trainingOnData: false,
    description: 'Together AI Inference API',
  };

  // 0.4: SSRF-safe fetch, injected by the provider module's create/validate.
  private _safeFetch?: SafeFetchPort;

  setSafeFetch(fetch: SafeFetchPort): void {
    this._safeFetch = fetch;
  }

  private _buildProvider(creds: Record<string, string>) {
    return createTogetherAI({ apiKey: creds.apiKey });
  }

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    return TOGETHER_AI_MODELS;
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) return { ok: false, error: 'API key is required' };
    // 0.4: only over the SSRF-safe fetch — never the global fetch.
    if (!this._safeFetch) return { ok: false, error: 'cannot validate' };
    try {
      const response = await this._safeFetch(`${TOGETHER_AI_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${creds.apiKey}` },
      });
      if (response.ok) return { ok: true };
      const errorText = await response.text().catch(() => '');
      return { ok: false, error: `API error: ${response.status} ${errorText}` };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Unknown error' };
    }
  }

  /** @note togetherai SDK returns specificationVersion "v3" — cast through unknown to satisfy the v2 interface */
  createLanguageModel(creds: Record<string, string>, modelId: string, _opts?: AIModelOptions): LanguageModelV2 {
    return this._buildProvider(creds).languageModel(modelId) as unknown as LanguageModelV2;
  }

  createLangchainModel(creds: Record<string, string>, modelId: string, opts?: AIModelOptions): BaseChatModel {
    return new ChatOpenAI({
      openAIApiKey: creds.apiKey,
      configuration: { baseURL: TOGETHER_AI_BASE_URL },
      model: modelId,
      temperature: opts?.temperature,
      topP: opts?.topP,
      maxTokens: opts?.maxTokens,
    });
  }

  /** @note togetherai SDK returns specificationVersion "v3" */
  createImageModel(creds: Record<string, string>, modelId: string): ImageModelV2 | undefined {
    return this._buildProvider(creds).imageModel?.(modelId) as unknown as ImageModelV2 | undefined;
  }

  /** @note togetherai SDK returns specificationVersion "v3" */
  createEmbeddingModel(creds: Record<string, string>, modelId: string): EmbeddingModelV2<string> | undefined {
    return this._buildProvider(creds).textEmbeddingModel?.(modelId) as unknown as EmbeddingModelV2<string> | undefined;
  }
}

const adapter = new TogetherAIAdapter();

export const togetheraiAiModule: ProviderModule<any, any> = {
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
