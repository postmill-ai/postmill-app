import { Global, Module, OnModuleInit, Logger } from '@nestjs/common';
import { setSocialFetchPorts } from '@postmill-ai/provider-kernel';
import { getVpnDispatcher } from '@postmill-ai/nestjs-libraries/vpn/vpn.context';
import { ssrfSafeDispatcher } from '@postmill-ai/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { isSafePublicHttpsUrl } from '@postmill-ai/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import {
  RefreshTokenError,
  BadBodyError,
} from '@postmill-ai/nestjs-libraries/inngest/errors';
import { fetch as undiciFetch } from 'undici';
import { timer } from '@postmill-ai/helpers/utils/timer';
import { readOrFetch } from '@postmill-ai/helpers/utils/read.or.fetch';
import sharp from 'sharp';
import { PrismaRepository, PrismaService, PrismaTransaction } from './prisma.service';
import { OrganizationRepository } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.repository';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@postmill-ai/nestjs-libraries/database/prisma/users/users.service';
import { DeletionService } from '@postmill-ai/nestjs-libraries/database/prisma/users/deletion.service';
import { DataExportService } from '@postmill-ai/nestjs-libraries/database/prisma/users/data-export.service';
import { UsersRepository } from '@postmill-ai/nestjs-libraries/database/prisma/users/users.repository';
import { SubscriptionService } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { SubscriptionRepository } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { StripeEventRepository } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/stripe-event.repository';
import { NotificationService } from '@postmill-ai/nestjs-libraries/database/prisma/notifications/notification.service';
import { IntegrationService } from '@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationRepository } from '@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.repository';
import { PostsService } from '@postmill-ai/nestjs-libraries/database/prisma/posts/posts.service';
import { PostsRepository } from '@postmill-ai/nestjs-libraries/database/prisma/posts/posts.repository';
import { IntegrationManager } from '@postmill-ai/nestjs-libraries/integrations/integration.manager';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { FileRepository } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.repository';
import { NotificationsRepository } from '@postmill-ai/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { NotificationPreferenceService } from '@postmill-ai/nestjs-libraries/database/prisma/notifications/notification-preference.service';
import { PushNotificationService } from '@postmill-ai/nestjs-libraries/database/prisma/notifications/push-notification.service';
import { NotificationDigestService } from '@postmill-ai/nestjs-libraries/database/prisma/notifications/notification-digest.service';
import { EmailService } from '@postmill-ai/nestjs-libraries/services/email.service';
import { StripeService } from '@postmill-ai/nestjs-libraries/services/stripe.service';
import { ExtractContentService } from '@postmill-ai/nestjs-libraries/openai/extract.content.service';
import { OpenaiService } from '@postmill-ai/nestjs-libraries/openai/openai.service';
import { TrackService } from '@postmill-ai/nestjs-libraries/track/track.service';
import { ShortLinkService } from '@postmill-ai/nestjs-libraries/short-linking/short.link.service';
import { ShortLinkOAuthService } from '@postmill-ai/nestjs-libraries/short-linking/short-link-oauth.service';
import { AuthProviderRepository } from '@postmill-ai/nestjs-libraries/database/prisma/auth-providers/auth-provider.repository';
import { OrgShortLinkSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.service';
import { OrgShortLinkSettingsRepository } from '@postmill-ai/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.repository';
import { MediaModule } from '@postmill-ai/nestjs-libraries/media/media.module';
import { OrgMediaProviderSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { OrgMediaProviderSettingsRepository } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.repository';
import { OrgContentPackSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/content-packs/org-content-pack-settings.service';
import { OrgContentPackSettingsRepository } from '@postmill-ai/nestjs-libraries/database/prisma/content-packs/org-content-pack-settings.repository';
import { ProviderCredentialLinkService } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/provider-credential-link.service';
import { MediaJobLifecycleService } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { WebhooksRepository } from '@postmill-ai/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { WebhooksService } from '@postmill-ai/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { SignatureRepository } from '@postmill-ai/nestjs-libraries/database/prisma/signatures/signature.repository';
import { SignatureService } from '@postmill-ai/nestjs-libraries/database/prisma/signatures/signature.service';
import { AutopostRepository } from '@postmill-ai/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { AutopostService } from '@postmill-ai/nestjs-libraries/database/prisma/autopost/autopost.service';
import { SetsService } from '@postmill-ai/nestjs-libraries/database/prisma/sets/sets.service';
import { SetsRepository } from '@postmill-ai/nestjs-libraries/database/prisma/sets/sets.repository';
import { RefreshIntegrationService } from '@postmill-ai/nestjs-libraries/integrations/refresh.integration.service';
import { OAuthRepository } from '@postmill-ai/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { OAuthService } from '@postmill-ai/nestjs-libraries/database/prisma/oauth/oauth.service';
import { AnnouncementsRepository } from '@postmill-ai/nestjs-libraries/database/prisma/announcements/announcements.repository';
import { AnnouncementsService } from '@postmill-ai/nestjs-libraries/database/prisma/announcements/announcements.service';
import { ProviderConfigService } from '@postmill-ai/nestjs-libraries/database/prisma/provider-configs/provider-config.service';
import { ProviderConfigRepository } from '@postmill-ai/nestjs-libraries/database/prisma/provider-configs/provider-config.repository';
import { ProviderConfigManager } from '@postmill-ai/nestjs-libraries/integrations/provider-config.manager';
import { OrgProviderConfigService } from '@postmill-ai/nestjs-libraries/database/prisma/provider-configs/org-provider-config.service';
import { OrgProviderConfigRepository } from '@postmill-ai/nestjs-libraries/database/prisma/provider-configs/org-provider-config.repository';
import { FeaturedProviderRepository } from '@postmill-ai/nestjs-libraries/database/prisma/featured-providers/featured-provider.repository';
import { FeaturedProviderService } from '@postmill-ai/nestjs-libraries/database/prisma/featured-providers/featured-provider.service';
import { OrgProviderConfigManager } from '@postmill-ai/nestjs-libraries/integrations/org-provider-config.manager';
import { AiSettingsManager } from '@postmill-ai/nestjs-libraries/ai/ai-settings.manager';
import { SocialCommentsService } from '@postmill-ai/nestjs-libraries/database/prisma/social-comments/social.comments.service';
import { SocialCommentsRepository } from '@postmill-ai/nestjs-libraries/database/prisma/social-comments/social.comments.repository';
import { AiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { AiSettingsRepository } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.repository';
import { OrgAiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service';
import { OrgAiSettingsRepository } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.repository';
import { AiRagRepository } from '@postmill-ai/nestjs-libraries/database/prisma/ai-rag/ai-rag.repository';
import { PgVectorStoreAdapter } from '@postmill-ai/nestjs-libraries/ai/rag/pgvector.adapter';
import { AnalyticsRepository } from '@postmill-ai/nestjs-libraries/database/prisma/analytics/analytics.repository';
import { RedisService } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { EncryptionService } from '@postmill-ai/nestjs-libraries/encryption/encryption.service';
import { ProviderCatalogService } from '@postmill-ai/nestjs-libraries/providers/provider-catalog.service';
import { ProviderHealthService } from '@postmill-ai/nestjs-libraries/providers/provider-health.service';
import { MultipartUploadRepository } from '@postmill-ai/nestjs-libraries/database/prisma/media/multipart-upload.repository';
import { MultipartUploadService } from '@postmill-ai/nestjs-libraries/database/prisma/media/multipart-upload.service';
import { WatchlistRepository } from '@postmill-ai/nestjs-libraries/database/prisma/watchlist/watchlist.repository';
import { WatchlistService } from '@postmill-ai/nestjs-libraries/database/prisma/watchlist/watchlist.service';
import { CampaignsRepository } from '@postmill-ai/nestjs-libraries/database/prisma/campaigns/campaigns.repository';
import { CampaignsService } from '@postmill-ai/nestjs-libraries/database/prisma/campaigns/campaigns.service';
import { CampaignItemRepository } from '@postmill-ai/nestjs-libraries/database/prisma/campaigns/campaign-item.repository';
import { CampaignItemResolverRepository } from '@postmill-ai/nestjs-libraries/database/prisma/campaigns/campaign-item.resolver';
import { CampaignTagService } from '@postmill-ai/nestjs-libraries/database/prisma/campaigns/campaign-item.service';
import { CampaignReportService } from '@postmill-ai/nestjs-libraries/database/prisma/campaigns/campaign-report.service';
import { CampaignNoteRepository } from '@postmill-ai/nestjs-libraries/database/prisma/campaigns/campaign-note.repository';
import { CampaignNoteService } from '@postmill-ai/nestjs-libraries/database/prisma/campaigns/campaign-note.service';
import { BrandsService } from '@postmill-ai/nestjs-libraries/brands/brands.service';
import { BrandsRepository } from '@postmill-ai/nestjs-libraries/database/prisma/brands/brands.repository';
import { AuditRepository } from '@postmill-ai/nestjs-libraries/database/prisma/audit/audit.repository';
import { AuditService } from '@postmill-ai/nestjs-libraries/database/prisma/audit/audit.service';
import { ApiKeysRepository } from '@postmill-ai/nestjs-libraries/database/prisma/api-keys/api-keys.repository';
import { ApiKeysService } from '@postmill-ai/nestjs-libraries/database/prisma/api-keys/api-keys.service';
import { EmailLogRepository } from '@postmill-ai/nestjs-libraries/database/prisma/emails/email-log.repository';
import { EmailLogService } from '@postmill-ai/nestjs-libraries/database/prisma/emails/email-log.service';
import { EmailAdapterRegistry } from '@postmill-ai/nestjs-libraries/emails/email-adapter.registry';
import { RbacSeeder } from '@postmill-ai/nestjs-libraries/database/seeds/rbac-seeder';
import { BackfillService } from '@postmill-ai/nestjs-libraries/database/seeds/backfill.service';
import { DemoSeeder } from '@postmill-ai/nestjs-libraries/database/seeds/demo-seeder';
import { FeaturedProviderSeeder } from '@postmill-ai/nestjs-libraries/database/seeds/featured-provider.seeder';
import { DesignTemplateSeeder } from '@postmill-ai/nestjs-libraries/database/seeds/design-template.seeder';
import { MigrationLedgerRepository } from '@postmill-ai/nestjs-libraries/database/prisma/migration-ledger/migration-ledger.repository';
import { InngestRunRepository } from '@postmill-ai/nestjs-libraries/database/prisma/inngest-runs/inngest-run.repository';
import { HealthRepository } from '@postmill-ai/nestjs-libraries/database/prisma/health/health.repository';
import { RolesRepository } from '@postmill-ai/nestjs-libraries/database/prisma/roles/roles.repository';
import { RolesService } from '@postmill-ai/nestjs-libraries/database/prisma/roles/roles.service';
import { DesignRepository } from '@postmill-ai/nestjs-libraries/database/prisma/design/design.repository';
import { DesignService } from '@postmill-ai/nestjs-libraries/database/prisma/design/design.service';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import { DesignRenderService } from '@postmill-ai/nestjs-libraries/media/design-render/design-render.service';
import { DesignBulkService } from '@postmill-ai/nestjs-libraries/media/design-render/design-bulk.service';
import { FontLoaderService } from '@postmill-ai/nestjs-libraries/media/design-render/font-loader.service';
import { VideoRenderService } from '@postmill-ai/nestjs-libraries/media/design-render/video-render.service';
import { VideoRenderModule } from '@postmill-ai/nestjs-libraries/media/design-render/video-render.module';
import { AuthContextResolver } from '@postmill-ai/nestjs-libraries/auth/auth-context.resolver';
import { DashboardService } from '@postmill-ai/nestjs-libraries/dashboard/dashboard.service';
import { DashboardBriefService } from '@postmill-ai/nestjs-libraries/dashboard/dashboard-brief.service';
import { AnalyticsService } from '@postmill-ai/nestjs-libraries/analytics/analytics.service';
import { AnalyticsOverviewService } from '@postmill-ai/nestjs-libraries/analytics/analytics-overview.service';
import { AnalyticsDetailService } from '@postmill-ai/nestjs-libraries/analytics/analytics-detail.service';
import { AnalyticsInsightsService } from '@postmill-ai/nestjs-libraries/analytics/analytics-insights.service';
import { AnalyticsExportService } from '@postmill-ai/nestjs-libraries/analytics/analytics-export.service';
import { AnalyticsLiveFallbackService } from '@postmill-ai/nestjs-libraries/analytics/analytics-live-fallback';
import { AnalyticsShareService } from '@postmill-ai/nestjs-libraries/analytics/analytics-share.service';

@Global()
@Module({
  imports: [MediaModule, VideoRenderModule],
  controllers: [],
  providers: [
    PrismaService,
    PrismaRepository,
    PrismaTransaction,
    UsersService,
    UsersRepository,
    DeletionService,
    DataExportService,
    OrganizationService,
    OrganizationRepository,
    SubscriptionService,
    SubscriptionRepository,
    StripeEventRepository,
    NotificationService,
    NotificationsRepository,
    NotificationPreferenceService,
    PushNotificationService,
    NotificationDigestService,
    WebhooksRepository,
    WebhooksService,
    IntegrationService,
    IntegrationRepository,
    PostsService,
    PostsRepository,
    StripeService,
    SignatureRepository,
    AutopostRepository,
    AutopostService,
    SignatureService,
    FileService,
    FileRepository,
    IntegrationManager,
    RefreshIntegrationService,
    ExtractContentService,
    OpenaiService,
    EmailService,
    TrackService,
    ShortLinkService,
    SetsService,
    SetsRepository,
    OAuthRepository,
    OAuthService,
    AnnouncementsRepository,
    AnnouncementsService,
    ProviderConfigManager,
    ProviderConfigService,
    ProviderConfigRepository,
    FeaturedProviderRepository,
    FeaturedProviderService,
    SocialCommentsService,
    SocialCommentsRepository,
    AiSettingsService,
    AiSettingsRepository,
    OrgAiSettingsService,
    OrgAiSettingsRepository,
    AiRagRepository,
    PgVectorStoreAdapter,
    AiSettingsManager,
    AnalyticsRepository,
    RedisService,
    EncryptionService,
    MultipartUploadRepository,
    MultipartUploadService,
    WatchlistRepository,
    WatchlistService,
    CampaignsRepository,
    CampaignsService,
    CampaignItemRepository,
    CampaignItemResolverRepository,
    CampaignTagService,
    CampaignReportService,
    CampaignNoteRepository,
    CampaignNoteService,
    BrandsService,
    BrandsRepository,
    OrgProviderConfigService,
    OrgProviderConfigRepository,
    OrgProviderConfigManager,
    AuditRepository,
    AuditService,
    ApiKeysRepository,
    ApiKeysService,
    EmailLogRepository,
    EmailLogService,
    // EmailAdapterRegistry resolves the active email provider through the
    // ProviderKernel (ProviderResolutionService). It is no longer a legacy
    // in-memory store and has no PROVIDER_KERNEL=legacy fallback.
    EmailAdapterRegistry,
    OrgShortLinkSettingsService,
    OrgShortLinkSettingsRepository,
    ShortLinkOAuthService,
    AuthProviderRepository,
    OrgMediaProviderSettingsService,
    OrgMediaProviderSettingsRepository,
    OrgContentPackSettingsService,
    OrgContentPackSettingsRepository,
    ProviderCredentialLinkService,
    MediaJobLifecycleService,
    // Short-link resolution goes through the ProviderKernel via
    // OrgShortLinkSettingsService → ProviderResolutionService.resolveShortLink.
    // The legacy ShortLinkRegistry (and the PROVIDER_KERNEL=legacy kill switch)
    // were removed.
    RbacSeeder,
    BackfillService,
    FeaturedProviderSeeder,
    DesignTemplateSeeder,
    DemoSeeder,
    MigrationLedgerRepository,
    InngestRunRepository,
    HealthRepository,
    RolesRepository,
    RolesService,
    DesignRepository,
    DesignService,
    DesignerDocService,
    DesignRenderService,
    DesignBulkService,
    FontLoaderService,
    AuthContextResolver,
    DashboardService,
    DashboardBriefService,
    AnalyticsService,
    AnalyticsOverviewService,
    AnalyticsDetailService,
    AnalyticsInsightsService,
    AnalyticsExportService,
    AnalyticsLiveFallbackService,
    AnalyticsShareService,
    ProviderCatalogService,
    ProviderHealthService,
    {
      provide: 'RBAC_SEED_ON_INIT',
      useFactory: (
        seeder: RbacSeeder,
        backfill: BackfillService,
        featured: FeaturedProviderSeeder,
        designTemplates: DesignTemplateSeeder,
      ) => {
        // Run idempotently on every app bootstrap — safe and cheap.
        seeder.seed()
          .then(() => backfill.backfill())
          .then(() => featured.seed())
          .then(() => designTemplates.seed())
          .catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            new Logger('DatabaseModule').error(`RBAC seed/backfill/featured/templates failed: ${msg}`);
          });
        return true;
      },
      inject: [RbacSeeder, BackfillService, FeaturedProviderSeeder, DesignTemplateSeeder],
    },
    {
      // Dev-only demo fixtures. Opt-in via DEV_SEED_DEMO=true (and NODE_ENV=
      // development — DemoSeeder hard-gates on this too). Ledger-idempotent, so
      // it seeds once; set DEV_SEED_DEMO_RESET=true to wipe + reseed. Never runs
      // in prod. Runs after RBAC/backfill so the target org's roles exist.
      provide: 'DEMO_SEED_ON_INIT',
      useFactory: (demo: DemoSeeder) => {
        if (
          process.env.NODE_ENV === 'development' &&
          process.env.DEV_SEED_DEMO === 'true'
        ) {
          demo.seed().catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            new Logger('DatabaseModule').error(`Demo seed failed: ${msg}`);
          });
        }
        return true;
      },
      inject: [DemoSeeder],
    },
  ],
  get exports() {
    // Re-export MediaModule so its media services are globally injectable.
    // VideoRenderModule is likewise re-exported so VideoRenderService is globally
    // injectable (MediaJobsActivity in InngestModule, design.controller in
    // ApiModule) without each module re-importing it.
    return [...this.providers, MediaModule, VideoRenderModule];
  },
})
export class DatabaseModule implements OnModuleInit {
  private static _socialFetchPortsWired = false;

  onModuleInit() {
    // Wire SocialAbstract.fetch's security/runtime primitives into the kernel
    // ONCE, before any publish. The VPN AsyncLocalStorage (vpn.context) and the
    // inngest error classes never leave nestjs-libraries, so they stay
    // single-instance and instanceof-correct. Idempotent.
    if (DatabaseModule._socialFetchPortsWired) {
      return;
    }
    DatabaseModule._socialFetchPortsWired = true;
    setSocialFetchPorts({
      getVpnDispatcher,
      ssrfSafeDispatcher,
      isSafePublicHttpsUrl,
      undiciFetch: undiciFetch as unknown as typeof fetch,
      RefreshTokenError,
      BadBodyError,
      timer,
      sharp,
      readOrFetch,
      safeFetch,
    });
  }
}
