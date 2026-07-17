import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
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

const BEDROCK_CAPABILITIES: AICapabilities = {
  text: true,
  image: true,
  vision: true,
  embeddings: true,
  speech: false,
  tools: true,
};

const BEDROCK_CREDENTIAL_FIELDS: CredentialField[] = [
  { key: 'region', label: 'AWS Region', type: 'string', required: true, placeholder: 'us-east-1' },
  { key: 'accessKeyId', label: 'AWS Access Key ID', type: 'string', required: true, placeholder: 'AKIA...' },
  { key: 'secretAccessKey', label: 'AWS Secret Access Key', type: 'password', required: true, placeholder: '...' },
  { key: 'sessionToken', label: 'AWS Session Token', type: 'password', required: false, placeholder: 'Optional temporary token' },
];

const BEDROCK_MODELS: ModelInfo[] = [
  { id: 'anthropic.claude-sonnet-4-20250514', label: 'Claude Sonnet 4', kind: 'text', capabilities: { ...BEDROCK_CAPABILITIES, image: false, embeddings: false } },
  { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', label: 'Claude 3.5 Sonnet v2', kind: 'text', capabilities: { ...BEDROCK_CAPABILITIES, image: false, embeddings: false } },
  { id: 'anthropic.claude-3-haiku-20240307-v1:0', label: 'Claude 3 Haiku', kind: 'text', capabilities: { ...BEDROCK_CAPABILITIES, image: false, embeddings: false } },
  { id: 'amazon.nova-lite-v1:0', label: 'Amazon Nova Lite', kind: 'text', capabilities: { ...BEDROCK_CAPABILITIES, image: true } },
  { id: 'amazon.nova-pro-v1:0', label: 'Amazon Nova Pro', kind: 'text', capabilities: { ...BEDROCK_CAPABILITIES, image: true } },
  { id: 'amazon.titan-embed-text-v2:0', label: 'Titan Embedding v2', kind: 'embedding', dimension: 1024, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
  { id: 'cohere.embed-english-v3', label: 'Cohere Embed English v3', kind: 'embedding', dimension: 1024, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
];

export class BedrockAdapter implements AIProviderAdapter {
  readonly identifier = 'bedrock';
  readonly name = 'Amazon Bedrock';
  // Hub: AWS aggregator fronting Anthropic/Meta/Mistral/Amazon/Cohere models.
  readonly type = 'hub' as const;
  readonly credentialFields = BEDROCK_CREDENTIAL_FIELDS;
  readonly capabilities = BEDROCK_CAPABILITIES;
  readonly privacy = {
    dataRetention: 'Data processed in your AWS account — governed by your AWS data policy',
    trainingOnData: false,
    description: 'Amazon Bedrock — managed foundation models via AWS',
  };

  private _buildProvider(creds: Record<string, string>) {
    return createAmazonBedrock({
      region: creds.region,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken || undefined,
    });
  }

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    return BEDROCK_MODELS;
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.region) return { ok: false, error: 'AWS region is required' };
    if (!creds.accessKeyId || !creds.secretAccessKey) return { ok: false, error: 'AWS credentials are required' };
    // 3.8/5.15: this is a PRESENCE-only check — it verifies the required fields
    // are filled in, NOT that the credentials actually authenticate. A wrong or
    // expired secret passes here and only fails at first real use. We accept
    // that reduced strength deliberately: Bedrock exposes no *free* auth probe
    // through the AI-SDK provider (a control-plane ListFoundationModels call
    // would require the AWS SDK / hand-rolled SigV4, which is not wired here),
    // and the previous `doGenerate` ping burned paid inference on every test.
    // The reduced strength is surfaced honestly to operators via the manifest
    // `setupNotes` below, so "Test connection" doesn't imply live verification.
    return { ok: true };
  }

  /** @note bedrock SDK returns specificationVersion "v1" — cast through unknown to satisfy the v2 interface */
  createLanguageModel(creds: Record<string, string>, modelId: string, _opts?: AIModelOptions): LanguageModelV2 {
    return this._buildProvider(creds).languageModel(modelId) as unknown as LanguageModelV2;
  }

  createLangchainModel(_creds: Record<string, string>, _modelId: string, _opts?: AIModelOptions): BaseChatModel {
    throw new Error('Amazon Bedrock LangChain integration is not installed. Use languageModel() instead.');
  }

  /** @note bedrock SDK returns specificationVersion "v1" */
  createImageModel(creds: Record<string, string>, modelId: string): ImageModelV2 | undefined {
    return this._buildProvider(creds).imageModel?.(modelId) as unknown as ImageModelV2 | undefined;
  }

  /** @note bedrock SDK returns specificationVersion "v1" */
  createEmbeddingModel(creds: Record<string, string>, modelId: string): EmbeddingModelV2<string> | undefined {
    return this._buildProvider(creds).textEmbeddingModel?.(modelId) as unknown as EmbeddingModelV2<string> | undefined;
  }
}

const adapter = new BedrockAdapter();

export const bedrockAiModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'ai',
    providerId: adapter.identifier,
    version: 'v1',
    displayName: adapter.name,
    status: 'active',
    credentialFields: (adapter as any).credentialFields || [],
    capabilities: (adapter as any).capabilities,
    // 3.8: Bedrock has no free authenticated probe, so "Test connection" only
    // checks that the fields are present — real credentials are verified on
    // first use. Tell operators so a passing test isn't mistaken for live auth.
    setupNotes:
      'Test connection only verifies the fields are present; AWS credentials are verified on first use.',
  },
  create: () => adapter as any,
  validateCredentials: async (ctx) => adapter.validateCredentials(ctx.credentials),
};
