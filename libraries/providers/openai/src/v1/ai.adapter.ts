import { createOpenAI } from '@ai-sdk/openai';
import { ChatOpenAI } from '@langchain/openai';

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LanguageModelV2, ImageModelV2, EmbeddingModelV2, SpeechModelV2 } from '@ai-sdk/provider-v5';
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

const OPENAI_CAPABILITIES: AICapabilities = {
  text: true,
  image: true,
  vision: true,
  embeddings: true,
  speech: true,
  tools: true,
};

const OPENAI_CREDENTIAL_FIELDS: CredentialField[] = [
  {
    key: 'apiKey',
    label: 'API Key',
    type: 'password',
    required: true,
    placeholder: 'sk-...',
  },
  {
    key: 'baseURL',
    label: 'Base URL',
    type: 'string',
    required: false,
    placeholder: 'https://api.openai.com/v1',
  },
  {
    key: 'organization',
    label: 'Organization ID',
    type: 'string',
    required: false,
    placeholder: 'org-...',
  },
];

const OPENAI_MODELS: ModelInfo[] = [
  { id: 'gpt-4.1', label: 'GPT-4.1', kind: 'text', capabilities: { ...OPENAI_CAPABILITIES, text: true, image: false, embeddings: false, speech: false } },
  { id: 'gpt-4o', label: 'GPT-4o', kind: 'text', capabilities: { ...OPENAI_CAPABILITIES, image: true } },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', kind: 'text', capabilities: { ...OPENAI_CAPABILITIES, image: true } },
  { id: 'gpt-5.2', label: 'GPT-5.2', kind: 'text', capabilities: { ...OPENAI_CAPABILITIES, image: true } },
  { id: 'o3', label: 'o3', kind: 'text', capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true }, reasoning: true },
  { id: 'chatgpt-image-latest', label: 'ChatGPT Image (DALL·E)', kind: 'image', capabilities: { text: false, image: true, vision: false, embeddings: false, speech: false, tools: false } },
  { id: 'dall-e-3', label: 'DALL·E 3', kind: 'image', capabilities: { text: false, image: true, vision: false, embeddings: false, speech: false, tools: false } },
  { id: 'dall-e-2', label: 'DALL·E 2', kind: 'image', capabilities: { text: false, image: true, vision: false, embeddings: false, speech: false, tools: false } },
  { id: 'text-embedding-3-small', label: 'Text Embedding 3 Small', kind: 'embedding', dimension: 1536, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
  { id: 'text-embedding-3-large', label: 'Text Embedding 3 Large', kind: 'embedding', dimension: 3072, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
  { id: 'text-embedding-ada-002', label: 'Text Embedding Ada 002', kind: 'embedding', dimension: 1536, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
  { id: 'tts-1', label: 'TTS-1', kind: 'text', capabilities: { text: false, image: false, vision: false, embeddings: false, speech: true, tools: false } },
  { id: 'tts-1-hd', label: 'TTS-1 HD', kind: 'text', capabilities: { text: false, image: false, vision: false, embeddings: false, speech: true, tools: false } },
  { id: 'whisper-1', label: 'Whisper-1', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: true, tools: false } },
];

export class OpenAIAdapter implements AIProviderAdapter {
  readonly identifier = 'openai';
  readonly name = 'OpenAI';
  readonly type = 'direct' as const;
  readonly credentialFields = OPENAI_CREDENTIAL_FIELDS;
  readonly capabilities = OPENAI_CAPABILITIES;
  readonly privacy = {
    dataRetention: 'API data may be retained for up to 30 days per OpenAI policy',
    trainingOnData: false,
    zeroRetention: true,
    description: 'OpenAI API — data not used for training by default',
  };

  // 0.4: SSRF-safe fetch, injected by the provider module's create(ctx). baseURL
  // is a free-text credential; without the safe fetch we must not validate it.
  private _safeFetch?: SafeFetchPort;

  /** Inject the SSRF-safe fetch (called from the provider module's create/validate). */
  setSafeFetch(fetch: SafeFetchPort): void {
    this._safeFetch = fetch;
  }

  private _buildProvider(creds: Record<string, string>) {
    return createOpenAI({
      apiKey: creds.apiKey,
      baseURL: creds.baseURL || undefined,
      organization: creds.organization || undefined,
    });
  }

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    return OPENAI_MODELS;
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) {
      return { ok: false, error: 'API key is required' };
    }
    // 0.4: only over the SSRF-safe fetch — never the global fetch on a tenant baseURL.
    if (!this._safeFetch) return { ok: false, error: 'cannot validate' };
    const baseURL = (creds.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    // 5.15: cheap authenticated GET /models — no paid-generation fallback.
    // safeFetch throws on an SSRF/private URL; let it propagate.
    const response = await this._safeFetch(`${baseURL}/models`, {
      headers: { Authorization: `Bearer ${creds.apiKey}` },
    });
    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }
    return { ok: false, error: `Unexpected response: ${response.status}` };
  }

  createLanguageModel(
    creds: Record<string, string>,
    modelId: string,
    _opts?: AIModelOptions,
  ): LanguageModelV2 {
    const provider = this._buildProvider(creds);
    // Pin to the Chat Completions API. In @ai-sdk/openai v2, `.languageModel()` defaults to the
    // Responses API, which rejects the `{ type: 'text' }` message parts that AIModelProvider
    // hand-builds for the low-level doGenerate() call (400: "Invalid value: 'text'. Supported
    // values are 'input_text', …"). Chat Completions accepts that format, so every generateText/
    // generateObject/vision call works (the Daily Brief and all utility AI were 400ing otherwise).
    return provider.chat(modelId);
  }

  createLangchainModel(
    creds: Record<string, string>,
    modelId: string,
    opts?: AIModelOptions,
  ): BaseChatModel {
    return new ChatOpenAI({
      openAIApiKey: creds.apiKey,
      configuration: {
        baseURL: creds.baseURL || undefined,
        organization: creds.organization || undefined,
      },
      model: modelId,
      temperature: opts?.temperature,
      topP: opts?.topP,
      maxTokens: opts?.maxTokens,
    });
  }

  createImageModel(
    creds: Record<string, string>,
    modelId: string,
  ): ImageModelV2 | undefined {
    const provider = this._buildProvider(creds);
    return provider.imageModel?.(modelId);
  }

  createEmbeddingModel(
    creds: Record<string, string>,
    modelId: string,
  ): EmbeddingModelV2<string> | undefined {
    const provider = this._buildProvider(creds);
    return provider.textEmbeddingModel?.(modelId);
  }

  createSpeechModel(
    creds: Record<string, string>,
    modelId: string,
  ): SpeechModelV2 | undefined {
    const provider = this._buildProvider(creds);
    return provider.speechModel?.(modelId);
  }
}

const adapter = new OpenAIAdapter();

export const openaiAiModule: ProviderModule<any, any> = {
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
