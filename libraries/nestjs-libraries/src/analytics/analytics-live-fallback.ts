// Live-fallback machinery extracted from analytics.service.ts (5.3, 0.7).
// When persisted snapshot coverage is thin the overview/detail reads fall back
// to a bounded live provider fetch. Injected directly with its own deps
// (IntegrationService + IntegrationManager + AnalyticsRepository) — it never
// reaches back into the facade, so there is no DI cycle.

import { Injectable } from '@nestjs/common';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { mapWithConcurrency } from '@gitroom/nestjs-libraries/utils/concurrency';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { AnalyticsRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';
import { normalizeMetric } from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';
import { Organization } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { SnapshotLike } from './analytics.types';

dayjs.extend(utc);

export { SnapshotLike };

export const FALLBACK_THRESHOLD = 0.5;

@Injectable()
export class AnalyticsLiveFallbackService {
  constructor(
    private analyticsRepository: AnalyticsRepository,
    private integrationManager: IntegrationManager,
    private integrationService: IntegrationService,
  ) {}

  // Integrations whose provider actually implements analytics() — the only ones
  // the live fallback could ever populate. Channels on no-analytics providers
  // (Discord/Slack/…) must be excluded from the coverage denominator, else such
  // an org is permanently "under-covered" and hammers the fallback forever (0.6).
  analyticsSupportingIds(
    dbIntegrations: { id: string; providerIdentifier: string; providerVersion?: string | null }[],
  ): string[] {
    return dbIntegrations
      .filter((i) => {
        try {
          return !!this.integrationManager.getSocialIntegrationUnchecked(
            i.providerIdentifier,
            i.providerVersion ?? undefined,
          )?.analytics;
        } catch {
          return false;
        }
      })
      .map((i) => i.id);
  }

  // Coverage = distinct (integrationId, date) pairs ÷ (analytics-capable channel
  // count × window days), so one metric on one channel no longer masks entirely
  // missing channels (0.6). FALLBACK_THRESHOLD stays 0.5.
  async checkCoverage(
    orgId: string,
    dbIntegrations: { id: string; providerIdentifier: string; providerVersion?: string | null }[],
    from: Date,
    to: Date
  ): Promise<number> {
    if (!from || !to) return 0;
    const totalDays = dayjs(to).diff(dayjs(from), 'day') + 1;
    if (totalDays <= 0) return 0;

    const supportingIds = this.analyticsSupportingIds(dbIntegrations);
    // No analytics-capable channels → nothing the fallback could fetch; report
    // full coverage so it never fires (past prod CPU/mem incident guard).
    if (supportingIds.length === 0) return 1;

    const pairs = await this.analyticsRepository.checkCoverage(
      orgId,
      supportingIds,
      from,
      to,
    );

    return pairs.length / (supportingIds.length * totalDays);
  }

  async fetchLiveFallback(
    org: Organization,
    integrationIds: string[],
    from: Date,
    to: Date
  ) {
    const providerData: Record<string, any[]> = {};

    // Bounded concurrency (5): this is the live-provider fan-out that caused a past prod
    // CPU/mem incident — an unbounded Promise.all here would re-create it. Each worker
    // writes a distinct integrationId key, so the shared record has no write race.
    await mapWithConcurrency(integrationIds, 5, async (integrationId) => {
      try {
        const data = await this.integrationService.checkAnalytics(
          org,
          integrationId,
          dayjs(to).diff(dayjs(from), 'day').toString()
        );
        if (Array.isArray(data)) {
          providerData[integrationId] = data;
        }
      } catch {
        // per-integration failures are non-fatal
      }
    });

    return providerData;
  }

  convertLiveToSnapshots(
    providerData: Record<string, any[]>,
    orgId: string,
    integrationMap: Record<string, string>,
    from: Date,
    to: Date
  ) {
    const rows: {
      organizationId: string;
      integrationId: string;
      metric: string;
      value: number;
      date: Date;
    }[] = [];

    for (const [integrationId, data] of Object.entries(providerData)) {
      if (!data) continue;
      const providerIdentifier = integrationMap[integrationId] || '';

      for (const item of data) {
        // R4.1(a): skip items without a usable label — a `label: undefined`
        // otherwise throws TypeError on `.toLowerCase()`, surfacing as an
        // uncaught 500 through refreshChannel (which only try/catches the
        // provider call, not this conversion).
        if (typeof item?.label !== 'string' || !item.label) continue;

        const normalized =
          normalizeMetric(providerIdentifier, item.label) ||
          item.label.toLowerCase().replace(/\s+/g, '_');

        for (const dp of item.data || []) {
          // R4.1(b): normalize to midnight so a refresh persists on the same
          // (integrationId, metric, date) key the daily sweep uses — otherwise a
          // raw timestamp adds a second same-day row buildFilledDayMap
          // double-counts forever.
          const dpDate = dayjs(dp.date).startOf('day').toDate();
          if (dpDate >= from && dpDate <= to) {
            rows.push({
              organizationId: orgId,
              integrationId,
              metric: normalized,
              value: Number(dp.total) || 0,
              date: dpDate,
            });
          }
        }
      }
    }

    return rows;
  }

  async tryLiveFallback(
    snapshots: SnapshotLike[],
    org: Organization,
    integrationIds: string[],
    dbIntegrations: { id: string; providerIdentifier: string; providerVersion?: string | null }[],
    fromDate: Date,
    toDate: Date,
    metric?: string,
  ): Promise<SnapshotLike[]> {
    try {
      const live = await this.fetchLiveFallback(org, integrationIds, fromDate, toDate);
      const integrationMap = Object.fromEntries(
        dbIntegrations.map((i) => [i.id, i.providerIdentifier])
      );
      let liveRows = this.convertLiveToSnapshots(live, org.id, integrationMap, fromDate, toDate);
      if (metric) {
        liveRows = liveRows.filter((r) => r.metric === metric);
      }
      if (liveRows.length > 0) {
        // liveRows already carry { integrationId, metric, value, date } — the
        // full SnapshotLike shape; no Prisma-row shape-faking (0.7).
        return liveRows;
      }
    } catch {
      // fallback silently
    }
    return snapshots;
  }

  async applyLiveFallbackIfNeeded(
    org: Organization,
    integrationIds: string[],
    dbIntegrations: { id: string; providerIdentifier: string; providerVersion?: string | null }[],
    fromDate: Date,
    toDate: Date,
    currentSnapshots: SnapshotLike[],
    metric?: string,
  ): Promise<SnapshotLike[]> {
    const coverage = await this.checkCoverage(org.id, dbIntegrations, fromDate, toDate);
    if (coverage >= FALLBACK_THRESHOLD) return currentSnapshots;
    return this.tryLiveFallback(currentSnapshots, org, integrationIds, dbIntegrations, fromDate, toDate, metric);
  }
}
