import { PrismaRepository, PrismaTransaction } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class OrgShortLinkSettingsRepository {
  constructor(
    private _orgShortLinkConfig: PrismaRepository<'orgShortLinkConfig'>,
    private _shortLink: PrismaRepository<'shortLink'>,
    private _shortLinkSnapshot: PrismaRepository<'shortLinkSnapshot'>,
    private _transaction: PrismaTransaction,
  ) {}

  getByOrg(orgId: string) {
    return this._orgShortLinkConfig.model.orgShortLinkConfig.findMany({
      where: { organizationId: orgId },
    });
  }

  getByIdentifier(orgId: string, identifier: string) {
    return this._orgShortLinkConfig.model.orgShortLinkConfig.findFirst({
      where: { organizationId: orgId, identifier },
      orderBy: { createdAt: 'desc' },
    });
  }

  // The ACTIVE row for this org+identifier, or null. Rotation must target the row
  // `getActive()` actually reads — orgs already carrying pre-fix duplicate rows
  // (active row on a revoked key + newer inactive row) would otherwise keep
  // rotating the wrong one (PROVIDER_REMEDIATION_02 §0.3 review F7).
  getActiveByIdentifier(orgId: string, identifier: string) {
    return this._orgShortLinkConfig.model.orgShortLinkConfig.findFirst({
      where: { organizationId: orgId, identifier, isActive: true },
    });
  }

  getById(orgId: string, id: string) {
    return this._orgShortLinkConfig.model.orgShortLinkConfig.findFirst({
      where: { id, organizationId: orgId },
    });
  }

  getActive(orgId: string) {
    return this._orgShortLinkConfig.model.orgShortLinkConfig.findFirst({
      where: { organizationId: orgId, isActive: true },
    });
  }

  async upsert(
    orgId: string,
    identifier: string,
    data: {
      enabled?: boolean;
      isActive?: boolean;
      credentials?: string;
      customDomain?: string;
      extraConfig?: string;
      name?: string;
      accountFingerprint?: string;
      version?: string;
    },
  ) {
    const version = data.version ?? 'v1';
    if (data.accountFingerprint) {
      return this._orgShortLinkConfig.model.orgShortLinkConfig.upsert({
        where: {
          organizationId_identifier_version_accountFingerprint: {
            organizationId: orgId,
            identifier,
            version,
            accountFingerprint: data.accountFingerprint,
          },
        },
        create: { organizationId: orgId, identifier, version, ...data },
        update: data,
      });
    }
    const existing = await this.getByIdentifier(orgId, identifier);
    if (existing) {
      return this._orgShortLinkConfig.model.orgShortLinkConfig.update({
        where: { id: existing.id, organizationId: orgId },
        data,
      });
    }
    return this._orgShortLinkConfig.model.orgShortLinkConfig.create({
      data: { organizationId: orgId, identifier, version, ...data },
    });
  }

  // Row-id-targeted in-place update (mirrors StorageService.updateConfig by-id).
  // Ownership is enforced in the where clause as defense-in-depth; the caller
  // already validated the row via getById(orgId, id).
  updateById(
    orgId: string,
    configId: string,
    data: {
      enabled?: boolean;
      isActive?: boolean;
      credentials?: string;
      customDomain?: string;
      extraConfig?: string;
      name?: string;
      accountFingerprint?: string;
      version?: string;
    },
  ) {
    return this._orgShortLinkConfig.model.orgShortLinkConfig.update({
      where: { id: configId, organizationId: orgId },
      data,
    });
  }

  deleteById(orgId: string, id: string) {
    return this._orgShortLinkConfig.model.orgShortLinkConfig.delete({
      where: { id, organizationId: orgId },
    });
  }

  async delete(orgId: string, identifier: string) {
    return this._orgShortLinkConfig.model.orgShortLinkConfig.deleteMany({
      where: { organizationId: orgId, identifier },
    });
  }

  async setActive(orgId: string, identifier: string, version?: string) {
    await this._orgShortLinkConfig.model.orgShortLinkConfig.updateMany({
      where: { organizationId: orgId, isActive: true },
      data: { isActive: false },
    });
    const config = await this.getByIdentifier(orgId, identifier);
    if (!config) throw new Error('Configuration not found');
    const data: { isActive: true; enabled: true; version?: string } = {
      isActive: true,
      enabled: true,
    };
    if (version) data.version = version;
    return this._orgShortLinkConfig.model.orgShortLinkConfig.update({
      where: { id: config.id, organizationId: orgId },
      data,
    });
  }

  recordLink(data: {
    organizationId: string;
    provider: string;
    shortUrl: string;
    originalUrl: string;
    providerLinkId?: string;
    providerVersion?: string;
    postId?: string;
  }) {
    return this._shortLink.model.shortLink.create({ data });
  }

  findLinkByShortUrl(orgId: string, shortUrl: string) {
    return this._shortLink.model.shortLink.findUnique({
      where: { organizationId_shortUrl: { organizationId: orgId, shortUrl } },
    });
  }

  getLinksForOrg(orgId: string) {
    return this._shortLink.model.shortLink.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upsertSnapshotFull(shortLinkId: string, organizationId: string, date: Date, clicks: number) {
    const existing = await this._shortLinkSnapshot.model.shortLinkSnapshot.findUnique({
      where: { shortLinkId_date: { shortLinkId, date } },
    });
    if (existing) {
      return this._shortLinkSnapshot.model.shortLinkSnapshot.update({
        where: { id: existing.id },
        data: { clicks },
      });
    }
    return this._shortLinkSnapshot.model.shortLinkSnapshot.create({
      data: { shortLinkId, organizationId, date, clicks },
    });
  }

  // N6: write a whole sweep batch of daily snapshots in a single transaction,
  // so a link-heavy org incurs one round-trip per batch instead of one per link.
  async upsertSnapshotsBatch(
    rows: { shortLinkId: string; organizationId: string; date: Date; clicks: number }[],
  ) {
    if (rows.length === 0) return [];
    const ops = rows.map((r) =>
      this._shortLinkSnapshot.model.shortLinkSnapshot.upsert({
        where: { shortLinkId_date: { shortLinkId: r.shortLinkId, date: r.date } },
        create: {
          shortLinkId: r.shortLinkId,
          organizationId: r.organizationId,
          date: r.date,
          clicks: r.clicks,
        },
        update: { clicks: r.clicks },
      }),
    );
    return this._transaction.model.$transaction(ops);
  }

  getSnapshotsForLinks(orgId: string, shortLinkIds: string[], from?: Date, to?: Date) {
    return this._shortLinkSnapshot.model.shortLinkSnapshot.findMany({
      where: {
        organizationId: orgId,
        shortLinkId: { in: shortLinkIds },
        ...(from || to ? {
          date: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        } : {}),
      },
      orderBy: { date: 'asc' },
    });
  }

  async pruneSnapshots(orgId: string, before: Date) {
    const links = await this._shortLink.model.shortLink.findMany({
      where: { organizationId: orgId },
      select: { id: true },
    });
    if (links.length === 0) return { count: 0 };
    const result = await this._shortLinkSnapshot.model.shortLinkSnapshot.deleteMany({
      where: {
        shortLinkId: { in: links.map(l => l.id) },
        date: { lt: before },
      },
    });
    return result;
  }

  getAggregatedClicks(orgId: string, from: Date, to: Date) {
    return this._shortLinkSnapshot.model.shortLinkSnapshot.findMany({
      where: {
        organizationId: orgId,
        date: { gte: from, lte: to },
      },
      include: { shortLink: true },
      orderBy: { date: 'asc' },
    });
  }
}
