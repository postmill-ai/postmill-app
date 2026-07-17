import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { FeatureFlagsService } from '@gitroom/nestjs-libraries/feature-flags';
import { setAiRegistry, AiCapability } from '@gitroom/provider-kernel';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';

// The media provider adapter implementations live in their relocated packages
// (`libraries/providers/<id>/src/v1/media.adapter.ts`) and are registered into the
// ProviderKernel by ProvidersBootstrap (apps/backend) — see
// apps/backend/src/providers.bootstrap.ts. MediaModule only bridges the AI providers
// to the AI-SDK-delegated media adapters (Bedrock/Azure/Gateway) via the kernel
// `setAiRegistry` static injection, resolving AI image models through the kernel.
@Module({})
export class MediaModule implements OnModuleInit {
  private readonly _logger = new Logger(MediaModule.name);

  constructor(
    private readonly _flags: FeatureFlagsService,
    // AI hub media adapters (Bedrock/Azure/Gateway) delegate image generation to the
    // existing AI-SDK provider adapters; resolve those through the ProviderKernel.
    private readonly _resolution: ProviderResolutionService,
  ) {}

  onModuleInit() {
    if (this._flags.isDisabled('media')) {
      this._logger.log('Media module is disabled via DEV_DISABLE_MEDIA; skipping AI-SDK media bridge');
      return;
    }

    // Bridge the kernel `AiImageRegistry` shape to ProviderResolutionService so the
    // AI-SDK media adapters reach AI image models without a legacy in-memory AI registry.
    setAiRegistry({
      getAdapter: (id: string): AiCapability | undefined => {
        try {
          return this._resolution.resolveAI(id);
        } catch {
          return undefined;
        }
      },
    });
  }
}
