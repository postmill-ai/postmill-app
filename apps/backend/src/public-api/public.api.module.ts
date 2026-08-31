import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { AuthService } from '@postmill-ai/backend/services/auth/auth.service';
import { StripeService } from '@postmill-ai/nestjs-libraries/services/stripe.service';
import { PoliciesGuard } from '@postmill-ai/backend/services/auth/permissions/permissions.guard';
import { PermissionsService } from '@postmill-ai/backend/services/auth/permissions/permissions.service';
import { IntegrationManager } from '@postmill-ai/nestjs-libraries/integrations/integration.manager';
import { UploadModule } from '@postmill-ai/nestjs-libraries/upload/upload.module';
import { OpenaiService } from '@postmill-ai/nestjs-libraries/openai/openai.service';
import { ExtractContentService } from '@postmill-ai/nestjs-libraries/openai/extract.content.service';
import { CodesService } from '@postmill-ai/nestjs-libraries/services/codes.service';
import { PublicIntegrationsController } from '@postmill-ai/backend/public-api/routes/v1/public.integrations.controller';
import { PublicAnalyticsV1Controller } from '@postmill-ai/backend/public-api/routes/v1/public.analytics.v1.controller';
import { PublicCampaignController } from '@postmill-ai/backend/public-api/routes/public.campaign.controller';
import { PublicAnalyticsController } from '@postmill-ai/backend/public-api/routes/public.analytics.controller';
import { PublicAuthMiddleware } from '@postmill-ai/backend/services/auth/public.auth.middleware';
import { CsrfMiddleware } from '@postmill-ai/backend/services/auth/csrf.middleware';
import { AuthContextResolver } from '@postmill-ai/nestjs-libraries/auth/auth-context.resolver';
import { AnalyticsService } from '@postmill-ai/nestjs-libraries/analytics/analytics.service';
import { AnalyticsShareService } from '@postmill-ai/nestjs-libraries/analytics/analytics-share.service';
import { AnalyticsLiveFallbackService } from '@postmill-ai/nestjs-libraries/analytics/analytics-live-fallback';
import { AnalyticsOverviewService } from '@postmill-ai/nestjs-libraries/analytics/analytics-overview.service';
import { AnalyticsDetailService } from '@postmill-ai/nestjs-libraries/analytics/analytics-detail.service';
import { AnalyticsInsightsService } from '@postmill-ai/nestjs-libraries/analytics/analytics-insights.service';
import { AnalyticsExportService } from '@postmill-ai/nestjs-libraries/analytics/analytics-export.service';
import { IdempotencyFactory } from '@postmill-ai/nestjs-libraries/ai/governance/idempotency.factory';

const authenticatedController = [
  PublicIntegrationsController,
  PublicAnalyticsV1Controller,
];
const publicController = [PublicCampaignController, PublicAnalyticsController];
@Module({
  imports: [UploadModule],
  controllers: [...authenticatedController, ...publicController],
  providers: [
    AuthService,
    StripeService,
    OpenaiService,
    ExtractContentService,
    PoliciesGuard,
    PermissionsService,
    CodesService,
    IntegrationManager,
    AuthContextResolver,
    CsrfMiddleware,
    AnalyticsService,
    AnalyticsLiveFallbackService,
    AnalyticsOverviewService,
    AnalyticsDetailService,
    AnalyticsInsightsService,
    AnalyticsExportService,
    AnalyticsShareService,
    IdempotencyFactory,
  ],
  get exports() {
    return [...this.imports, ...this.providers];
  },
})
export class PublicApiModule implements NestModule {
  constructor(private _idempotencyFactory: IdempotencyFactory) {}

  // J4 — Idempotency-Key on public mutations. Reuses the Redis-backed MCP
  // IdempotencyFactory: a repeat with the same key within the TTL replays the
  // first response instead of re-running the mutation.
  private _idempotency = (req: Request, res: Response, next: NextFunction) => {
    const mw = this._idempotencyFactory.getMiddleware();
    if (!mw) return next();

    const rawKey = req.headers['idempotency-key'];
    if (!rawKey || typeof rawKey !== 'string') return next();

    // Namespace the key per-org (set by PublicAuthMiddleware, which runs first)
    // so one tenant can't replay another tenant's cached response by reusing the
    // same key string.
    const orgId = (req as any).org?.id;
    if (orgId) {
      req.headers['idempotency-key'] = `${orgId}:${rawKey}`;
    }

    // The factory middleware only processes POST/PUT/PATCH. Public DELETEs also
    // accept the key, so present them under a covered verb for keying, then
    // restore the real verb so the route still matches on a cache miss.
    if (req.method === 'DELETE') {
      const realMethod = req.method;
      req.method = 'POST';
      return mw(req, res, (err?: any) => {
        req.method = realMethod;
        next(err);
      });
    }

    return mw(req, res, next);
  };

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(PublicAuthMiddleware).forRoutes(...authenticatedController);

    // Dashboard (cookie) callers on the public API get the same CSRF defense
    // as the app routes — no-op for API-key/OAuth (header) auth.
    consumer.apply(CsrfMiddleware).forRoutes(...authenticatedController);

    // Auth is applied first (above) so the org is resolved before idempotency
    // keys are namespaced. Scope to the mutating public routes only.
    consumer.apply(this._idempotency).forRoutes(
      { path: 'public/v1/upload', method: RequestMethod.POST },
      { path: 'public/v1/upload-from-url', method: RequestMethod.POST },
      { path: 'public/v1/posts', method: RequestMethod.POST },
      { path: 'public/v1/posts/:id', method: RequestMethod.DELETE },
      { path: 'public/v1/posts/group/:group', method: RequestMethod.DELETE },
      { path: 'public/v1/integrations/:id', method: RequestMethod.DELETE }
    );
  }
}
