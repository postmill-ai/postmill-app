import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { metadata as providerMetadata } from './metadata';
import {
  type AiCapability as AIProviderAdapter,
  type AiCredentialField as CredentialField,
  type AiModelInfo as ModelInfo,
  type AiCapabilities as AICapabilities,
  type AiModelOptions as AIModelOptions,
  type LanguageModel,
  type ImageModel,
  type EmbeddingModel,
  type ProviderModule,
} from '@gitroom/provider-kernel';

export class OpenRouterAdapter implements AIProviderAdapter {
  private _providerCache = new Map<string, ReturnType<typeof createOpenRouter>>();

  private _getProvider(creds: Record<string, string>) {
    const key = `${creds.apiKey}||${creds.baseURL || ''}`;
    let provider = this._providerCache.get(key);
    if (!provider) {
      provider = createOpenRouter({
        apiKey: creds.apiKey,
        baseURL: creds.baseURL || undefined,
      });
      this._providerCache.set(key, provider);
    }
    return provider;
  }

  readonly identifier = 'openrouter';
  readonly name = 'OpenRouter';
  readonly type = 'hub' as const;
  readonly credentialFields: CredentialField[] = [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'sk-or-...' },
    { key: 'baseURL', label: 'Base URL', type: 'string', required: false, placeholder: 'https://openrouter.ai/api/v1' },
  ];
  readonly capabilities: AICapabilities = { text: true, image: true, vision: true, embeddings: true, speech: true, tools: true };
  readonly privacy = {
    dataRetention: 'Varies by provider — review OpenRouter and the upstream provider\'s data policy',
    trainingOnData: false,
    zeroRetention: true,
    description: 'OpenRouter API — unified gateway to 200+ models with model fallback, provider routing, and usage accounting',
  };

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    return [
      { id: 'openai/gpt-4o', label: 'OpenAI GPT-4o', kind: 'text', capabilities: { text: true, image: true, vision: true, embeddings: false, speech: false, tools: true } },
      { id: 'openai/gpt-4o-mini', label: 'OpenAI GPT-4o Mini', kind: 'text', capabilities: { text: true, image: true, vision: true, embeddings: false, speech: false, tools: true } },
      { id: 'openai/o3-mini', label: 'OpenAI o3-mini', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true }, reasoning: true },
      { id: 'anthropic/claude-sonnet-4-20250514', label: 'Anthropic Claude Sonnet 4', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true } },
      { id: 'anthropic/claude-3-5-haiku-20241022', label: 'Anthropic Claude 3.5 Haiku', kind: 'text', capabilities: { text: true, image: true, vision: true, embeddings: false, speech: false, tools: true } },
      { id: 'google/gemini-2.0-flash-001', label: 'Google Gemini 2.0 Flash', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true } },
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout', kind: 'text', capabilities: { text: true, image: true, vision: true, embeddings: false, speech: false, tools: true } },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek V3', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true } },
      { id: 'mistralai/mistral-large-2411', label: 'Mistral Large', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true } },
      { id: 'openai/text-embedding-3-small', label: 'OpenAI Embedding 3 Small', kind: 'embedding', dimension: 1536, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
      { id: 'openai/text-embedding-3-large', label: 'OpenAI Embedding 3 Large', kind: 'embedding', dimension: 3072, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
    ];
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) return { ok: false, error: 'API key is required' };
    try {
      const provider = this._getProvider(creds);
      const model = provider.languageModel('openai/gpt-4o-mini');
      await (model as any).doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text' as const, text: 'ping' }] }],
        maxOutputTokens: 1,
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Unknown error' };
    }
  }

  createLanguageModel(creds: Record<string, string>, modelId: string, _opts?: AIModelOptions): LanguageModel {
    return this._getProvider(creds).languageModel(modelId) as unknown as LanguageModel;
  }

  createLangchainModel(creds: Record<string, string>, modelId: string, opts?: AIModelOptions): BaseChatModel {
    if (!modelId.startsWith('openai/')) {
      throw new Error(`Only OpenAI-compatible models support LangChain mode through OpenRouter (got: "${modelId}")`);
    }
    return new ChatOpenAI({
      openAIApiKey: creds.apiKey,
      configuration: { baseURL: creds.baseURL || 'https://openrouter.ai/api/v1' },
      model: modelId,
      temperature: opts?.temperature,
      topP: opts?.topP,
      maxTokens: opts?.maxTokens,
    });
  }

  createImageModel(creds: Record<string, string>, modelId: string): ImageModel | undefined {
    return this._getProvider(creds).imageModel?.(modelId) as unknown as ImageModel | undefined;
  }

  createEmbeddingModel(creds: Record<string, string>, modelId: string): EmbeddingModel | undefined {
    return this._getProvider(creds).textEmbeddingModel?.(modelId) as unknown as EmbeddingModel | undefined;
  }
}

const adapter = new OpenRouterAdapter();

export const openrouterAiModule: ProviderModule<any, any> = {
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
  create: () => adapter as any,
  validateCredentials: async (ctx) => adapter.validateCredentials(ctx.credentials),
};
