import { Module, Global, OnModuleInit, NestModule, MiddlewareConsumer, RequestMethod, Logger } from '@nestjs/common';
import { AIModelProvider } from './ai-model.provider';
import { TelemetryService } from './governance/telemetry.service';
import { ProviderHealthService } from './governance/provider-health.service';
import { RagService } from './governance/rag.service';
import { BudgetService } from './governance/budget.service';
import { BudgetMiddleware } from './governance/budget.middleware';
import { GuardrailService } from './governance/guardrail.service';
import { AiMediaService } from './governance/media.service';
import { SemanticCacheService } from './governance/semantic-cache.service';
import { ModelRouterService } from './governance/model-router.service';
import { CircuitBreakerService } from './governance/circuit-breaker.service';
import { ToolFirewallService } from './governance/tool-firewall.service';
import { IdempotencyFactory } from './governance/idempotency.factory';
import { OrgAiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service';
import { OrgAiSettingsRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.repository';
import { OrgDefaultModelRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-default-model.repository';
import { DefaultsResolutionService } from './defaults/defaults-resolution.service';
import { DefaultsSeedService } from './defaults/defaults-seed.service';
import { AiDefaultsService } from './defaults/ai-defaults.service';
import { DefaultsSettingsValidator } from './defaults/defaults-settings.validator';
import { MediaDefaultsService } from './defaults/media-defaults.service';
import { SlideService } from '@gitroom/nestjs-libraries/media/slide/slide.service';
import { CaptionService } from '@gitroom/nestjs-libraries/media/caption/caption.service';

@Global()
@Module({
  providers: [
    AIModelProvider,
    TelemetryService,
    ProviderHealthService,
    BudgetService,
    BudgetMiddleware,
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
export class AiModule implements OnModuleInit, NestModule {
  private readonly _logger = new Logger(AiModule.name);

  configure(consumer: MiddlewareConsumer) {
    // MCP entrypoints are raw Express middleware in start.mcp.ts —
    // they are not Nest controllers. Budget enforcement for MCP routes
    // is handled inline in start.mcp.ts via BudgetService.
    consumer
      .apply(BudgetMiddleware)
      .forRoutes(
        // path-to-regexp v8 named-wildcard syntax (see api.module.ts note).
        { path: 'agents{/*splat}', method: RequestMethod.ALL },
        // NOTE: `posts/generator` is intentionally NOT gated here. Its budget check
        // lives in-service (AgentGraphService.start(), scope 'agent') so it also
        // covers the runGenerator MCP path and records/gates under one coherent
        // scope — the old middleware entry double-gated it under 'generator' (1.2).
        { path: 'copilot{/*splat}', method: RequestMethod.ALL },
      );
  }

  onModuleInit() {
    // AI provider adapters are registered into the ProviderKernel by
    // ProvidersBootstrap from the relocated provider packages
    // (`libraries/providers/<id>/src/v1/ai.adapter.ts`). The bootstrap loop
    // respects the `ai` feature-flag gate, so a DEV_DISABLE_AI deployment leaves
    // the kernel empty exactly as before.
    if (process.env.OPENAI_API_KEY) {
      this._logger.warn(
        'DEPRECATION: OPENAI_API_KEY environment variable is deprecated. ' +
        'AI provider config is now per-tenant via the database. ' +
        'Go to Settings → AI in each organization to configure a provider. ' +
        'The OPENAI_API_KEY env var will be ignored for model resolution starting in v3.6.0.',
      );
    }
  }
}
