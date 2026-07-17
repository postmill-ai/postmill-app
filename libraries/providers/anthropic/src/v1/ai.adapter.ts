import { createAnthropic } from '@ai-sdk/anthropic';

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatAnthropic } from '@langchain/anthropic';
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

export class AnthropicAdapter implements AIProviderAdapter {
  readonly identifier = 'anthropic';
  readonly name = 'Anthropic Claude';
  readonly type = 'direct' as const;
  readonly credentialFields: CredentialField[] = [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'sk-ant-...' },
  ];
  readonly capabilities: AICapabilities = { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true };
  readonly privacy = { dataRetention: 'API data may be used for training; opt out via API request', trainingOnData: true, description: 'Anthropic API' };

  // 0.4: SSRF-safe fetch, injected by the provider module's create/validate.
  private _safeFetch?: SafeFetchPort;

  setSafeFetch(fetch: SafeFetchPort): void {
    this._safeFetch = fetch;
  }

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    // 2.5: current live model IDs only — the previous catalog carried
    // `claude-4-20250514` (never existed), `claude-3-opus-20240229` (retired),
    // and `claude-3-5-sonnet-20241022` (retired 404), with the sole `reasoning`
    // flag on the retired opus, so high-reasoning auto-pick chose a dead model.
    return [
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true }, reasoning: true },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true } },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true } },
    ];
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) return { ok: false, error: 'API key is required' };
    // 0.4: only over the SSRF-safe fetch — never the global fetch.
    if (!this._safeFetch) return { ok: false, error: 'cannot validate' };
    try {
      const response = await this._safeFetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': creds.apiKey,
          'anthropic-version': '2023-06-01',
        },
      });
      if (response.ok) return { ok: true };
      const errorText = await response.text().catch(() => '');
      return { ok: false, error: `API error: ${response.status} ${errorText}` };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Unknown error' };
    }
  }

  createLanguageModel(creds: Record<string, string>, modelId: string, _opts?: AIModelOptions): LanguageModelV2 {
    return createAnthropic({ apiKey: creds.apiKey }).languageModel(modelId);
  }

  createLangchainModel(creds: Record<string, string>, modelId: string, opts?: AIModelOptions): BaseChatModel {
    return new ChatAnthropic({ anthropicApiKey: creds.apiKey, model: modelId, temperature: opts?.temperature, maxTokens: opts?.maxTokens });
  }

  createImageModel(): undefined {
    return undefined;
  }

  createEmbeddingModel(): undefined {
    return undefined;
  }

  createSpeechModel(): undefined {
    return undefined;
  }
}

const adapter = new AnthropicAdapter();

export const anthropicAiModule: ProviderModule<any, any> = {
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
