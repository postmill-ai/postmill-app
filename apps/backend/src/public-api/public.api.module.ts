import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { PoliciesGuard } from '@gitroom/backend/services/auth/permissions/permissions.guard';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { UploadModule } from '@gitroom/nestjs-libraries/upload/upload.module';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { ExtractContentService } from '@gitroom/nestjs-libraries/openai/extract.content.service';
import { CodesService } from '@gitroom/nestjs-libraries/services/codes.service';
import { PublicIntegrationsController } from '@gitroom/backend/public-api/routes/v1/public.integrations.controller';
import { PublicCampaignController } from '@gitroom/backend/public-api/routes/public.campaign.controller';
import { PublicAnalyticsController } from '@gitroom/backend/public-api/routes/public.analytics.controller';
import { PublicAuthMiddleware } from '@gitroom/backend/services/auth/public.auth.middleware';
import { AnalyticsService } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import { AnalyticsShareService } from '@gitroom/nestjs-libraries/analytics/analytics-share.service';
import { AnalyticsLiveFallbackService } from '@gitroom/nestjs-libraries/analytics/analytics-live-fallback';
import { AnalyticsOverviewService } from '@gitroom/nestjs-libraries/analytics/analytics-overview.service';
import { AnalyticsDetailService } from '@gitroom/nestjs-libraries/analytics/analytics-detail.service';
import { AnalyticsInsightsService } from '@gitroom/nestjs-libraries/analytics/analytics-insights.service';
import { AnalyticsExportService } from '@gitroom/nestjs-libraries/analytics/analytics-export.service';
import { IdempotencyFactory } from '@gitroom/nestjs-libraries/ai/governance/idempotency.factory';

const authenticatedController = [PublicIntegrationsController];
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
