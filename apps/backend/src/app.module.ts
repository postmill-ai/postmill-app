import {
  Global,
  Module,
  NestModule,
  MiddlewareConsumer,
} from '@nestjs/common';
import { RequestIdMiddleware } from '@postmill-ai/backend/api/middleware/request-id.middleware';
import { DatabaseModule } from '@postmill-ai/nestjs-libraries/database/prisma/database.module';
import { ApiModule } from '@postmill-ai/backend/api/api.module';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PoliciesGuard } from '@postmill-ai/backend/services/auth/permissions/permissions.guard';
import { OrgRbacGuard } from '@postmill-ai/backend/services/auth/rbac/org-rbac.guard';
import { PublicApiModule } from '@postmill-ai/backend/public-api/public.api.module';
import { ThrottlerBehindProxyGuard } from '@postmill-ai/nestjs-libraries/throttler/throttler.provider';
import { ThrottlerModule } from '@nestjs/throttler';
import { AgentModule } from '@postmill-ai/nestjs-libraries/agent/agent.module';
import { SentryModule } from '@sentry/nestjs/setup';
import { FILTER } from '@postmill-ai/nestjs-libraries/sentry/sentry.exception';
import { PROVIDER_NOT_CONFIGURED_FILTER } from '@postmill-ai/nestjs-libraries/integrations/provider-not-configured.filter';
import { SHORT_LINK_PROVIDER_FILTER } from '@postmill-ai/nestjs-libraries/short-linking/short-link-provider.filter';
import { ChatModule } from '@postmill-ai/nestjs-libraries/chat/chat.module';
import { InngestModule } from '@postmill-ai/nestjs-libraries/inngest/inngest.module';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { AiModule } from '@postmill-ai/nestjs-libraries/ai/ai.module';
import { VpnModule } from '@postmill-ai/nestjs-libraries/vpn/vpn.module';
import { CommsModule } from '@postmill-ai/nestjs-libraries/comms/comms.module';
import { InngestController } from '@postmill-ai/backend/api/controllers/inngest.controller';
import { ScheduleModule } from '@nestjs/schedule';
import { FeatureFlagsModule, FeatureFlagsService } from '@postmill-ai/nestjs-libraries/feature-flags';
import { CollaborationModule } from '@postmill-ai/backend/services/collaboration/collaboration.module';
import { ProvidersModule } from '@postmill-ai/nestjs-libraries/providers/providers.module';
import { ProvidersBootstrap } from './providers.bootstrap';
import { ProviderExceptionFilter } from './api/filters/provider-exception.filter';

// Module-level feature flags are read at bootstrap time. Defaults keep all
// features enabled for production/CI; local developers opt-out via env vars.
const featureFlags = new FeatureFlagsService();
const scheduleModule = featureFlags.isEnabled('cron')
  ? [ScheduleModule.forRoot()]
  : [];

@Global()
@Module({
  imports: [
    FeatureFlagsModule,
    SentryModule.forRoot(),
    ...scheduleModule,
    DatabaseModule,
    ApiModule,
    PublicApiModule,
    AgentModule,
    ChatModule,
    InngestModule,
    AiModule,
    VpnModule,
    CommsModule,
    ProvidersModule,
    CollaborationModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 3600000,
          // Global abuse backstop (per client IP, 1h window). The frontend SPA fires
          // 15-30 /api calls per page navigation, so the old default of 90/hr tripped
          // during normal interactive use and made the app look dead (blank renders on
          // 429). Sensitive routes have their own tight per-minute @Throttle() decorators
          // (login 10/min, register 5/min, public 20-60/min, AI 10-30/min);
          // this global limit only needs to
          // catch scraping/abuse. Raised 90 -> 600 default; override via API_LIMIT env.
          limit: process.env.API_LIMIT ? Number(process.env.API_LIMIT) : 600,
        },
      ],
      storage: new ThrottlerStorageRedisService(ioRedis),
    }),
  ],
  controllers: [InngestController],
  providers: [
    FILTER,
    PROVIDER_NOT_CONFIGURED_FILTER,
    SHORT_LINK_PROVIDER_FILTER,
    ProvidersBootstrap,
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PoliciesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: OrgRbacGuard,
    },
    {
      provide: APP_FILTER,
      useClass: ProviderExceptionFilter,
    },
  ],
  exports: [
    DatabaseModule,
    ApiModule,
    PublicApiModule,
    AgentModule,
    ThrottlerModule,
    ChatModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
