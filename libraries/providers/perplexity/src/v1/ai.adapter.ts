import { createPerplexity } from '@ai-sdk/perplexity';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LanguageModelV2 } from '@ai-sdk/provider-v5';
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

const PERPLEXITY_CAPABILITIES: AICapabilities = {
  text: true,
  image: false,
  vision: false,
  embeddings: false,
  speech: false,
  tools: true,
};

const PERPLEXITY_CREDENTIAL_FIELDS: CredentialField[] = [
  { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'pplx-...' },
];

const PERPLEXITY_MODELS: ModelInfo[] = [
  { id: 'sonar-pro', label: 'Sonar Pro', kind: 'text', capabilities: PERPLEXITY_CAPABILITIES },
  { id: 'sonar', label: 'Sonar', kind: 'text', capabilities: PERPLEXITY_CAPABILITIES },
  { id: 'sonar-reasoning-pro', label: 'Sonar Reasoning Pro', kind: 'text', capabilities: PERPLEXITY_CAPABILITIES, reasoning: true },
  { id: 'sonar-reasoning', label: 'Sonar Reasoning', kind: 'text', capabilities: PERPLEXITY_CAPABILITIES, reasoning: true },
  { id: 'sonar-deep-research', label: 'Sonar Deep Research', kind: 'text', capabilities: PERPLEXITY_CAPABILITIES },
];

const PERPLEXITY_BASE_URL = 'https://api.perplexity.ai';

export class PerplexityAdapter implements AIProviderAdapter {
  readonly identifier = 'perplexity';
  readonly name = 'Perplexity';
  readonly type = 'direct' as const;
  readonly credentialFields = PERPLEXITY_CREDENTIAL_FIELDS;
  readonly capabilities = PERPLEXITY_CAPABILITIES;
  readonly privacy = {
    dataRetention: 'Per Perplexity privacy policy — data not used for training by default',
    trainingOnData: false,
    description: 'Perplexity API',
  };

  // 0.4: SSRF-safe fetch, injected by the provider module's create/validate.
  private _safeFetch?: SafeFetchPort;

  setSafeFetch(fetch: SafeFetchPort): void {
    this._safeFetch = fetch;
  }

  private _buildProvider(creds: Record<string, string>) {
    return createPerplexity({ apiKey: creds.apiKey });
  }

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    return PERPLEXITY_MODELS;
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) return { ok: false, error: 'API key is required' };
    // 0.4: only over the SSRF-safe fetch — never the global fetch.
    if (!this._safeFetch) return { ok: false, error: 'cannot validate' };
    try {
      const response = await this._safeFetch(`${PERPLEXITY_BASE_URL}/models`, {
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
      configuration: { baseURL: PERPLEXITY_BASE_URL },
      model: modelId,
      temperature: opts?.temperature,
      topP: opts?.topP,
      maxTokens: opts?.maxTokens,
    });
  }
}

const adapter = new PerplexityAdapter();

export const perplexityAiModule: ProviderModule<any, any> = {
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
