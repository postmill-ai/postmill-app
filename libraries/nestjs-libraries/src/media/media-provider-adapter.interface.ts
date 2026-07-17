// Single source of truth for these types is now the provider kernel
// (`libraries/providers/kernel/src/domains/media.ts`). They are re-exported here
// so existing consumers (services, registry, controllers, specs) keep their
// `@gitroom/nestjs-libraries/media/media-provider-adapter.interface` import path
// working unchanged. The legacy `MediaProviderAdapter` name maps to the kernel's
// `MediaCapability` (identical shape).
export type {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaArtifactMetadata,
  MediaGenerationResult,
  MediaInputValue,
  MediaCredentialField,
  MediaCredentialOptions,
  MediaGenerateOptions,
  MediaJobSubmission,
  MediaPollResult,
  MediaOperation,
  MediaModelOption,
} from '@gitroom/provider-kernel';

export { resolveApiKey } from '@gitroom/provider-kernel';
