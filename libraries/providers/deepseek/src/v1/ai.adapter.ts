import { createDeepSeek } from '@ai-sdk/deepseek';
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

const DEEPSEEK_CAPABILITIES: AICapabilities = {
  text: true,
  image: false,
  vision: false,
  embeddings: false,
  speech: false,
  tools: true,
};

const DEEPSEEK_CREDENTIAL_FIELDS: CredentialField[] = [
  { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'sk-...' },
];

const DEEPSEEK_MODELS: ModelInfo[] = [
  { id: 'deepseek-chat', label: 'DeepSeek-V3', kind: 'text', capabilities: DEEPSEEK_CAPABILITIES },
  { id: 'deepseek-reasoner', label: 'DeepSeek-R1', kind: 'text', capabilities: DEEPSEEK_CAPABILITIES, reasoning: true },
];

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

export class DeepSeekAdapter implements AIProviderAdapter {
  readonly identifier = 'deepseek';
  readonly name = 'DeepSeek';
  readonly type = 'direct' as const;
  readonly credentialFields = DEEPSEEK_CREDENTIAL_FIELDS;
  readonly capabilities = DEEPSEEK_CAPABILITIES;
  readonly privacy = {
    dataRetention: 'Per DeepSeek privacy policy',
    trainingOnData: true,
    description: 'DeepSeek API',
  };

  // 0.4: SSRF-safe fetch, injected by the provider module's create/validate.
  private _safeFetch?: SafeFetchPort;

  setSafeFetch(fetch: SafeFetchPort): void {
    this._safeFetch = fetch;
  }

  private _buildProvider(creds: Record<string, string>) {
    return createDeepSeek({ apiKey: creds.apiKey });
  }

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    return DEEPSEEK_MODELS;
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) return { ok: false, error: 'API key is required' };
    // 0.4: only over the SSRF-safe fetch — never the global fetch.
    if (!this._safeFetch) return { ok: false, error: 'cannot validate' };
    try {
      const response = await this._safeFetch(`${DEEPSEEK_BASE_URL}/models`, {
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
      configuration: { baseURL: DEEPSEEK_BASE_URL },
      model: modelId,
      temperature: opts?.temperature,
      topP: opts?.topP,
      maxTokens: opts?.maxTokens,
    });
  }
}

const adapter = new DeepSeekAdapter();

export const deepseekAiModule: ProviderModule<any, any> = {
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
