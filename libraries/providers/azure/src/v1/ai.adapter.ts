import { createAzure } from '@ai-sdk/azure';
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
} from '@gitroom/provider-kernel';

const AZURE_CAPABILITIES: AICapabilities = {
  text: true,
  image: true,
  vision: true,
  embeddings: true,
  speech: false,
  tools: true,
};

const AZURE_CREDENTIAL_FIELDS: CredentialField[] = [
  { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: '...' },
  { key: 'resourceName', label: 'Azure Resource Name', type: 'string', required: true, placeholder: 'my-openai-resource' },
  { key: 'apiVersion', label: 'API Version', type: 'string', required: false, placeholder: '2024-10-01-preview' },
];

const AZURE_MODELS: ModelInfo[] = [
  { id: 'gpt-4o', label: 'GPT-4o', kind: 'text', capabilities: { ...AZURE_CAPABILITIES, image: true } },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', kind: 'text', capabilities: { ...AZURE_CAPABILITIES, image: true } },
  { id: 'gpt-4.1', label: 'GPT-4.1', kind: 'text', capabilities: { ...AZURE_CAPABILITIES, image: false, embeddings: false } },
  { id: 'text-embedding-3-small', label: 'Text Embedding 3 Small', kind: 'embedding', dimension: 1536, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
  { id: 'text-embedding-3-large', label: 'Text Embedding 3 Large', kind: 'embedding', dimension: 3072, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
];

export class AzureAdapter implements AIProviderAdapter {
  readonly identifier = 'azure';
  readonly name = 'Azure OpenAI';
  // Hub: hosts OpenAI (and other) models — a cloud aggregator, not a model maker.
  readonly type = 'hub' as const;
  readonly credentialFields = AZURE_CREDENTIAL_FIELDS;
  readonly capabilities = AZURE_CAPABILITIES;
  readonly privacy = {
    dataRetention: 'Data processed in your Azure subscription — governed by your Azure data policy',
    trainingOnData: false,
    description: 'Azure OpenAI Service — OpenAI models via Microsoft Azure',
  };

  private _buildProvider(creds: Record<string, string>) {
    return createAzure({
      apiKey: creds.apiKey,
      resourceName: creds.resourceName,
      apiVersion: creds.apiVersion || undefined,
    });
  }

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    return AZURE_MODELS;
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) return { ok: false, error: 'API key is required' };
    if (!creds.resourceName) return { ok: false, error: 'Azure resource name is required' };
    try {
      const provider = this._buildProvider(creds);
      const model = provider.languageModel('gpt-4o-mini');
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
    throw new Error('Azure OpenAI LangChain integration is not installed. Use languageModel() instead.');
  }

  createImageModel(creds: Record<string, string>, modelId: string): ImageModelV2 | undefined {
    return this._buildProvider(creds).imageModel?.(modelId) as ImageModelV2 | undefined;
  }

  createEmbeddingModel(creds: Record<string, string>, modelId: string): EmbeddingModelV2<string> | undefined {
    return this._buildProvider(creds).textEmbeddingModel?.(modelId) as EmbeddingModelV2<string> | undefined;
  }
}

const adapter = new AzureAdapter();

export const azureAiModule: ProviderModule<any, any> = {
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
