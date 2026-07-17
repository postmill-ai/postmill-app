import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class WatchlistRepository {
  constructor(
    private _prisma: PrismaService,
  ) {}

  findByOrg(organizationId: string) {
    return this._prisma.watchedAccount.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { metrics: { take: 1, orderBy: { capturedAt: 'desc' } } },
    });
  }

  findEnabledByOrg(organizationId: string) {
    return this._prisma.watchedAccount.findMany({
      where: { organizationId, enabled: true, deletedAt: null },
    });
  }

  countByOrg(organizationId: string) {
    return this._prisma.watchedAccount.count({
      where: { organizationId, deletedAt: null },
    });
  }

  // Org-scoped single lookup (6.3) — null when the id isn't this org's (or is
  // soft-deleted), so the service can 404 instead of leaking a cross-org row.
  findByIdForOrg(id: string, organizationId: string) {
    return this._prisma.watchedAccount.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
  }

  // Time-series read of WatchedAccountMetric (6.3 competitor overlay). Ordered
  // oldest-first for direct charting; empty when nothing has been probed yet.
  getMetricSeries(watchedAccountId: string, metric: string) {
    return this._prisma.watchedAccountMetric.findMany({
      where: { watchedAccountId, metric },
      orderBy: { capturedAt: 'asc' },
      select: { metric: true, value: true, capturedAt: true },
    });
  }

  create(data: {
    organizationId: string;
    provider: string;
    handle: string;
    displayName?: string;
  }) {
    return this._prisma.watchedAccount.create({ data });
  }

  update(id: string, organizationId: string, data: { displayName?: string; enabled?: boolean }) {
    return this._prisma.watchedAccount.update({ where: { id, organizationId }, data });
  }

  softDelete(id: string, organizationId: string) {
    return this._prisma.watchedAccount.update({
      where: { id, organizationId },
      data: { deletedAt: new Date() },
    });
  }

  recordMetric(data: {
    watchedAccountId: string;
    metric: string;
    value: number;
  }) {
    return this._prisma.watchedAccountMetric.create({ data });
  }

  setLastError(id: string, organizationId: string, error: string | null) {
    return this._prisma.watchedAccount.update({
      where: { id, organizationId },
      data: { lastError: error },
    });
  }

  disableWithError(id: string, organizationId: string, error: string) {
    return this._prisma.watchedAccount.update({
      where: { id, organizationId },
      data: { enabled: false, lastError: error },
    });
  }
}
