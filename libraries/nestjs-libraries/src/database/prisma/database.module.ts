import { Global, Module, OnModuleInit, Logger } from '@nestjs/common';
import { setSocialFetchPorts } from '@gitroom/provider-kernel';
import { getVpnDispatcher } from '@gitroom/nestjs-libraries/vpn/vpn.context';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import {
  RefreshTokenError,
  BadBodyError,
} from '@gitroom/nestjs-libraries/inngest/errors';
import { fetch as undiciFetch } from 'undici';
import { timer } from '@gitroom/helpers/utils/timer';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import sharp from 'sharp';
import { PrismaRepository, PrismaService, PrismaTransaction } from './prisma.service';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { DeletionService } from '@gitroom/nestjs-libraries/database/prisma/users/deletion.service';
import { DataExportService } from '@gitroom/nestjs-libraries/database/prisma/users/data-export.service';
import { UsersRepository } from '@gitroom/nestjs-libraries/database/prisma/users/users.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { StripeEventRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/stripe-event.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { FileRepository } from '@gitroom/nestjs-libraries/database/prisma/file/file.repository';
import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { NotificationPreferenceService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification-preference.service';
import { PushNotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/push-notification.service';
import { NotificationDigestService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification-digest.service';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { ExtractContentService } from '@gitroom/nestjs-libraries/openai/extract.content.service';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { ShortLinkOAuthService } from '@gitroom/nestjs-libraries/short-linking/short-link-oauth.service';
import { AuthProviderRepository } from '@gitroom/nestjs-libraries/database/prisma/auth-providers/auth-provider.repository';
import { OrgShortLinkSettingsService } from '@gitroom/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.service';
import { OrgShortLinkSettingsRepository } from '@gitroom/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.repository';
import { MediaModule } from '@gitroom/nestjs-libraries/media/media.module';
import { OrgMediaProviderSettingsService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { OrgMediaProviderSettingsRepository } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.repository';
import { OrgContentPackSettingsService } from '@gitroom/nestjs-libraries/database/prisma/content-packs/org-content-pack-settings.service';
import { OrgContentPackSettingsRepository } from '@gitroom/nestjs-libraries/database/prisma/content-packs/org-content-pack-settings.repository';
import { ProviderCredentialLinkService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/provider-credential-link.service';
import { MediaJobLifecycleService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { SignatureRepository } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.repository';
import { SignatureService } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.service';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import { SetsService } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.service';
import { SetsRepository } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.repository';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { AnnouncementsRepository } from '@gitroom/nestjs-libraries/database/prisma/announcements/announcements.repository';
import { AnnouncementsService } from '@gitroom/nestjs-libraries/database/prisma/announcements/announcements.service';
import { ProviderConfigService } from '@gitroom/nestjs-libraries/database/prisma/provider-configs/provider-config.service';
import { ProviderConfigRepository } from '@gitroom/nestjs-libraries/database/prisma/provider-configs/provider-config.repository';
import { ProviderConfigManager } from '@gitroom/nestjs-libraries/integrations/provider-config.manager';
import { OrgProviderConfigService } from '@gitroom/nestjs-libraries/database/prisma/provider-configs/org-provider-config.service';
import { OrgProviderConfigRepository } from '@gitroom/nestjs-libraries/database/prisma/provider-configs/org-provider-config.repository';
import { FeaturedProviderRepository } from '@gitroom/nestjs-libraries/database/prisma/featured-providers/featured-provider.repository';
import { FeaturedProviderService } from '@gitroom/nestjs-libraries/database/prisma/featured-providers/featured-provider.service';
import { OrgProviderConfigManager } from '@gitroom/nestjs-libraries/integrations/org-provider-config.manager';
import { AiSettingsManager } from '@gitroom/nestjs-libraries/ai/ai-settings.manager';
import { SocialCommentsService } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service';
import { SocialCommentsRepository } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.repository';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { AiSettingsRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.repository';
import { OrgAiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service';
import { OrgAiSettingsRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.repository';
import { AiRagRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-rag/ai-rag.repository';
import { PgVectorStoreAdapter } from '@gitroom/nestjs-libraries/ai/rag/pgvector.adapter';
import { AnalyticsRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';
import { RedisService } from '@gitroom/nestjs-libraries/redis/redis.service';
import { EncryptionService } from '@gitroom/nestjs-libraries/encryption/encryption.service';
import { ProviderCatalogService } from '@gitroom/nestjs-libraries/providers/provider-catalog.service';
import { ProviderHealthService } from '@gitroom/nestjs-libraries/providers/provider-health.service';
import { MultipartUploadRepository } from '@gitroom/nestjs-libraries/database/prisma/media/multipart-upload.repository';
import { MultipartUploadService } from '@gitroom/nestjs-libraries/database/prisma/media/multipart-upload.service';
import { WatchlistRepository } from '@gitroom/nestjs-libraries/database/prisma/watchlist/watchlist.repository';
import { WatchlistService } from '@gitroom/nestjs-libraries/database/prisma/watchlist/watchlist.service';
import { CampaignsRepository } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaigns.repository';
import { CampaignsService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaigns.service';
import { CampaignItemRepository } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-item.repository';
import { CampaignItemResolverRepository } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-item.resolver';
import { CampaignTagService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-item.service';
import { CampaignReportService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-report.service';
import { CampaignNoteRepository } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-note.repository';
import { CampaignNoteService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-note.service';
import { BrandsService } from '@gitroom/nestjs-libraries/brands/brands.service';
import { BrandsRepository } from '@gitroom/nestjs-libraries/database/prisma/brands/brands.repository';
import { AuditRepository } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.repository';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import { ApiKeysRepository } from '@gitroom/nestjs-libraries/database/prisma/api-keys/api-keys.repository';
import { ApiKeysService } from '@gitroom/nestjs-libraries/database/prisma/api-keys/api-keys.service';
import { EmailLogRepository } from '@gitroom/nestjs-libraries/database/prisma/emails/email-log.repository';
import { EmailLogService } from '@gitroom/nestjs-libraries/database/prisma/emails/email-log.service';
import { EmailAdapterRegistry } from '@gitroom/nestjs-libraries/emails/email-adapter.registry';
import { RbacSeeder } from '@gitroom/nestjs-libraries/database/seeds/rbac-seeder';
import { BackfillService } from '@gitroom/nestjs-libraries/database/seeds/backfill.service';
import { DemoSeeder } from '@gitroom/nestjs-libraries/database/seeds/demo-seeder';
import { FeaturedProviderSeeder } from '@gitroom/nestjs-libraries/database/seeds/featured-provider.seeder';
import { DesignTemplateSeeder } from '@gitroom/nestjs-libraries/database/seeds/design-template.seeder';
import { MigrationLedgerRepository } from '@gitroom/nestjs-libraries/database/prisma/migration-ledger/migration-ledger.repository';
import { InngestRunRepository } from '@gitroom/nestjs-libraries/database/prisma/inngest-runs/inngest-run.repository';
import { HealthRepository } from '@gitroom/nestjs-libraries/database/prisma/health/health.repository';
import { RolesRepository } from '@gitroom/nestjs-libraries/database/prisma/roles/roles.repository';
import { RolesService } from '@gitroom/nestjs-libraries/database/prisma/roles/roles.service';
import { DesignRepository } from '@gitroom/nestjs-libraries/database/prisma/design/design.repository';
import { DesignService } from '@gitroom/nestjs-libraries/database/prisma/design/design.service';
import { DesignerDocService } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.service';
import { DesignRenderService } from '@gitroom/nestjs-libraries/media/design-render/design-render.service';
import { DesignBulkService } from '@gitroom/nestjs-libraries/media/design-render/design-bulk.service';
import { FontLoaderService } from '@gitroom/nestjs-libraries/media/design-render/font-loader.service';
import { VideoRenderService } from '@gitroom/nestjs-libraries/media/design-render/video-render.service';
import { VideoRenderModule } from '@gitroom/nestjs-libraries/media/design-render/video-render.module';
import { AuthContextResolver } from '@gitroom/nestjs-libraries/auth/auth-context.resolver';
import { DashboardService } from '@gitroom/nestjs-libraries/dashboard/dashboard.service';
import { DashboardBriefService } from '@gitroom/nestjs-libraries/dashboard/dashboard-brief.service';
import { AnalyticsService } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import { AnalyticsOverviewService } from '@gitroom/nestjs-libraries/analytics/analytics-overview.service';
import { AnalyticsDetailService } from '@gitroom/nestjs-libraries/analytics/analytics-detail.service';
import { AnalyticsInsightsService } from '@gitroom/nestjs-libraries/analytics/analytics-insights.service';
import { AnalyticsExportService } from '@gitroom/nestjs-libraries/analytics/analytics-export.service';
import { AnalyticsLiveFallbackService } from '@gitroom/nestjs-libraries/analytics/analytics-live-fallback';
import { AnalyticsShareService } from '@gitroom/nestjs-libraries/analytics/analytics-share.service';

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
