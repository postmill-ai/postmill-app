import { createXai } from '@ai-sdk/xai';
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

const XAI_CAPABILITIES: AICapabilities = {
  text: true,
  image: false,
  vision: true,
  embeddings: false,
  speech: false,
  tools: true,
};

const XAI_CREDENTIAL_FIELDS: CredentialField[] = [
  { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'xai-...' },
];

const XAI_MODELS: ModelInfo[] = [
  { id: 'grok-3-reasoning', label: 'Grok 3 Reasoning', kind: 'text', capabilities: XAI_CAPABILITIES, reasoning: true },
  { id: 'grok-4', label: 'Grok 4', kind: 'text', capabilities: XAI_CAPABILITIES },
  { id: 'grok-4-mini', label: 'Grok 4 Mini', kind: 'text', capabilities: XAI_CAPABILITIES },
  { id: 'grok-2-1212', label: 'Grok 2', kind: 'text', capabilities: { ...XAI_CAPABILITIES, vision: false } },
  { id: 'grok-2-vision-1212', label: 'Grok 2 Vision', kind: 'text', capabilities: { ...XAI_CAPABILITIES, vision: true } },
  { id: 'grok-beta', label: 'Grok Beta', kind: 'text', capabilities: { ...XAI_CAPABILITIES, vision: false } },
  { id: 'grok-vision-beta', label: 'Grok Vision Beta', kind: 'text', capabilities: { ...XAI_CAPABILITIES, vision: true } },
];

const XAI_BASE_URL = 'https://api.x.ai/v1';

export class XaiAdapter implements AIProviderAdapter {
  readonly identifier = 'xai';
  readonly name = 'xAI Grok';
  readonly type = 'direct' as const;
  readonly credentialFields = XAI_CREDENTIAL_FIELDS;
  readonly capabilities = XAI_CAPABILITIES;
  readonly privacy = {
    dataRetention: 'Per xAI privacy policy',
    trainingOnData: true,
    description: 'xAI Grok API',
  };

  // 0.4: SSRF-safe fetch, injected by the provider module's create/validate.
  private _safeFetch?: SafeFetchPort;

  setSafeFetch(fetch: SafeFetchPort): void {
    this._safeFetch = fetch;
  }

  private _buildProvider(creds: Record<string, string>) {
    return createXai({ apiKey: creds.apiKey });
  }

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    return XAI_MODELS;
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) return { ok: false, error: 'API key is required' };
    // 0.4: only over the SSRF-safe fetch — never the global fetch.
    if (!this._safeFetch) return { ok: false, error: 'cannot validate' };
    try {
      const response = await this._safeFetch(`${XAI_BASE_URL}/models`, {
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
      configuration: { baseURL: XAI_BASE_URL },
      model: modelId,
      temperature: opts?.temperature,
      topP: opts?.topP,
      maxTokens: opts?.maxTokens,
    });
  }
}

const adapter = new XaiAdapter();

export const xaiAiModule: ProviderModule<any, any> = {
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
