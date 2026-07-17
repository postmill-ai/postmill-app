import { PrismaRepository, PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Injectable()
export class AnalyticsRepository {
  constructor(
    private _analyticsSnapshot: PrismaRepository<'analyticsSnapshot'>,
    private _postAnalyticsSnapshot: PrismaRepository<'postAnalyticsSnapshot'>,
    private _integration: PrismaRepository<'integration'>,
    private _post: PrismaRepository<'post'>,
    private _analyticsAnomaly: PrismaRepository<'analyticsAnomaly'>,
    private _prisma: PrismaService,
  ) {}

  getSnapshots(
    orgId: string,
    integrationIds: string[],
    from: Date,
    to: Date,
  ) {
    return this._analyticsSnapshot.model.analyticsSnapshot.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        date: { gte: from, lte: to },
      },
      orderBy: { date: 'asc' },
    });
  }

  getPostSnapshots(
    orgId: string,
    integrationIds: string[],
    from: Date,
    to: Date,
  ) {
    return this._postAnalyticsSnapshot.model.postAnalyticsSnapshot.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        date: { gte: from, lte: to },
      },
      orderBy: { date: 'asc' },
    });
  }

  // Campaign-scoped post snapshots (1.1): post metrics joined through
  // Post.campaignId (posts are single-campaign). Rows are a superset of
  // SnapshotLike (integrationId/metric/value/date), so they feed the same
  // aggregation/day-map machinery the channel path uses. Channel-level
  // AnalyticsSnapshot metrics are intentionally NOT included — they are not
  // attributable to a campaign.
  getPostSnapshotsByCampaigns(
    orgId: string,
    campaignIds: string[],
    from: Date,
    to: Date,
    integrationIds?: string[],
  ) {
    return this._postAnalyticsSnapshot.model.postAnalyticsSnapshot.findMany({
      where: {
        organizationId: orgId,
        date: { gte: from, lte: to },
        ...(integrationIds ? { integrationId: { in: integrationIds } } : {}),
        post: { campaignId: { in: campaignIds }, deletedAt: null },
      },
      orderBy: { date: 'asc' },
    });
  }

  // R1.3: latest post-snapshot LEVEL strictly before `before`, one row per
  // (postId, metric), for the same campaign/integration scoping as
  // getPostSnapshotsByCampaigns. This is the per-post baseline the level-
  // differencing aggregation subtracts so an in-window total is a true window
  // delta, not the cumulative running total. Missing (post, metric) ⇒ baseline 0.
  async getLatestPostSnapshotsBeforeByCampaigns(
    orgId: string,
    campaignIds: string[],
    before: Date,
    integrationIds?: string[],
  ): Promise<{ postId: string; metric: string; value: number }[]> {
    // Raw DISTINCT ON, not Prisma `distinct`: without the nativeDistinct
    // preview feature Prisma dedups findMany results IN THE CLIENT, shipping
    // every pre-window row (unbounded — rollup keeps post rows forever) from
    // the DB on each campaign-scoped request. DISTINCT ON pushes the
    // latest-per-(post, metric) selection into Postgres.
    if (campaignIds.length === 0) return [];
    if (integrationIds && integrationIds.length === 0) return [];
    return this._prisma.$queryRaw<
      Array<{ postId: string; metric: string; value: number }>
    >`
      SELECT DISTINCT ON (pas."postId", pas."metric")
        pas."postId", pas."metric", pas."value"
      FROM "PostAnalyticsSnapshot" pas
      JOIN "Post" p ON p."id" = pas."postId"
      WHERE
        pas."organizationId" = ${orgId}
        AND pas."date" < ${before}
        AND p."campaignId" IN (${Prisma.join(campaignIds)})
        AND p."deletedAt" IS NULL
        ${
          integrationIds
            ? Prisma.sql`AND pas."integrationId" IN (${Prisma.join(integrationIds)})`
            : Prisma.empty
        }
      ORDER BY pas."postId", pas."metric", pas."date" DESC
    `;
  }

  // Campaign-scoped post list (1.1) — mirrors findPosts but scopes by
  // Post.campaignId instead of channel.
  getPostsByCampaigns(
    orgId: string,
    campaignIds: string[],
    from: Date,
    to: Date,
    skip?: number,
    take?: number,
  ) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        campaignId: { in: campaignIds },
        publishDate: { gte: from, lte: to },
        deletedAt: null,
      },
      include: { integration: true },
      orderBy: { publishDate: 'desc' },
      ...(skip !== undefined ? { skip } : {}),
      ...(take !== undefined ? { take } : {}),
    });
  }

  // Campaign-scoped post count (1.1) — pagination total for getPostsByCampaigns.
  countPostsByCampaigns(
    orgId: string,
    campaignIds: string[],
    from: Date,
    to: Date,
  ) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        campaignId: { in: campaignIds },
        publishDate: { gte: from, lte: to },
        deletedAt: null,
      },
    });
  }

  getIntegrations(orgId: string, integrationIds: string[]) {
    return this._integration.model.integration.findMany({
      where: {
        organizationId: orgId,
        id: { in: integrationIds },
        deletedAt: null,
        disabled: false,
      },
    });
  }

  // Coverage is measured as distinct (integrationId, date) pairs so that one
  // metric on one channel no longer masks entirely-missing channels (0.6).
  checkCoverage(orgId: string, integrationIds: string[], from: Date, to: Date) {
    return this._analyticsSnapshot.model.analyticsSnapshot.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        date: { gte: from, lte: to },
      },
      select: { integrationId: true, date: true },
      distinct: ['integrationId', 'date'],
    });
  }

  // Most recent snapshot date per integration (6.6 data-health). groupBy _max so
  // one query covers every channel; integrations with no snapshot are absent.
  async getLastSnapshotDates(
    orgId: string,
    integrationIds: string[],
  ): Promise<{ integrationId: string; date: Date | null }[]> {
    if (integrationIds.length === 0) return [];
    const rows = await this._analyticsSnapshot.model.analyticsSnapshot.groupBy({
      by: ['integrationId'],
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
      },
      _max: { date: true },
    });
    return rows.map((r) => ({ integrationId: r.integrationId, date: r._max.date }));
  }

  // 90-day published posts + the denormalized engagement counters written by the
  // sweep, in one query (7.4 content-attribute intelligence). image/campaignId
  // ride along for the attribute derivation.
  getContentInsightPosts(orgId: string, from: Date) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        releaseId: { not: null },
        publishDate: { gte: from },
        deletedAt: null,
      },
      select: {
        id: true,
        content: true,
        image: true,
        campaignId: true,
        publishDate: true,
        lastViews: true,
        lastLikes: true,
        lastComments: true,
      },
      orderBy: { publishDate: 'desc' },
      take: 2000,
    });
  }

  // Per-integration sum of a flow metric over a window — the real
  // previous-window baseline for recommendations/anomaly work (0.1).
  async sumFlowMetric(
    orgId: string,
    integrationIds: string[],
    metric: string,
    from: Date,
    to: Date,
  ): Promise<Record<string, number>> {
    if (integrationIds.length === 0) return {};
    const rows = await this._analyticsSnapshot.model.analyticsSnapshot.groupBy({
      by: ['integrationId'],
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        metric,
        date: { gte: from, lte: to },
      },
      _sum: { value: true },
    });
    return Object.fromEntries(
      rows.map((r) => [r.integrationId, r._sum.value || 0]),
    );
  }

  findPosts(
    orgId: string,
    integrationIds: string[],
    from: Date,
    to: Date,
    skip?: number,
    take?: number,
  ) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        publishDate: { gte: from, lte: to },
        deletedAt: null,
      },
      include: { integration: true },
      orderBy: { publishDate: 'desc' },
      ...(skip !== undefined ? { skip } : {}),
      ...(take !== undefined ? { take } : {}),
    });
  }

  countPosts(orgId: string, integrationIds: string[], from: Date, to: Date) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        publishDate: { gte: from, lte: to },
        deletedAt: null,
      },
    });
  }

  findPost(orgId: string, postId: string) {
    return this._post.model.post.findFirst({
      where: { id: postId, organizationId: orgId, deletedAt: null },
      include: { integration: true },
    });
  }

  getPostDetailSnapshots(orgId: string, postId: string, from: Date, to: Date) {
    return this._postAnalyticsSnapshot.model.postAnalyticsSnapshot.findMany({
      where: {
        postId,
        organizationId: orgId,
        date: { gte: from, lte: to },
      },
      orderBy: { date: 'asc' },
    });
  }

  getMetricDetailTopPosts(
    orgId: string,
    integrationIds: string[],
    metric: string,
    from: Date,
    to: Date,
  ) {
    return this._postAnalyticsSnapshot.model.postAnalyticsSnapshot.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        metric,
        date: { gte: from, lte: to },
      },
      include: {
        post: { select: { content: true, publishDate: true } },
      },
      orderBy: { value: 'desc' },
      // Rows, not posts: a post snapshotted daily appears once per day. Fetch a
      // deeper page so consumers can dedup to distinct posts and still fill 10.
      take: 50,
    });
  }

  getDayAnalyticsSnapshots(
    orgId: string,
    integrationIds: string[],
    metric: string,
    dateStart: Date,
    dateEnd: Date,
  ) {
    return this._analyticsSnapshot.model.analyticsSnapshot.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        metric,
        date: { gte: dateStart, lte: dateEnd },
      },
    });
  }

  getDayPostSnapshots(
    orgId: string,
    integrationIds: string[],
    metric: string,
    dateStart: Date,
    dateEnd: Date,
  ) {
    return this._postAnalyticsSnapshot.model.postAnalyticsSnapshot.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        metric,
        date: { gte: dateStart, lte: dateEnd },
      },
      include: { post: { select: { content: true, publishDate: true } } },
    });
  }

  // Single round-trip root-cause read for anomaly detection (ANALYTICS-06):
  // fetches day-post snapshots for every fired (integration, metric) group at
  // once, bounded by the union of their candidate dates.
  getDayPostSnapshotsForGroups(
    orgId: string,
    groups: { integrationId: string; metric: string }[],
    dateStart: Date,
    dateEnd: Date,
  ) {
    if (groups.length === 0) return Promise.resolve([]);
    return this._postAnalyticsSnapshot.model.postAnalyticsSnapshot.findMany({
      where: {
        organizationId: orgId,
        date: { gte: dateStart, lte: dateEnd },
        OR: groups.map((g) => ({
          integrationId: g.integrationId,
          metric: g.metric,
        })),
      },
      include: { post: { select: { content: true, publishDate: true } } },
    });
  }

  getChannelAnalyticsSnapshots(
    orgId: string,
    integrationId: string,
    metric: string,
    from: Date,
    to: Date,
  ) {
    return this._analyticsSnapshot.model.analyticsSnapshot.findMany({
      where: {
        organizationId: orgId,
        integrationId,
        metric,
        date: { gte: from, lte: to },
      },
      orderBy: { date: 'asc' },
    });
  }

  // Single latest-post-snapshot reader (0.5). Callers pass the metric list they
  // care about; rows come newest-first so a first-seen-wins reduce yields the
  // latest value per (postId, metric).
  getLatestPostSnapshots(orgId: string, postIds: string[], metrics: string[]) {
    return this._postAnalyticsSnapshot.model.postAnalyticsSnapshot.findMany({
      where: {
        organizationId: orgId,
        postId: { in: postIds },
        metric: { in: metrics },
      },
      orderBy: { date: 'desc' },
      select: { postId: true, metric: true, value: true },
    });
  }

  getChannelPostSnapshots(
    orgId: string,
    integrationId: string,
    metric: string,
    from: Date,
    to: Date,
  ) {
    return this._postAnalyticsSnapshot.model.postAnalyticsSnapshot.findMany({
      where: {
        organizationId: orgId,
        integrationId,
        metric,
        date: { gte: from, lte: to },
      },
      include: { post: { select: { content: true, publishDate: true } } },
      orderBy: { value: 'desc' },
      // Rows, not posts — deeper page for per-post dedup (see above).
      take: 50,
    });
  }

  getBestTimeIntegrations(orgId: string) {
    return this._integration.model.integration.findMany({
      where: { organizationId: orgId, deletedAt: null, disabled: false },
      select: {
        id: true,
        name: true,
        providerIdentifier: true,
        providerVersion: true,
        picture: true,
      },
    });
  }

  getBestTimePosts(
    orgId: string,
    integrationIds: string[],
    dateThreshold: Date,
  ) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        publishDate: { gte: dateThreshold },
        deletedAt: null,
      },
      select: {
        id: true,
        publishDate: true,
        integrationId: true,
        lastViews: true,
        lastLikes: true,
        lastComments: true,
      },
      orderBy: [{ publishDate: 'desc' }, { id: 'desc' }],
      take: 500,
    });
  }

  async getCommentBacklogCount(orgId: string): Promise<number> {
    const count = await this._prisma.$queryRaw<[{ count: number }]>`
      SELECT COUNT(*)::int as count FROM "SocialComment" sc
      WHERE sc."organizationId" = ${orgId}
        AND sc."deletedAt" IS NULL
        AND sc."isOwn" = ${false}
        AND sc."status" IS DISTINCT FROM ${'handled'}
    `;
    return Number(count[0]?.count || 0);
  }

  getBestTimeSnapshots(
    orgId: string,
    integrationIds: string[],
    dateThreshold: Date,
    metrics: string[],
  ) {
    return this._analyticsSnapshot.model.analyticsSnapshot.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        date: { gte: dateThreshold },
        metric: { in: metrics },
      },
      orderBy: { date: 'asc' },
    });
  }

  // ── AnalyticsActivity extraction (D2): collection-sweep data access ──

  upsertChannelSnapshot(params: {
    organizationId: string;
    integrationId: string;
    metric: string;
    value: number;
    date: Date;
  }) {
    return this._analyticsSnapshot.model.analyticsSnapshot.upsert({
      where: {
        integrationId_metric_date: {
          integrationId: params.integrationId,
          metric: params.metric,
          date: params.date,
        },
      },
      create: {
        organizationId: params.organizationId,
        integrationId: params.integrationId,
        metric: params.metric,
        value: params.value,
        date: params.date,
      },
      update: { value: params.value },
    });
  }

  findPostsForSnapshots(
    orgId: string,
    since: Date,
    take = 500,
    cursor?: string,
  ) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        releaseId: { not: null },
        publishDate: { gte: since },
        // Soft-deleted posts must not keep being polled for provider metrics.
        deletedAt: null,
      },
      include: { integration: true },
      orderBy: { id: 'asc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  upsertPostSnapshot(params: {
    organizationId: string;
    postId: string;
    integrationId: string;
    metric: string;
    value: number;
    date: Date;
  }) {
    return this._postAnalyticsSnapshot.model.postAnalyticsSnapshot.upsert({
      where: {
        postId_metric_date: {
          postId: params.postId,
          metric: params.metric,
          date: params.date,
        },
      },
      create: {
        organizationId: params.organizationId,
        postId: params.postId,
        integrationId: params.integrationId,
        metric: params.metric,
        value: params.value,
        date: params.date,
      },
      update: { value: params.value },
    });
  }

  // Batch equivalent of upsertChannelSnapshot (ANALYTICS-04): delete the existing
  // rows for the unique dimensions (org + integration + metric + date), then
  // recreate them. `skipDuplicates` makes sweep retries idempotent.
  upsertChannelSnapshots(
    rows: {
      organizationId: string;
      integrationId: string;
      metric: string;
      value: number;
      date: Date;
    }[],
  ) {
    if (rows.length === 0) return Promise.resolve({ count: 0 });
    return this._prisma.$transaction([
      this._prisma.analyticsSnapshot.deleteMany({
        where: {
          OR: rows.map((r) => ({
            organizationId: r.organizationId,
            integrationId: r.integrationId,
            metric: r.metric,
            date: r.date,
          })),
        },
      }),
      this._prisma.analyticsSnapshot.createMany({
        data: rows,
        skipDuplicates: true,
      }),
    ]);
  }

  // Batch equivalent of upsertPostSnapshot (ANALYTICS-05): delete the existing
  // rows for the unique dimensions (org + post + metric + date), then recreate
  // them. `skipDuplicates` makes sweep retries idempotent.
  upsertPostSnapshots(
    rows: {
      organizationId: string;
      postId: string;
      integrationId: string;
      metric: string;
      value: number;
      date: Date;
    }[],
  ) {
    if (rows.length === 0) return Promise.resolve({ count: 0 });
    return this._prisma.$transaction([
      this._prisma.postAnalyticsSnapshot.deleteMany({
        where: {
          OR: rows.map((r) => ({
            organizationId: r.organizationId,
            postId: r.postId,
            metric: r.metric,
            date: r.date,
          })),
        },
      }),
      this._prisma.postAnalyticsSnapshot.createMany({
        data: rows,
        skipDuplicates: true,
      }),
    ]);
  }

  updatePostCounters(
    orgId: string,
    postId: string,
    data: { lastViews?: number; lastLikes?: number; lastComments?: number },
  ) {
    return this._post.model.post.update({
      where: { id: postId, organizationId: orgId },
      data,
    });
  }

  deletePostSnapshotsBefore(orgId: string, cutoff: Date) {
    return this._postAnalyticsSnapshot.model.postAnalyticsSnapshot.deleteMany({
      where: { organizationId: orgId, date: { lt: cutoff } },
    });
  }

  findChannelSnapshotsBefore(orgId: string, cutoff: Date) {
    return this._analyticsSnapshot.model.analyticsSnapshot.findMany({
      where: { organizationId: orgId, date: { lt: cutoff } },
      orderBy: { date: 'asc' },
    });
  }

  // Per-post analog of findChannelSnapshotsBefore — the rows to be rolled up
  // into weekly aggregates (6.1). postId is carried through so the weekly row
  // stays attributable to its post/campaign. R1.8: bounded below by `floor` so
  // each sweep only touches a fixed recent window (chronological aging keeps the
  // re-roll correct), instead of re-reading the org's entire pre-cutoff history.
  findPostSnapshotsBefore(orgId: string, floor: Date, cutoff: Date) {
    return this._postAnalyticsSnapshot.model.postAnalyticsSnapshot.findMany({
      where: { organizationId: orgId, date: { gte: floor, lt: cutoff } },
      orderBy: { date: 'asc' },
      select: {
        postId: true,
        integrationId: true,
        metric: true,
        value: true,
        date: true,
      },
    });
  }

  // R1.8 guard: rows older than the rollup floor that the bounded sweep no longer
  // compacts (they simply stay daily — still aggregate correctly as levels). A
  // non-zero count is logged, never silently truncated.
  countPostSnapshotsBeforeFloor(orgId: string, floor: Date) {
    return this._postAnalyticsSnapshot.model.postAnalyticsSnapshot.count({
      where: { organizationId: orgId, date: { lt: floor } },
    });
  }

  // Atomic delete+create replacement for the daily→weekly rollup.
  replaceRolledUpSnapshots(
    orgId: string,
    dailyCutoff: Date,
    weeklyRows: {
      organizationId: string;
      integrationId: string;
      metric: string;
      value: number;
      date: Date;
    }[],
  ) {
    return this._prisma.$transaction([
      this._prisma.analyticsSnapshot.deleteMany({
        where: { organizationId: orgId, date: { lt: dailyCutoff } },
      }),
      this._prisma.analyticsSnapshot.createMany({
        data: weeklyRows,
        skipDuplicates: true,
      }),
    ]);
  }

  // Atomic delete+create replacement for the per-post daily→weekly rollup (6.1),
  // mirroring replaceRolledUpSnapshots. The @@unique([postId, metric, date]) key
  // makes the createMany idempotent via skipDuplicates.
  replaceRolledUpPostSnapshots(
    orgId: string,
    floor: Date,
    cutoff: Date,
    weeklyRows: {
      organizationId: string;
      postId: string;
      integrationId: string;
      metric: string;
      value: number;
      date: Date;
    }[],
  ) {
    return this._prisma.$transaction([
      this._prisma.postAnalyticsSnapshot.deleteMany({
        where: { organizationId: orgId, date: { gte: floor, lt: cutoff } },
      }),
      this._prisma.postAnalyticsSnapshot.createMany({
        data: weeklyRows,
        skipDuplicates: true,
      }),
    ]);
  }

  findIntegrationByIdRaw(integrationId: string, organizationId: string) {
    // ANALYTICS-01: Integration has `id @id` and a separate @@unique on
    // (organizationId, internalId), but no unique index on (id, organizationId).
    // `findUnique` with both fields would throw at runtime, so we use `findFirst`.
    return this._integration.model.integration.findFirst({
      where: {
        id: integrationId,
        organizationId,
      },
    });
  }

  // ── Anomaly ledger (Phase 4) ──

  // All channel snapshots for an org since `from` — the detect-anomalies input,
  // grouped by (integrationId, metric) in the activity.
  getSnapshotsForOrgSince(orgId: string, from: Date) {
    return this._analyticsSnapshot.model.analyticsSnapshot.findMany({
      where: { organizationId: orgId, date: { gte: from } },
      orderBy: { date: 'asc' },
      select: { integrationId: true, metric: true, value: true, date: true },
    });
  }

  // Cooldown check (4.3): most recent anomaly for this (integration, metric,
  // direction) on/after `sinceDate` — null means "outside cooldown, may notify".
  getRecentAnomaly(
    orgId: string,
    integrationId: string,
    metric: string,
    direction: string,
    sinceDate: Date,
  ) {
    return this._analyticsAnomaly.model.analyticsAnomaly.findFirst({
      // organizationId is defense-in-depth (integration ids are globally-unique
      // PKs), kept for consistency with every sibling org-scoped read.
      where: { organizationId: orgId, integrationId, metric, direction, date: { gte: sinceDate } },
      orderBy: { date: 'desc' },
    });
  }

  // Idempotent bulk insert — the @@unique([integrationId,metric,date]) key makes
  // sweep retries a no-op via skipDuplicates.
  createAnomalies(
    rows: {
      organizationId: string;
      integrationId: string;
      metric: string;
      date: Date;
      value: number;
      baseline: number;
      deviation: number;
      direction: string;
      topPostId?: string | null;
      ruleId?: string | null;
      notifiedAt?: Date | null;
    }[],
  ) {
    if (rows.length === 0) return Promise.resolve({ count: 0 });
    return this._analyticsAnomaly.model.analyticsAnomaly.createMany({
      data: rows,
      skipDuplicates: true,
    });
  }

  listAnomalies(
    orgId: string,
    opts: { limit?: number; includeDismissed?: boolean } = {},
  ) {
    return this._analyticsAnomaly.model.analyticsAnomaly.findMany({
      where: {
        organizationId: orgId,
        ...(opts.includeDismissed ? {} : { dismissedAt: null }),
      },
      include: {
        integration: {
          select: { id: true, name: true, providerIdentifier: true, picture: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 50,
    });
  }

  // Org-scoped dismiss — updateMany so a cross-org id updates 0 rows (→ 404).
  dismissAnomaly(orgId: string, id: string) {
    return this._analyticsAnomaly.model.analyticsAnomaly.updateMany({
      where: { id, organizationId: orgId },
      data: { dismissedAt: new Date() },
    });
  }

  // ── 7.3: user-defined alert rules ──

  listAlertRules(orgId: string) {
    return this._prisma.analyticsAlertRule.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  getAlertRule(orgId: string, id: string) {
    return this._prisma.analyticsAlertRule.findFirst({
      where: { id, organizationId: orgId },
    });
  }

  getEnabledAlertRules(orgId: string) {
    return this._prisma.analyticsAlertRule.findMany({
      where: { organizationId: orgId, enabled: true },
    });
  }

  createAlertRule(data: {
    organizationId: string;
    integrationId?: string | null;
    metric: string;
    comparator: string;
    threshold: number;
    direction?: string;
    enabled?: boolean;
  }) {
    return this._prisma.analyticsAlertRule.create({ data });
  }

  // Org-scoped update — updateMany so a cross-org id updates 0 rows (→ 404).
  updateAlertRule(
    orgId: string,
    id: string,
    data: {
      integrationId?: string | null;
      metric?: string;
      comparator?: string;
      threshold?: number;
      direction?: string;
      enabled?: boolean;
      lastFiredAt?: Date | null;
    },
  ) {
    return this._prisma.analyticsAlertRule.updateMany({
      where: { id, organizationId: orgId },
      data,
    });
  }

  // P2: batch stamp lastFiredAt on every rule that fired this run.
  updateAlertRulesLastFiredAt(orgId: string, ids: string[], lastFiredAt: Date) {
    return this._prisma.analyticsAlertRule.updateMany({
      where: { id: { in: ids }, organizationId: orgId },
      data: { lastFiredAt },
    });
  }

  // M-05: anomaly persistence and rule-last-fired stamping must be atomic so a
  // retry cannot re-notify without stamping (or stamp without persisting).
  createAnomaliesAndStampRules(
    rows: {
      organizationId: string;
      integrationId: string;
      metric: string;
      date: Date;
      value: number;
      baseline: number;
      deviation: number;
      direction: string;
      topPostId?: string | null;
      ruleId?: string | null;
      notifiedAt?: Date | null;
    }[],
    orgId: string,
    ruleIds: string[],
    lastFiredAt: Date,
  ) {
    if (rows.length === 0 && ruleIds.length === 0) {
      return Promise.resolve({ created: { count: 0 }, stamped: { count: 0 } });
    }
    return this._prisma.$transaction([
      this._analyticsAnomaly.model.analyticsAnomaly.createMany({
        data: rows,
        skipDuplicates: true,
      }),
      this._prisma.analyticsAlertRule.updateMany({
        where: { id: { in: ruleIds }, organizationId: orgId },
        data: { lastFiredAt },
      }),
    ]);
  }

  // Org-scoped delete — deleteMany so a cross-org id deletes 0 rows.
  deleteAlertRule(orgId: string, id: string) {
    return this._prisma.analyticsAlertRule.deleteMany({
      where: { id, organizationId: orgId },
    });
  }

  // ── 7.6: org-level public share ──

  getShareByOrg(orgId: string) {
    return this._prisma.analyticsShare.findUnique({
      where: { organizationId: orgId },
    });
  }

  getShareByToken(token: string) {
    return this._prisma.analyticsShare.findUnique({ where: { token } });
  }

  upsertShare(
    orgId: string,
    data: { token: string; config: Record<string, unknown>; enabled: boolean },
  ) {
    return this._prisma.analyticsShare.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        token: data.token,
        config: data.config as any,
        enabled: data.enabled,
      },
      update: {
        token: data.token,
        config: data.config as any,
        enabled: data.enabled,
      },
    });
  }

  disableShare(orgId: string) {
    return this._prisma.analyticsShare.updateMany({
      where: { organizationId: orgId },
      data: { enabled: false },
    });
  }
}
