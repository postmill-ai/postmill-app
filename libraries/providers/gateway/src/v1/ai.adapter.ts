import { createGateway } from '@ai-sdk/gateway';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { metadata as providerMetadata } from './metadata';
import {
  BoundedProviderCache,
  type AiCapability as AIProviderAdapter,
  type AiCredentialField as CredentialField,
  type AiModelInfo as ModelInfo,
  type AiCapabilities as AICapabilities,
  type AiModelOptions as AIModelOptions,
  type LanguageModel,
  type EmbeddingModel,
  type ImageModel,
  type ProviderModule,
} from '@gitroom/provider-kernel';

export class GatewayAdapter implements AIProviderAdapter {
  // 4.11: bounded LRU so rotated keys age out instead of being retained forever.
  private _gatewayCache = new BoundedProviderCache<ReturnType<typeof createGateway>>();

  private _getGateway(creds: Record<string, string>) {
    const key = `${creds.apiKey}||${creds.baseURL || ''}`;
    let gw = this._gatewayCache.get(key);
    if (!gw) {
      gw = createGateway({ apiKey: creds.apiKey, baseURL: creds.baseURL || undefined });
      this._gatewayCache.set(key, gw);
    }
    return gw;
  }

  readonly identifier = 'gateway';
  readonly name = 'Vercel AI';
  readonly type = 'hub' as const;
  readonly credentialFields: CredentialField[] = [
    { key: 'apiKey', label: 'Gateway API Key', type: 'password', required: true, placeholder: 'gw_...' },
    // Optional — the Vercel AI Gateway SDK defaults the endpoint when omitted.
    { key: 'baseURL', label: 'Gateway Base URL', type: 'string', required: false, placeholder: 'https://ai-gateway.vercel.sh/v1/ai' },
  ];
  readonly capabilities: AICapabilities = { text: true, image: true, vision: true, embeddings: true, speech: true, tools: true };
  readonly privacy = { dataRetention: 'Managed by your gateway policy', trainingOnData: false, description: 'Vercel AI — unified API gateway with caching, rate limiting, and observability' };

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    return [
      { id: 'openai/gpt-4o', label: 'OpenAI GPT-4o', kind: 'text', capabilities: { text: true, image: true, vision: true, embeddings: false, speech: false, tools: true } },
      { id: 'openai/gpt-4o-mini', label: 'OpenAI GPT-4o Mini', kind: 'text', capabilities: { text: true, image: true, vision: true, embeddings: false, speech: false, tools: true } },
      { id: 'anthropic/claude-sonnet-4-20250514', label: 'Anthropic Claude Sonnet 4', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true } },
      { id: 'openai/text-embedding-3-small', label: 'OpenAI Embedding 3 Small', kind: 'embedding', dimension: 1536, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
    ];
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) return { ok: false, error: 'API key is required' };
    // 5.15: cheap authenticated metadata call (getAvailableModels) instead of a
    // paid `doGenerate` ping — verifies the key without running billable inference.
    try {
      const provider = createGateway({
        apiKey: creds.apiKey,
        baseURL: creds.baseURL || undefined,
      });
      await (provider as any).getAvailableModels();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Unknown error' };
    }
  }

  /**
   * createLanguageModel wraps the Gateway provider's languageModel method.
   * @ai-sdk/gateway returns specificationVersion "v3" but our interface expects "v2".
   * The cast through `unknown` is necessary because the two types don't structurally overlap
   * on the specificationVersion discriminant, but at runtime the object is API-compatible.
   */
  createLanguageModel(creds: Record<string, string>, modelId: string, _opts?: AIModelOptions): LanguageModel {
    return this._getGateway(creds).languageModel(modelId) as unknown as LanguageModel;
  }

  /**
   * createImageModel wraps the Gateway provider's optional imageModel method.
   * @ai-sdk/gateway returns specificationVersion "v3" — cast through unknown.
   */
  createImageModel(creds: Record<string, string>, modelId: string): ImageModel | undefined {
    return this._getGateway(creds).imageModel?.(modelId) as unknown as ImageModel | undefined;
  }

  /**
   * LangChain support is limited to OpenAI models routed through the Gateway.
   * Model IDs must be prefixed with "openai/" (e.g. "openai/gpt-4o").
   */
  createLangchainModel(creds: Record<string, string>, modelId: string, opts?: AIModelOptions): BaseChatModel {
    if (!modelId.startsWith('openai/')) {
      throw new Error(`Only OpenAI models routed through Gateway support LangChain mode (got: "${modelId}")`);
    }
    return new ChatOpenAI({
      openAIApiKey: creds.apiKey,
      configuration: { baseURL: creds.baseURL || undefined },
      model: modelId,
      temperature: opts?.temperature,
      topP: opts?.topP,
      maxTokens: opts?.maxTokens,
    });
  }

  /**
   * createEmbeddingModel wraps the Gateway provider's optional textEmbeddingModel method.
   * @ai-sdk/gateway returns specificationVersion "v3" — cast through unknown.
   */
  createEmbeddingModel(creds: Record<string, string>, modelId: string): EmbeddingModel | undefined {
    return this._getGateway(creds).textEmbeddingModel?.(modelId) as unknown as EmbeddingModel | undefined;
  }
}

const adapter = new GatewayAdapter();

export const gatewayAiModule: ProviderModule<any, any> = {
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
