import { Module, Global } from '@nestjs/common';
import { AIModelProvider } from './ai-model.provider';
import { TelemetryService } from './governance/telemetry.service';
import { ProviderHealthService } from './governance/provider-health.service';
import { RagService } from './governance/rag.service';
import { BudgetService } from './governance/budget.service';
import { GuardrailService } from './governance/guardrail.service';
import { AiMediaService } from './governance/media.service';
import { SemanticCacheService } from './governance/semantic-cache.service';
import { ModelRouterService } from './governance/model-router.service';
import { CircuitBreakerService } from './governance/circuit-breaker.service';
import { ToolFirewallService } from './governance/tool-firewall.service';
import { IdempotencyFactory } from './governance/idempotency.factory';
import { OrgAiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service';
import { OrgAiSettingsRepository } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.repository';
import { OrgDefaultModelRepository } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/org-default-model.repository';
import { DefaultsResolutionService } from './defaults/defaults-resolution.service';
import { DefaultsSeedService } from './defaults/defaults-seed.service';
import { AiDefaultsService } from './defaults/ai-defaults.service';
import { DefaultsSettingsValidator } from './defaults/defaults-settings.validator';
import { MediaDefaultsService } from './defaults/media-defaults.service';
import { SlideService } from '@postmill-ai/nestjs-libraries/media/slide/slide.service';
import { CaptionService } from '@postmill-ai/nestjs-libraries/media/caption/caption.service';

@Global()
@Module({
  providers: [
    AIModelProvider,
    TelemetryService,
    ProviderHealthService,
    BudgetService,
    GuardrailService,
    AiMediaService,
    RagService,
    SemanticCacheService,
    ModelRouterService,
    CircuitBreakerService,
    ToolFirewallService,
    IdempotencyFactory,
    OrgAiSettingsService,
    OrgAiSettingsRepository,
    OrgDefaultModelRepository,
    DefaultsResolutionService,
    DefaultsSeedService,
    AiDefaultsService,
    MediaDefaultsService,
    DefaultsSettingsValidator,
    SlideService,
    CaptionService,
  ],
  exports: [
    AIModelProvider,
    TelemetryService,
    ProviderHealthService,
    BudgetService,
    GuardrailService,
    AiMediaService,
    RagService,
    SemanticCacheService,
    ModelRouterService,
    CircuitBreakerService,
    ToolFirewallService,
    IdempotencyFactory,
    OrgAiSettingsService,
    OrgAiSettingsRepository,
    OrgDefaultModelRepository,
    DefaultsResolutionService,
    DefaultsSeedService,
    AiDefaultsService,
    MediaDefaultsService,
    DefaultsSettingsValidator,
    SlideService,
    CaptionService,
  ],
})
// AI provider adapters are registered into the ProviderKernel by
// ProvidersBootstrap from the relocated provider packages
// (`libraries/providers/<id>/src/v1/ai.adapter.ts`). The bootstrap loop
// respects the `ai` feature-flag gate, so a DEV_DISABLE_AI deployment leaves
// the kernel empty exactly as before.
export class AiModule {}
