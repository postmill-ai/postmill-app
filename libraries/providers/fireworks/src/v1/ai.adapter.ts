import { createFireworks } from '@ai-sdk/fireworks';
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

const FIREWORKS_CAPABILITIES: AICapabilities = {
  text: true,
  image: true,
  vision: true,
  embeddings: true,
  speech: false,
  tools: true,
};

const FIREWORKS_CREDENTIAL_FIELDS: CredentialField[] = [
  { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'fw_...' },
];

const FIREWORKS_MODELS: ModelInfo[] = [
  { id: 'accounts/fireworks/models/llama-v4-scout-17b-16e-instruct', label: 'Llama 4 Scout', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true } },
  { id: 'accounts/fireworks/models/llama-v4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true } },
  { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', label: 'Llama 3.3 70B', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true } },
  { id: 'accounts/fireworks/models/llama-v3p1-405b-instruct', label: 'Llama 3.1 405B', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true } },
  { id: 'accounts/fireworks/models/llama-v3p2-90b-vision-instruct', label: 'Llama 3.2 90B Vision', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true } },
  { id: 'accounts/fireworks/models/mixtral-8x7b-instruct', label: 'Mixtral 8x7B', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true } },
  { id: 'accounts/fireworks/models/deepseek-r1', label: 'DeepSeek R1', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true }, reasoning: true },
  { id: 'accounts/fireworks/models/flux-1-dev-fp8', label: 'FLUX.1 Dev', kind: 'image', capabilities: { text: false, image: true, vision: false, embeddings: false, speech: false, tools: false } },
  { id: 'accounts/fireworks/models/stable-diffusion-xl-1024', label: 'Stable Diffusion XL', kind: 'image', capabilities: { text: false, image: true, vision: false, embeddings: false, speech: false, tools: false } },
  { id: 'nomic-ai/text-embed-v2-moushikada-lora', label: 'Text Embed v2', kind: 'embedding', dimension: 768, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
];

const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';

export class FireworksAdapter implements AIProviderAdapter {
  readonly identifier = 'fireworks';
  readonly name = 'Fireworks AI';
  // Hub: inference platform hosting many open-weight models (not a model maker).
  readonly type = 'hub' as const;
  readonly credentialFields = FIREWORKS_CREDENTIAL_FIELDS;
  readonly capabilities = FIREWORKS_CAPABILITIES;
  readonly privacy = {
    dataRetention: 'Per Fireworks AI privacy policy — data not used for training',
    trainingOnData: false,
    description: 'Fireworks AI Inference API',
  };

  // 0.4: SSRF-safe fetch, injected by the provider module's create/validate.
  private _safeFetch?: SafeFetchPort;

  setSafeFetch(fetch: SafeFetchPort): void {
    this._safeFetch = fetch;
  }

  private _buildProvider(creds: Record<string, string>) {
    return createFireworks({ apiKey: creds.apiKey });
  }

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    return FIREWORKS_MODELS;
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) return { ok: false, error: 'API key is required' };
    // 0.4: only over the SSRF-safe fetch — never the global fetch.
    if (!this._safeFetch) return { ok: false, error: 'cannot validate' };
    try {
      const response = await this._safeFetch(`${FIREWORKS_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${creds.apiKey}` },
      });
      if (response.ok) return { ok: true };
      const errorText = await response.text().catch(() => '');
      return { ok: false, error: `API error: ${response.status} ${errorText}` };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Unknown error' };
    }
  }

  /** @note fireworks SDK returns specificationVersion "v3" — cast through unknown to satisfy the v2 interface */
  createLanguageModel(creds: Record<string, string>, modelId: string, _opts?: AIModelOptions): LanguageModelV2 {
    return this._buildProvider(creds).languageModel(modelId) as unknown as LanguageModelV2;
  }

  createLangchainModel(creds: Record<string, string>, modelId: string, opts?: AIModelOptions): BaseChatModel {
    return new ChatOpenAI({
      openAIApiKey: creds.apiKey,
      configuration: { baseURL: FIREWORKS_BASE_URL },
      model: modelId,
      temperature: opts?.temperature,
      topP: opts?.topP,
      maxTokens: opts?.maxTokens,
    });
  }

  /** @note fireworks SDK returns specificationVersion "v3" */
  createImageModel(creds: Record<string, string>, modelId: string): ImageModelV2 | undefined {
    return this._buildProvider(creds).imageModel?.(modelId) as unknown as ImageModelV2 | undefined;
  }

  /** @note fireworks SDK returns specificationVersion "v3" */
  createEmbeddingModel(creds: Record<string, string>, modelId: string): EmbeddingModelV2<string> | undefined {
    return this._buildProvider(creds).textEmbeddingModel?.(modelId) as unknown as EmbeddingModelV2<string> | undefined;
  }
}

const adapter = new FireworksAdapter();

export const fireworksAiModule: ProviderModule<any, any> = {
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
