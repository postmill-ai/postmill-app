import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ParseCuidPipe } from '@gitroom/nestjs-libraries/pipes/parse-cuid.pipe';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ApiTags } from '@nestjs/swagger';
import { AnalyticsService, BestTimeEntry } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import { AnalyticsShareService } from '@gitroom/nestjs-libraries/analytics/analytics-share.service';
import {
  AnalyticsDateRangeDto,
  AnalyticsPostsQueryDto,
  AnalyticsExportQueryDto,
  UpdateWatchlistDto,
} from '@gitroom/nestjs-libraries/dtos/analytics/analytics.query.dto';
import {
  CreateAlertRuleDto,
  UpdateAlertRuleDto,
  AnalyticsShareDto,
} from '@gitroom/nestjs-libraries/dtos/analytics/alert-rule.dto';
import { isKnownMetric } from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';
import { Response } from 'express';
import dayjs from 'dayjs';
import { WatchlistService } from '@gitroom/nestjs-libraries/database/prisma/watchlist/watchlist.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { IsString, IsOptional, IsIn, MinLength, MaxLength, isUUID } from 'class-validator';

// Date-range helpers live in the shared util (used by the campaigns + public
// controllers too); re-exported here for back-compat with existing imports.
import {
  validateDateRange,
  validateToGteFrom,
  validateWindowCap,
} from '@gitroom/nestjs-libraries/analytics/date-range.validation';

export { validateDateRange, validateToGteFrom, validateWindowCap };

export function parseIntegrations(integrations?: string): string[] {
  if (!integrations) return [];
  return integrations.split(',').filter(Boolean);
}

// Parse the comma-separated `campaigns` query param into a validated uuid list
// (1.2). Malformed ids are rejected (400) rather than silently dropped so a
// typo never widens/narrows a campaign scope unexpectedly.
export function parseCampaigns(raw?: string): string[] {
  if (!raw) return [];
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of ids) {
    if (!isUUID(id)) {
      throw new BadRequestException(`Invalid campaign id: ${id}`);
    }
  }
  return ids;
}

export function parsePage(page?: number): number {
  return (page || 1);
}

export function parseLimit(limit?: number): number {
  const l = (limit || 20);
  return Math.min(l, 100);
}

export function parseCompare(compare?: string): boolean {
  return compare?.toLowerCase() === 'true';
}

export interface BestTimeResponse {
  heatmap: BestTimeEntry[];
  bestSlots: { day: number; hour: number; avgEngagement: number }[];
}

class AddWatchlistDto {
  @IsIn(['twitter', 'linkedin', 'instagram', 'facebook', 'youtube', 'tiktok'])
  provider!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  handle!: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

@ApiTags('Analytics V2')
@Controller('/analytics/v2')
export class AnalyticsV2Controller {
  constructor(
    private _analyticsService: AnalyticsService,
    private _watchlistService: WatchlistService,
    private _shareService: AnalyticsShareService,
  ) {}

  @Get('/overview')
  async getOverview(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AnalyticsDateRangeDto
  ) {
    validateDateRange(query.from, query.to);
    validateToGteFrom(query.from, query.to);
    validateWindowCap(query.from, query.to);
    return this._analyticsService.getOverview(
      org,
      query.from,
      query.to,
      parseIntegrations(query.integrations),
      parseCompare(query.compare),
      { campaignIds: parseCampaigns(query.campaigns) }
    );
  }

  @Get('/channel/:integrationId')
  async getChannel(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
    @Query() query: AnalyticsDateRangeDto
  ) {
    validateDateRange(query.from, query.to);
    validateToGteFrom(query.from, query.to);
    validateWindowCap(query.from, query.to);
    return this._analyticsService.getChannel(
      org,
      integrationId,
      query.from,
      query.to,
      parseCompare(query.compare)
    );
  }

  @Get('/posts')
  async getPosts(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AnalyticsPostsQueryDto
  ) {
    validateDateRange(query.from, query.to);
    validateToGteFrom(query.from, query.to);
    validateWindowCap(query.from, query.to);
    return this._analyticsService.getPosts(
      org,
      query.from,
      query.to,
      parseIntegrations(query.integrations),
      query.sort,
      query.dir || 'desc',
      parsePage(query.page),
      parseLimit(query.limit),
      { campaignIds: parseCampaigns(query.campaigns) }
    );
  }

  @Get('/post/:postId')
  async getPostDetail(
    @GetOrgFromRequest() org: Organization,
    @Param('postId', ParseCuidPipe) postId: string,
    @Query('date') date?: string
  ) {
    return this._analyticsService.getPostDetail(org, postId, date);
  }

  @Get('/metric/:metric')
  async getMetric(
    @GetOrgFromRequest() org: Organization,
    @Param('metric') metric: string,
    @Query() query: AnalyticsDateRangeDto
  ) {
    validateDateRange(query.from, query.to);
    validateToGteFrom(query.from, query.to);
    validateWindowCap(query.from, query.to);
    return this._analyticsService.getMetricDetail(
      org,
      metric,
      query.from,
      query.to,
      parseIntegrations(query.integrations),
      parseCompare(query.compare),
      { campaignIds: parseCampaigns(query.campaigns) }
    );
  }

  @Get('/day')
  async getDay(
    @GetOrgFromRequest() org: Organization,
    @Query('date') date: string,
    @Query('metric') metric: string,
    @Query('integrations') integrations: string,
    @Query('campaigns') campaigns?: string
  ) {
    if (!date || !dayjs(date).isValid()) {
      throw new BadRequestException('date must be a valid date');
    }
    if (!isKnownMetric(metric)) {
      throw new BadRequestException('metric must be a known metric');
    }
    return this._analyticsService.getDayDetail(
      org,
      date,
      metric,
      parseIntegrations(integrations),
      { campaignIds: parseCampaigns(campaigns) }
    );
  }

  @Get('/channel/:integrationId/metric/:metric')
  async getChannelMetric(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
    @Param('metric') metric: string,
    @Query() query: AnalyticsDateRangeDto
  ) {
    validateDateRange(query.from, query.to);
    validateToGteFrom(query.from, query.to);
    validateWindowCap(query.from, query.to);
    return this._analyticsService.getChannelMetric(
      org,
      integrationId,
      metric,
      query.from,
      query.to,
      parseCompare(query.compare)
    );
  }

  @Get('/best-time')
  async getBestTime(
    @GetOrgFromRequest() org: Organization,
    @Query('integrations') integrations: string,
    // 6.4 — optional single-channel grouping + caller's IANA timezone (post
    // dates are stored UTC; without `tz` the heatmap is UTC-shifted).
    @Query('integration') integration?: string,
    @Query('tz') tz?: string,
  ) {
    const ids = integration
      ? [integration]
      : parseIntegrations(integrations);
    return this._analyticsService.getBestTimeData(org.id, ids, tz);
  }

  @Get('/recommendations')
  async getRecommendations(
    @GetOrgFromRequest() org: Organization,
  ) {
    return this._analyticsService.getRecommendations(org);
  }

  // ── 6.6: data-health panel ──
  @Get('/health')
  async getHealth(@GetOrgFromRequest() org: Organization) {
    return this._analyticsService.getDataHealth(org);
  }

  // ── 6.7: on-demand channel refresh ──
  // Per-route throttle (~6/hour) — this triggers a live provider fetch, so the
  // limit is load-bearing (a provider-API hammer if abused). Over the limit the
  // ThrottlerBehindProxyGuard returns 429; provider failures surface as 502.
  @Throttle({ default: { limit: 6, ttl: 3600000 } })
  @Post('/refresh/:integrationId')
  @RequirePermission('analytics', 'update')
  async refreshChannel(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
  ) {
    return this._analyticsService.refreshChannel(org, integrationId);
  }

  // ── 7.4: content-attribute intelligence ("what works") ──
  @Get('/content-insights')
  async getContentInsights(@GetOrgFromRequest() org: Organization) {
    return this._analyticsService.getContentInsights(org);
  }

  // ── 7.5: LLM-narrated summary ──
  // Budget-gated (429 on exceeded) FIRST, mirroring the CopilotKit /chat gate.
  // The no-provider rule is enforced in the service (standard "AI not
  // configured" error, no env-key fallback).
  @Post('/narrate')
  @RequirePermission('analytics', 'read')
  async narrate(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AnalyticsDateRangeDto,
  ) {
    validateDateRange(query.from, query.to);
    validateToGteFrom(query.from, query.to);
    validateWindowCap(query.from, query.to);

    return this._analyticsService.narrate(org, query.from, query.to);
  }

  @Get('/export')
  async exportData(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AnalyticsExportQueryDto,
    @Res({ passthrough: true }) res: Response
  ) {
    validateDateRange(query.from, query.to);
    validateToGteFrom(query.from, query.to);
    validateWindowCap(query.from, query.to);
    if (query.format && !['csv', 'json'].includes(query.format)) {
      throw new BadRequestException('format must be csv or json');
    }
    const parsedFormat = query.format === 'csv' ? 'csv' : 'json';

    const result = await this._analyticsService.exportData(
      org,
      query.from,
      query.to,
      parseIntegrations(query.integrations),
      parsedFormat,
      parseCompare(query.compare),
      { campaignIds: parseCampaigns(query.campaigns) }
    );

    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="analytics-export.${
        parsedFormat === 'csv' ? 'csv' : 'json'
      }"`
    );
    return result.data;
  }

  // ── Anomaly alerts (Phase 4) ──

  @Get('/anomalies')
  async listAnomalies(
    @GetOrgFromRequest() org: Organization,
    @Query('includeDismissed') includeDismissed?: string,
  ) {
    return this._analyticsService.listAnomalies(org.id, {
      includeDismissed: includeDismissed === 'true',
    });
  }

  @Post('/anomalies/:id/dismiss')
  @RequirePermission('analytics', 'update')
  async dismissAnomaly(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    return this._analyticsService.dismissAnomaly(org.id, id);
  }

  // ── 7.3: user-defined alert rules (org-scoped CRUD) ──

  @Get('/alert-rules')
  async listAlertRules(@GetOrgFromRequest() org: Organization) {
    return this._analyticsService.listAlertRules(org.id);
  }

  @Post('/alert-rules')
  @RequirePermission('analytics', 'update')
  async createAlertRule(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateAlertRuleDto,
  ) {
    return this._analyticsService.createAlertRule(org.id, body);
  }

  @Put('/alert-rules/:id')
  @RequirePermission('analytics', 'update')
  async updateAlertRule(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateAlertRuleDto,
  ) {
    return this._analyticsService.updateAlertRule(org.id, id, body);
  }

  @Delete('/alert-rules/:id')
  @RequirePermission('analytics', 'update')
  async deleteAlertRule(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    return this._analyticsService.deleteAlertRule(org.id, id);
  }

  // ── 7.6: org-level public share dashboard ──

  // The GET returns the live share token (= the public link). Reading it is
  // part of MANAGING sharing, so it carries the same gate as mint/disable —
  // a viewer-role member shouldn't be able to lift the org-wide public link.
  @Get('/share')
  @RequirePermission('analytics', 'update')
  async getShare(@GetOrgFromRequest() org: Organization) {
    return this._shareService.getShare(org.id);
  }

  @Post('/share')
  @RequirePermission('analytics', 'update')
  async mintShare(
    @GetOrgFromRequest() org: Organization,
    @Body() body: AnalyticsShareDto,
  ) {
    const share = await this._shareService.mintShare(org.id, {
      integrations: body.integrations,
      rangePreset: body.rangePreset,
    });
    return { token: share.token, enabled: share.enabled, config: share.config };
  }

  @Delete('/share')
  @RequirePermission('analytics', 'update')
  async disableShare(@GetOrgFromRequest() org: Organization) {
    return this._shareService.disableShare(org.id);
  }

  // ── Watchlist CRUD ──

  @Get('/watchlist')
  async listWatchlist(@GetOrgFromRequest() org: Organization) {
    return this._watchlistService.list(org.id);
  }

  // ── 6.3: competitor overlay — watched-account metric series + own followers ──
  // Returns the watched account's follower series and, when a date range is
  // given, the org's own-channel follower series so the UI can chart them on one
  // axis (competitors dashed).
  @Get('/watchlist/:id/series')
  async getWatchlistSeries(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query('metric') metric?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const watched = await this._watchlistService.getSeries(
      id,
      org.id,
      metric || 'followers',
    );
    let own: Awaited<ReturnType<AnalyticsService['getFollowerSeries']>> = [];
    if (from || to) {
      // Explicit dates must be valid — 400 like every other date route
      // (previously invalid dates were silently ignored → own: []).
      validateDateRange(from!, to!);
      validateToGteFrom(from!, to!);
      validateWindowCap(from!, to!);
      own = await this._analyticsService.getFollowerSeries(org.id, from!, to!);
    }
    return { watched, own };
  }

  @Post('/watchlist')
  @RequirePermission('analytics', 'update')
  @CheckPolicies([AuthorizationActions.Create, Sections.COMPETITORS])
  async addWatchlistEntry(
    @GetOrgFromRequest() org: Organization,
    @Body() body: AddWatchlistDto,
  ) {
    return this._watchlistService.add({
      organizationId: org.id,
      provider: body.provider,
      handle: body.handle,
      displayName: body.displayName,
    });
  }

  @Put('/watchlist/:id')
  @RequirePermission('analytics', 'update')
  async updateWatchlistEntry(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() dto: UpdateWatchlistDto,
  ) {
    return this._watchlistService.update(id, org.id, {
      displayName: dto.displayName,
      enabled: dto.enabled,
    });
  }

  @Delete('/watchlist/:id')
  @RequirePermission('analytics', 'update')
  async deleteWatchlistEntry(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    await this._watchlistService.remove(id, org.id);
    return { success: true };
  }

  @Get('/shortlinks')
  async getShortLinks(
    @GetOrgFromRequest() org: Organization,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ) {
    const from = fromStr ? new Date(fromStr) : dayjs().subtract(30, 'day').toDate();
    const to = toStr ? new Date(toStr) : dayjs().toDate();

    return this._analyticsService.getShortLinks(org.id, from, to);
  }

  @Get('/shortlinks/timeseries')
  async getShortLinkTimeseries(
    @GetOrgFromRequest() org: Organization,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ) {
    const from = fromStr ? new Date(fromStr) : dayjs().subtract(30, 'day').toDate();
    const to = toStr ? new Date(toStr) : dayjs().toDate();

    return this._analyticsService.getShortLinkTimeseries(org.id, from, to);
  }
}
