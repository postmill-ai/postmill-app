import type {
  LanguageModelV2,
  ImageModelV2,
  EmbeddingModelV2,
  SpeechModelV2,
} from '@ai-sdk/provider-v5';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

export type LanguageModel = LanguageModelV2;
export type ImageModel = ImageModelV2;
export type EmbeddingModel = EmbeddingModelV2<string>;
export type SpeechModel = SpeechModelV2;

export type AiProviderType = 'hub' | 'direct';

export interface AiModelOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

export interface AiCapabilities {
  text: boolean;
  image: boolean;
  vision: boolean;
  embeddings: boolean;
  speech: boolean;
  tools: boolean;
}

export interface AiModelInfo {
  id: string;
  label: string;
  kind: 'text' | 'image' | 'embedding';
  dimension?: number;
  capabilities: AiCapabilities;
  reasoning?: boolean;
}

export interface AiPrivacyInfo {
  dataRetention: string;
  trainingOnData: boolean;
  zeroRetention?: boolean;
  description: string;
}

export interface AiCredentialField {
  key: string;
  label: string;
  type: 'string' | 'password' | 'textarea' | 'select';
  required: boolean;
  options?: { label: string; value: string }[];
  placeholder?: string;
}

// When adding a new scope, update SURFACE_DEFAULTS in ai-model.provider.ts
// and the exhaustive checks in all switch statements.
export type AiScope = 'utility' | 'generator' | 'agent' | 'mcp';

export interface AiCredentialValidationResult {
  ok: boolean;
  error?: string;
}

export interface AiHealth {
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  successCount: number;
  errorCount: number;
  consecutiveErrors: number;
}

export interface AiCapability {
  readonly identifier: string;
  readonly name: string;
  readonly type: AiProviderType;
  readonly credentialFields: AiCredentialField[];
  readonly capabilities: AiCapabilities;
  readonly privacy?: AiPrivacyInfo;
  readonly health?: AiHealth;

  listModels(creds: Record<string, string>): Promise<AiModelInfo[]>;
  validateCredentials(
    creds: Record<string, string>,
  ): Promise<AiCredentialValidationResult>;

  createLanguageModel(
    creds: Record<string, string>,
    modelId: string,
    opts?: AiModelOptions,
  ): LanguageModel;
  createLangchainModel(
    creds: Record<string, string>,
    modelId: string,
    opts?: AiModelOptions,
  ): BaseChatModel;
  createImageModel?(
    creds: Record<string, string>,
    modelId: string,
  ): ImageModel | undefined;
  createEmbeddingModel?(
    creds: Record<string, string>,
    modelId: string,
  ): EmbeddingModel | undefined;
  createSpeechModel?(
    creds: Record<string, string>,
    modelId: string,
  ): SpeechModel | undefined;
}
