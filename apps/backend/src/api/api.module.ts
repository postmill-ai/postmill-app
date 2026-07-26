import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { AuthController } from '@postmill-ai/backend/api/routes/auth.controller';
import { AuthService } from '@postmill-ai/backend/services/auth/auth.service';
import { UsersController } from '@postmill-ai/backend/api/routes/users.controller';
import { AuthMiddleware } from '@postmill-ai/backend/services/auth/auth.middleware';
import { AuthGuard } from '@postmill-ai/backend/services/auth/auth.guard';
import { CsrfMiddleware } from '@postmill-ai/backend/services/auth/csrf.middleware';
import { StripeController } from '@postmill-ai/backend/api/routes/stripe.controller';
import { StripeService } from '@postmill-ai/nestjs-libraries/services/stripe.service';
import { AnalyticsV2Controller } from '@postmill-ai/backend/api/routes/analytics.v2.controller';
import { AnalyticsService } from '@postmill-ai/nestjs-libraries/analytics/analytics.service';
import { AnalyticsLiveFallbackService } from '@postmill-ai/nestjs-libraries/analytics/analytics-live-fallback';
import { AnalyticsOverviewService } from '@postmill-ai/nestjs-libraries/analytics/analytics-overview.service';
import { AnalyticsDetailService } from '@postmill-ai/nestjs-libraries/analytics/analytics-detail.service';
import { AnalyticsInsightsService } from '@postmill-ai/nestjs-libraries/analytics/analytics-insights.service';
import { AnalyticsExportService } from '@postmill-ai/nestjs-libraries/analytics/analytics-export.service';
import { AnalyticsShareService } from '@postmill-ai/nestjs-libraries/analytics/analytics-share.service';
import { MediaStreamService } from '@postmill-ai/nestjs-libraries/media/stream/media-stream.service';
import { PoliciesGuard } from '@postmill-ai/backend/services/auth/permissions/permissions.guard';
import { PermissionsService } from '@postmill-ai/backend/services/auth/permissions/permissions.service';
import { IntegrationsController } from '@postmill-ai/backend/api/routes/integrations.controller';
import { IntegrationManager } from '@postmill-ai/nestjs-libraries/integrations/integration.manager';
import { SettingsController } from '@postmill-ai/backend/api/routes/settings.controller';
import { SetupController } from '@postmill-ai/backend/api/routes/setup.controller';
import { OrganizationsController } from '@postmill-ai/backend/api/routes/organizations.controller';
import { PostsController } from '@postmill-ai/backend/api/routes/posts.controller';
import { MediaController } from '@postmill-ai/backend/api/routes/media.controller';
import { FilesController } from '@postmill-ai/backend/api/routes/files.controller';
import { UploadModule } from '@postmill-ai/nestjs-libraries/upload/upload.module';
import { BillingController } from '@postmill-ai/backend/api/routes/billing.controller';
import { NotificationsController } from '@postmill-ai/backend/api/routes/notifications.controller';
import { AdminNotificationsController } from '@postmill-ai/backend/api/routes/admin-notifications.controller';
import { OpenaiService } from '@postmill-ai/nestjs-libraries/openai/openai.service';
import { ExtractContentService } from '@postmill-ai/nestjs-libraries/openai/extract.content.service';
import { CodesService } from '@postmill-ai/nestjs-libraries/services/codes.service';
import { CopilotController } from '@postmill-ai/backend/api/routes/copilot.controller';
import { PublicController } from '@postmill-ai/backend/api/routes/public.controller';
import { RootController } from '@postmill-ai/backend/api/routes/root.controller';
import { TrackService } from '@postmill-ai/nestjs-libraries/track/track.service';
import { ShortLinkService } from '@postmill-ai/nestjs-libraries/short-linking/short.link.service';
import { WebhookController } from '@postmill-ai/backend/api/routes/webhooks.controller';
import { SignatureController } from '@postmill-ai/backend/api/routes/signature.controller';
import { AutopostController } from '@postmill-ai/backend/api/routes/autopost.controller';
import { SetsController } from '@postmill-ai/backend/api/routes/sets.controller';
import { MonitorController } from '@postmill-ai/backend/api/routes/monitor.controller';
import { NoAuthIntegrationsController } from '@postmill-ai/backend/api/routes/no.auth.integrations.controller';
import { EnterpriseController } from '@postmill-ai/backend/api/routes/enterprise.controller';
import { OAuthAppController } from '@postmill-ai/backend/api/routes/oauth-app.controller';
import { ApprovedAppsController } from '@postmill-ai/backend/api/routes/approved-apps.controller';
import { OAuthController, OAuthAuthorizedController } from '@postmill-ai/backend/api/routes/oauth.controller';
import { AnnouncementsController } from '@postmill-ai/backend/api/routes/announcements.controller';
import { ChannelConfigController } from '@postmill-ai/backend/api/routes/channel.config.controller';
import { ChannelConfigPerTenantController } from '@postmill-ai/backend/api/routes/channel-config.per-tenant.controller';
import { SocialCommentsController } from '@postmill-ai/backend/api/routes/social-comments.controller';
import { AiSettingsController } from '@postmill-ai/backend/api/routes/ai-settings.controller';
import { AdminDefaultsController } from '@postmill-ai/backend/api/routes/admin-defaults.controller';
import { AiModerateController } from '@postmill-ai/backend/api/routes/ai-moderate.controller';
import { AiUserController } from '@postmill-ai/backend/api/routes/ai-user.controller';
import { CampaignsController } from '@postmill-ai/backend/api/routes/campaigns.controller';
import { RagController } from '@postmill-ai/backend/api/routes/rag.controller';
import { StorageController } from '@postmill-ai/backend/api/routes/storage.controller';
import { OrgAiSettingsController } from '@postmill-ai/backend/api/routes/org-ai-settings.controller';
import { OrgShortLinkSettingsController } from '@postmill-ai/backend/api/routes/org-shortlink-settings.controller';
import { OrgVpnSettingsController } from '@postmill-ai/backend/api/routes/org-vpn-settings.controller';
import { ContentPackController } from '@postmill-ai/backend/api/routes/content-pack.controller';
import { MediaProviderController } from '@postmill-ai/backend/api/routes/media-provider.controller';
import { MediaDefaultsController } from '@postmill-ai/backend/api/routes/media-defaults.controller';
import { DashboardController } from '@postmill-ai/backend/api/routes/dashboard.controller';
import { BrandsController } from '@postmill-ai/backend/api/routes/brands.controller';
import { ApiKeysController } from '@postmill-ai/backend/api/routes/api-keys.controller';
import { RolesController } from '@postmill-ai/backend/api/routes/roles.controller';
import { StockMediaController } from '@postmill-ai/backend/api/routes/stock-media.controller';
import { StockMediaService } from '@postmill-ai/nestjs-libraries/media/stock/stock-media.service';
import { DesignController, DesignRenderFrameController, DesignTemplateController, DesignerProxyController } from '@postmill-ai/backend/api/routes/design.controller';
import { EmailWebhooksController } from '@postmill-ai/backend/api/routes/email-webhooks.controller';
import { MediaJobsWebhookController } from '@postmill-ai/backend/api/routes/media-jobs-webhook.controller';
import { AiGuardMiddleware } from '@postmill-ai/backend/services/ai/ai-guard.middleware';
import { BudgetMiddleware } from '@postmill-ai/nestjs-libraries/ai/governance/budget.middleware';
import { AuthProviderManager } from '@postmill-ai/backend/services/auth/providers/auth-provider.manager';
import { ProvidersManager } from '@postmill-ai/backend/services/auth/providers/providers.manager';
import { OrgRbacGuard } from '@postmill-ai/backend/services/auth/rbac/org-rbac.guard';
import { SessionCleanupService } from '@postmill-ai/backend/services/session-cleanup.service';
import { HealthController } from '@postmill-ai/backend/api/routes/health.controller';
import { HealthService } from '@postmill-ai/backend/services/health.service';
import {
  ProvidersController,
  AdminProvidersController,
} from '@postmill-ai/backend/api/routes/providers.controller';
import { AdminOrgsController } from '@postmill-ai/backend/api/routes/admin.orgs.controller';
import { InngestModule } from '@postmill-ai/nestjs-libraries/inngest/inngest.module';
import { ReplicateStudioModule } from '@postmill-ai/nestjs-libraries/media/replicate-studio/replicate-studio.module';
import { ReplicateStudioController } from './routes/replicate-studio.controller';
import { HeyGenModule } from '@postmill-ai/nestjs-libraries/media/heygen/heygen.module';
import { HeyGenController } from './routes/heygen.controller';
import { MediaStudioModule } from '@postmill-ai/nestjs-libraries/media/studio/studio.module';
import { MediaStudioController } from './routes/media-studio.controller';
import { DeepgramModule } from '@postmill-ai/nestjs-libraries/media/deepgram/deepgram.module';
import { DeepgramController } from './routes/deepgram.controller';
import { AiDesignerModule } from '@postmill-ai/nestjs-libraries/ai-designer/ai-designer.module';
import { AiDesignerController } from './routes/ai-designer.controller';
import { AiDesignerGateway } from './gateways/ai-designer.gateway';

// Exported so tests can prove a controller is registered for
// AuthMiddleware/CsrfMiddleware (an unregistered controller serves unauthenticated).
export const authenticatedController = [
  UsersController,
  IntegrationsController,
  SettingsController,
  SetupController,
  OrganizationsController,
  SocialCommentsController,
  CampaignsController,
  PostsController,
  MediaController,
  FilesController,
  BillingController,
  NotificationsController,
  AdminNotificationsController,
  CopilotController,
  WebhookController,
  SignatureController,
  AutopostController,
  SetsController,
  OAuthAppController,
  ApprovedAppsController,
  OAuthAuthorizedController,
  AnnouncementsController,
  ChannelConfigController,
  AnalyticsV2Controller,
  AiSettingsController,
  AdminDefaultsController,
  AiModerateController,
  AiUserController,
  StorageController,
  ChannelConfigPerTenantController,
  OrgAiSettingsController,
  RagController,
  OrgShortLinkSettingsController,
  OrgVpnSettingsController,
  ContentPackController,
  MediaProviderController,
  MediaDefaultsController,
  ApiKeysController,
  DashboardController,
  BrandsController,
  RolesController,
  StockMediaController,
  DesignController,
  DesignTemplateController,
  DesignerProxyController,
  ReplicateStudioController,
  HeyGenController,
  MediaStudioController,
  DeepgramController,
  AiDesignerController,
  AdminProvidersController,
  AdminOrgsController,
  // PROVIDER_REMEDIATION 3.1: `/providers/catalog` was fully anonymous. It is
  // org-agnostic but must be authenticated — it fingerprints the deployment's exact
  // release + the `verified:false` beta cohort. Moved into the authenticated group so
  // AuthMiddleware/CsrfMiddleware apply (still no org-scoping in the handler).
  ProvidersController,
];
@Module({
  imports: [UploadModule, InngestModule, ReplicateStudioModule, HeyGenModule, MediaStudioModule, DeepgramModule, AiDesignerModule],
  controllers: [
    RootController,
    HealthController,
    StripeController,
    AuthController,
    PublicController,
    MonitorController,
    EnterpriseController,
    NoAuthIntegrationsController,
    OAuthController,
    EmailWebhooksController,
    MediaJobsWebhookController,
    DesignRenderFrameController,
    ...authenticatedController,
  ],
  providers: [
    AuthService,
    StripeService,
    OpenaiService,
    ExtractContentService,
    AuthMiddleware,
    AuthGuard,
    PoliciesGuard,
    OrgRbacGuard,
    PermissionsService,
    CodesService,
    IntegrationManager,
    TrackService,
    ShortLinkService,
    AuthProviderManager,
    ProvidersManager,
    AnalyticsService,
    AnalyticsLiveFallbackService,
    AnalyticsOverviewService,
    AnalyticsDetailService,
    AnalyticsInsightsService,
    AnalyticsExportService,
    AnalyticsShareService,
    StockMediaService,
    AiGuardMiddleware,
    SessionCleanupService,
    HealthService,
    AiDesignerGateway,
    MediaStreamService,
  ],
  get exports() {
    return [...this.imports, ...this.providers];
  },
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes(...authenticatedController);
    consumer.apply(CsrfMiddleware).forRoutes(...authenticatedController);
    // path-to-regexp v8 (Express 5 / Nest 11) requires named wildcards; bare `*`
    // throws "Missing parameter name". `{/*splat}` matches both the bare path and
    // everything under it (e.g. /agents and /agents/list).
    consumer
      .apply(BudgetMiddleware)
      .forRoutes({ path: '/agents{/*splat}', method: RequestMethod.ALL });
    consumer
      .apply(BudgetMiddleware)
      .forRoutes({ path: '/copilot{/*splat}', method: RequestMethod.ALL });
    consumer
      .apply(BudgetMiddleware)
      .forRoutes({ path: '/ai{/*splat}', method: RequestMethod.ALL });
    consumer
      .apply(AiGuardMiddleware)
      .forRoutes({ path: '/copilot/chat', method: RequestMethod.POST });
    consumer
      .apply(AiGuardMiddleware)
      .forRoutes({ path: '/copilot/agent', method: RequestMethod.POST });
  }
}
