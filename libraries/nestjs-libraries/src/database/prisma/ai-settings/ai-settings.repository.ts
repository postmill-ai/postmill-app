import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

@Injectable()
export class AiSettingsRepository {
  constructor(
    private _aiProviderConfig: PrismaRepository<'aIProviderConfig'>,
    private _aiSystemSettings: PrismaRepository<'aISystemSettings'>,
    private _aiSpendLog: PrismaRepository<'aISpendLog'>,
    private _aiSettingsAudit: PrismaRepository<'aISettingsAudit'>,
    private _aiBrandProfile: PrismaRepository<'aIBrandProfile'>,
    private _aiPromptTemplate: PrismaRepository<'aIPromptTemplate'>,
    private _aiMediaJob: PrismaRepository<'aIMediaJob'>,
    private _aiPromptLibraryItem: PrismaRepository<'aIPromptLibraryItem'>,
    private _aiContentIndex: PrismaRepository<'aIContentIndex'>,
    private _aiOrgProviderConfig: PrismaRepository<'aIOrgProviderConfig'>,
  ) {}

  // ── AIProviderConfig ──
  getProviderConfigs() {
    return this._aiProviderConfig.model.aIProviderConfig.findMany();
  }

  listProviderConfigs() {
    return this._aiProviderConfig.model.aIProviderConfig.findMany({
      select: {
        id: true,
        identifier: true,
        enabled: true,
        defaultModel: true,
        reasoningModel: true,
        extraConfig: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  getProviderConfigByIdentifier(identifier: string, version = 'v1') {
    return this._aiProviderConfig.model.aIProviderConfig.findUnique({
      where: { identifier_version: { identifier, version } },
    });
  }

  upsertProviderConfig(
    identifier: string,
    data: {
      enabled?: boolean;
      credentials?: string;
      defaultModel?: string;
      reasoningModel?: string;
      extraConfig?: string;
    },
    version = 'v1',
  ) {
    return this._aiProviderConfig.model.aIProviderConfig.upsert({
      where: { identifier_version: { identifier, version } },
      create: { identifier, version, ...data },
      update: data,
    });
  }

  deleteProviderConfig(identifier: string, version = 'v1') {
    return this._aiProviderConfig.model.aIProviderConfig.delete({
      where: { identifier_version: { identifier, version } },
    });
  }

  getEnabledProviderConfigs() {
    return this._aiProviderConfig.model.aIProviderConfig.findMany({
      where: { enabled: true },
    });
  }

  // ── AISystemSettings (singleton) ──
  getSystemSettings() {
    return this._aiSystemSettings.model.aISystemSettings.findUnique({
      where: { id: 'singleton' },
    });
  }

  upsertSystemSettings(data: Record<string, any>) {
    return this._aiSystemSettings.model.aISystemSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...data },
      update: data,
    });
  }

  // ── AISpendLog ──
  createSpendLog(data: {
    organizationId?: string;
    userId?: string;
    provider: string;
    model: string;
    scope: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }) {
    return this._aiSpendLog.model.aISpendLog.create({ data });
  }

  getSpendSummary(organizationId?: string, since?: Date) {
    return this._aiSpendLog.model.aISpendLog.groupBy({
      by: ['scope'],
      where: {
        ...(organizationId ? { organizationId } : {}),
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
    });
  }

  // ── AISettingsAudit ──
  getAuditLogs(limit = 100, offset = 0) {
    return this._aiSettingsAudit.model.aISettingsAudit.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  createAuditLog(data: { userId?: string; action: string; detail?: string }) {
    return this._aiSettingsAudit.model.aISettingsAudit.create({ data });
  }

  // ── AIBrandProfile ──
  getBrandProfile(organizationId: string, brandId?: string) {
    if (brandId) {
      return this._aiBrandProfile.model.aIBrandProfile.findFirst({
        where: { id: brandId, organizationId },
      });
    }
    return this._aiBrandProfile.model.aIBrandProfile.findFirst({
      where: { organizationId, isDefault: true },
    });
  }

  async upsertBrandProfile(
    organizationId: string,
    data: Record<string, unknown>,
  ) {
    const existing = await this._aiBrandProfile.model.aIBrandProfile.findFirst({
      where: { organizationId, isDefault: true },
    });
    if (existing) {
      const { count } = await this._aiBrandProfile.model.aIBrandProfile.updateMany({
        where: { id: existing.id, organizationId },
        data,
      });
      if (count === 0) {
        return null;
      }
      return { ...existing, ...data };
    }
    return this._aiBrandProfile.model.aIBrandProfile.create({
      data: { organizationId, ...data, isDefault: true, name: 'Default Brand' },
    });
  }

  // ── AIPromptTemplate ──
  /**
   * Fetch prompt templates.
   * @param organizationId - `null` → return only global (org=null) templates;
   *                         `undefined` → return ALL templates (no filter);
   *                         a string → return templates for that org only.
   */
  getPromptTemplates(organizationId?: string | null) {
    const where: any = {};
    if (organizationId !== undefined) where.organizationId = organizationId;

    return this._aiPromptTemplate.model.aIPromptTemplate.findMany({ where });
  }

  /**
   * Fetch templates matching the org OR global (org=null) for resolution:
   * org → global → built-in constant.
   */
  getPromptTemplatesForResolution(organizationId: string) {
    return this._aiPromptTemplate.model.aIPromptTemplate.findMany({
      where: {
        OR: [
          { organizationId },
          { organizationId: null },
        ],
      },
    });
  }

  getPromptTemplate(organizationId: string | null, key: string) {
    if (organizationId === null) {
      return this._aiPromptTemplate.model.aIPromptTemplate.findUnique({
        where: { globalKey: key },
      });
    }

    return this._aiPromptTemplate.model.aIPromptTemplate.findUnique({
      where: { organizationId_key: { organizationId, key } },
    });
  }

  upsertPromptTemplate(
    organizationId: string | null,
    key: string,
    content: string,
  ) {
    if (organizationId === null) {
      return this._aiPromptTemplate.model.aIPromptTemplate.upsert({
        where: { globalKey: key },
        create: { organizationId: null, globalKey: key, key, content },
        update: { content, globalKey: key },
      });
    }

    return this._aiPromptTemplate.model.aIPromptTemplate.upsert({
      where: { organizationId_key: { organizationId, key } },
      create: { organizationId, globalKey: null, key, content },
      update: { content, globalKey: null },
    });
  }

  deletePromptTemplate(organizationId: string | null, key: string) {
    if (organizationId === null) {
      return this._aiPromptTemplate.model.aIPromptTemplate.delete({
        where: { globalKey: key },
      });
    }

    return this._aiPromptTemplate.model.aIPromptTemplate.delete({
      where: { organizationId_key: { organizationId, key } },
    });
  }

  // ── AIMediaJob ──
  createMediaJob(data: {
    organizationId: string;
    userId?: string;
    provider: string;
    operation: string;
    status?: string;
    artifactUrl?: string;
    provenance?: string;
    costUsd?: number;
    creditType?: string;
    error?: string;
    folderId?: string | null;
    model?: string | null;
    version?: string | null;
    inputJson?: string | null;
  }) {
    return this._aiMediaJob.model.aIMediaJob.create({ data });
  }

  updateMediaJob(
    organizationId: string,
    id: string,
    data: {
      status?: string;
      artifactUrl?: string | null;
      provenance?: string;
      costUsd?: number;
      error?: string | null;
      folderId?: string | null;
      model?: string | null;
      version?: string | null;
      inputJson?: string | null;
      creditType?: string | null;
    },
  ) {
    return this._aiMediaJob.model.aIMediaJob.update({
      where: { id, organizationId },
      data,
    });
  }

  getMediaJobs(organizationId: string, limit = 50) {
    return this._aiMediaJob.model.aIMediaJob.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getMediaJobStatusCounts(organizationId: string) {
    const sevenDaysAgo = dayjs.utc().subtract(7, 'day').toDate();
    const [groups, failed7d] = await Promise.all([
      this._aiMediaJob.model.aIMediaJob.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { status: true },
      }),
      this._aiMediaJob.model.aIMediaJob.count({
        where: {
          organizationId,
          status: 'failed',
          createdAt: { gte: sevenDaysAgo },
        },
      }),
    ]);

    const counts: Record<string, number> = {};
    for (const g of groups) {
      counts[g.status] = g._count.status;
    }

    return {
      pending: counts['pending'] ?? 0,
      processing: counts['processing'] ?? 0,
      failed7d,
    };
  }

  getMediaJobsByProvider(organizationId: string, provider: string, limit = 50) {
    return this._aiMediaJob.model.aIMediaJob.findMany({
      where: { organizationId, provider },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // F4: count video-export jobs still in flight within the billing window so the
  // VIDEO_EXPORTS entitlement gate can't be raced by concurrent renders (the
  // credit is only recorded after the async render completes). Stale `processing`
  // rows are excluded: a crash between the `processing` claim and the terminal
  // update strands a local job (the 24h reaper — JOB_TIMEOUT_MS in
  // media-job-lifecycle.service.ts — only covers the external-provider path), and
  // without the cutoff such a row would hold an in-flight slot until it ages out
  // of the billing month (G2 mitigation).
  countInFlightVideoExports(organizationId: string, from: Date) {
    const staleProcessingCutoff = dayjs.utc().subtract(24, 'hour').toDate();
    return this._aiMediaJob.model.aIMediaJob.count({
      where: {
        organizationId,
        creditType: 'video_export',
        createdAt: { gte: from },
        OR: [
          { status: { notIn: ['completed', 'failed', 'processing'] } },
          {
            status: 'processing',
            updatedAt: { gte: staleProcessingCutoff },
          },
        ],
      },
    });
  }

  getMediaJobById(organizationId: string, id: string) {
    return this._aiMediaJob.model.aIMediaJob.findUnique({
      where: { id, organizationId },
    });
  }

  // Unscoped lookup used only by job-id-only entry points (webhook token verification,
  // Inngest render worker) that immediately validate ownership via the HMAC token or
  // the organizationId on the returned row. All other reads use `getMediaJobById`.
  getMediaJobByIdUnscoped(id: string) {
    return this._aiMediaJob.model.aIMediaJob.findUnique({ where: { id } });
  }

  // §3.1: atomically claim a status transition. `processJob` is check-then-act and
  // is driven concurrently from four uncoordinated paths (webhook, cron sweep,
  // drive-on-read listJobs, HeyGenService.getJob); a plain `update` lets two callers
  // both complete one job (double download/File row/notification). Callers proceed
  // only when this returns 1 — the row was still in one of `from` when we flipped it.
  async claimMediaJobStatus(
    organizationId: string,
    id: string,
    from: string[],
    to: string,
  ): Promise<number> {
    const res = await this._aiMediaJob.model.aIMediaJob.updateMany({
      where: { id, organizationId, status: { in: from } },
      data: { status: to },
    });
    return res.count;
  }

  // §3.1 crash-recovery: `_claimForCompletion` flips a job to the transient `landing`
  // state before downloading/storing; a process crash in that window strands the row in
  // `landing`, which the pending/processing-only sweep never re-selects (so it can't even
  // reach the 24h timeout). Reset rows stuck in `landing` since before `cutoff` back to
  // `processing` so the next sweep re-drives them. The `updatedAt < cutoff` guard means a
  // job legitimately mid-completion (fast path) is never reclaimed — `cutoff` is set well
  // beyond the worst-case completeJob duration. Returns the number reclaimed.
  async reclaimStaleLandingJobs(cutoff: Date): Promise<number> {
    const res = await this._aiMediaJob.model.aIMediaJob.updateMany({
      where: { status: 'landing', updatedAt: { lt: cutoff } },
      data: { status: 'processing' },
    });
    return res.count;
  }

  // Pending/processing async jobs across all orgs for the polling sweep (§11.2).
  // §6.2 sweep-starvation: over-fetch an age-ordered pool and apply a per-org cap so
  // one org flooding the queue can't monopolize the sweep window; a lightly-loaded
  // queue is unaffected (the leftover pass fills any remaining slots oldest-first).
  // Served by the additive (status, createdAt) index.
  async getPendingMediaJobs(limit = 100) {
    const perOrgCap = Math.max(1, Math.ceil(limit / 5));
    const pool = await this._aiMediaJob.model.aIMediaJob.findMany({
      where: { status: { in: ['pending', 'processing'] } },
      orderBy: { createdAt: 'asc' },
      take: limit * 3,
    });
    if (pool.length <= limit) return pool;

    const taken = new Map<string, number>();
    const selected: typeof pool = [];
    const leftover: typeof pool = [];
    for (const job of pool) {
      const count = taken.get(job.organizationId) ?? 0;
      if (selected.length < limit && count < perOrgCap) {
        taken.set(job.organizationId, count + 1);
        selected.push(job);
      } else {
        leftover.push(job);
      }
    }
    for (const job of leftover) {
      if (selected.length >= limit) break;
      selected.push(job);
    }
    return selected;
  }

  // ── AIPromptLibraryItem ──
  getPromptLibraryItems(organizationId: string) {
    return this._aiPromptLibraryItem.model.aIPromptLibraryItem.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  createPromptLibraryItem(data: {
    organizationId: string;
    title: string;
    content: string;
  }) {
    return this._aiPromptLibraryItem.model.aIPromptLibraryItem.create({ data });
  }

  deletePromptLibraryItem(id: string, organizationId: string) {
    return this._aiPromptLibraryItem.model.aIPromptLibraryItem.deleteMany({
      where: { id, organizationId },
    });
  }

  // ── AIContentIndex ──
  getContentIndexEntries(organizationId: string, sourceType: string, sourceId: string) {
    return this._aiContentIndex.model.aIContentIndex.findMany({
      where: { organizationId, sourceType, sourceId },
    });
  }

  createContentIndex(data: {
    organizationId: string;
    sourceType: string;
    sourceId: string;
    chunkIndex: number;
    contentHash: string;
    chunk?: string;
  }) {
    return this._aiContentIndex.model.aIContentIndex.create({ data });
  }

  /**
   * Deletes content index chunk rows for the given source.
   *
   * ⚠️ Embedded vectors are stored in an out-of-band AIContentEmbedding
   * side table created via raw SQL (§3.6). The raw-SQL FK must include
   * `ON DELETE CASCADE` referencing AIContentIndex.id — otherwise
   * orphaned embedding rows will be left behind when chunks are removed.
   * Verify the raw migration before shipping.
   */
  deleteContentIndexEntries(organizationId: string, sourceType: string, sourceId: string) {
    return this._aiContentIndex.model.aIContentIndex.deleteMany({
      where: { organizationId, sourceType, sourceId },
    });
  }

  upsertContentIndex(data: {
    organizationId: string;
    sourceType: string;
    sourceId: string;
    chunkIndex: number;
    contentHash: string;
    chunk?: string;
  }) {
    const { organizationId, sourceType, sourceId, chunkIndex, ...rest } = data;
    return this._aiContentIndex.model.aIContentIndex.upsert({
      where: {
        organizationId_sourceType_sourceId_chunkIndex: {
          organizationId,
          sourceType,
          sourceId,
          chunkIndex,
        },
      },
      create: data,
      update: rest,
    });
  }

  // ── AIOrgProviderConfig (BYOK scaffold) ──
  getOrgProviderConfigs(organizationId: string) {
    return this._aiOrgProviderConfig.model.aIOrgProviderConfig.findMany({
      where: { organizationId },
    });
  }

  async getAllOrgIds(): Promise<string[]> {
    const rows = await this._aiOrgProviderConfig.model.aIOrgProviderConfig.findMany({
      select: { organizationId: true },
      distinct: ['organizationId'],
    });
    return rows.map((r) => r.organizationId);
  }

  getOrgProviderConfig(organizationId: string, identifier: string, version = 'v1') {
    return this._aiOrgProviderConfig.model.aIOrgProviderConfig.findUnique({
      where: { organizationId_identifier_version: { organizationId, identifier, version } },
    });
  }

  upsertOrgProviderConfig(
    organizationId: string,
    identifier: string,
    data: {
      enabled?: boolean;
      credentials?: string;
      defaultModel?: string;
      reasoningModel?: string;
      extraConfig?: string;
    },
    version = 'v1',
  ) {
    return this._aiOrgProviderConfig.model.aIOrgProviderConfig.upsert({
      where: { organizationId_identifier_version: { organizationId, identifier, version } },
      create: { organizationId, identifier, version, ...data },
      update: data,
    });
  }

  deleteOrgProviderConfig(organizationId: string, identifier: string, version = 'v1') {
    return this._aiOrgProviderConfig.model.aIOrgProviderConfig.delete({
      where: { organizationId_identifier_version: { organizationId, identifier, version } },
    });
  }
}
