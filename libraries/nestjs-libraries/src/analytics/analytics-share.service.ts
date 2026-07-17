import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import dayjs from 'dayjs';
import { Organization } from '@prisma/client';
import { AnalyticsRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';
import { AnalyticsOverviewService } from './analytics-overview.service';
import {
  AnalyticsShareConfig,
  validateAnalyticsShareConfig,
} from '@gitroom/nestjs-libraries/dtos/analytics/analytics-share-config.dto';

// 7.6 — org-level public share dashboard.
//
// One share config per org (AnalyticsShare.organizationId is @@unique — the
// campaign single-token pattern). A 64-hex CSPRNG token (same crypto as
// CampaignsService.mintShareToken) addresses the public report; re-minting
// rotates the token, invalidating any previously-shared link. The public report
// is an EXPLICIT WHITELIST — that whitelist IS the security boundary (no ids, no
// org metadata, no integrationId ever cross it).

// Rolling-range presets → a from/to pair resolved at read time so a shared link
// always shows a live trailing window.
function resolveRange(rangePreset?: string): { from: string; to: string } {
  const days =
    rangePreset === '7d' ? 7 : rangePreset === '90d' ? 90 : 30; // default 30d
  const to = dayjs().format('YYYY-MM-DD');
  const from = dayjs().subtract(days, 'day').format('YYYY-MM-DD');
  return { from, to };
}

@Injectable()
export class AnalyticsShareService {
  constructor(
    private _analyticsRepository: AnalyticsRepository,
    private _overviewService: AnalyticsOverviewService,
  ) {}

  getShare(orgId: string) {
    return this._analyticsRepository.getShareByOrg(orgId);
  }

  // Mint (or rotate) the share token and enable sharing. Upsert on the unique
  // organizationId, so a re-mint rotates the token in place.
  async mintShare(orgId: string, rawConfig: unknown) {
    const config = validateAnalyticsShareConfig(rawConfig ?? {});
    const token = randomBytes(32).toString('hex');
    return this._analyticsRepository.upsertShare(orgId, {
      token,
      config: config as Record<string, unknown>,
      enabled: true,
    });
  }

  async disableShare(orgId: string): Promise<{ success: boolean }> {
    await this._analyticsRepository.disableShare(orgId);
    return { success: true };
  }

  // Resolve a token → enabled share → compute the overview under the share's
  // config and return the explicit whitelist. Null when the token is unknown or
  // sharing is disabled (rotated tokens no longer match → null → controller 404).
  async buildPublicReport(token: string) {
    const share = await this._analyticsRepository.getShareByToken(token);
    if (!share || !share.enabled) {
      return null;
    }

    const config = (share.config as AnalyticsShareConfig) || {};
    const { from, to } = resolveRange(config.rangePreset);

    const overview = await this._overviewService.getOverview(
      { id: share.organizationId } as Organization,
      from,
      to,
      config.integrations ?? [],
      false,
      {},
    );

    // EXPLICIT WHITELIST — the security boundary. Only KPIs, the trend series,
    // per-channel display name + provider identifier + KPIs, and the window.
    // Never an id (integrationId), a picture, or any org metadata.
    return {
      range: overview.range,
      kpis: overview.kpis,
      series: overview.series,
      byChannel: overview.byChannel.map((c) => ({
        name: c.name,
        identifier: c.identifier,
        kpis: c.kpis,
      })),
    };
  }
}
