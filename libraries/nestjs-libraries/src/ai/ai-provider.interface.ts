// The AI provider contract is owned by the kernel
// (`libraries/providers/kernel/src/domains/ai.ts`). This file re-exports the
// kernel types under their legacy names so existing consumers keep their import
// paths (`@gitroom/nestjs-libraries/ai/ai-provider.interface`).
export type {
  LanguageModel,
  ImageModel,
  EmbeddingModel,
  SpeechModel,
  AiProviderType as AIProviderType,
  AiCredentialField as CredentialField,
  AiModelInfo as ModelInfo,
  AiCapabilities as AICapabilities,
  AiModelOptions as AIModelOptions,
  AiScope as AIScope,
  AiCapability as AIProviderAdapter,
} from '@gitroom/provider-kernel';
