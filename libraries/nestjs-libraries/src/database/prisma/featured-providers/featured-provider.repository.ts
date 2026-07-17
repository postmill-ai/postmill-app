import { PrismaRepository, PrismaTransaction } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

/**
 * Data-layer access for the platform-wide FeaturedProvider curation table.
 * Only this repository touches Prisma (layering rule). Keyed by
 * (domain, providerId); version-agnostic.
 */
@Injectable()
export class FeaturedProviderRepository {
  constructor(
    private _featuredProvider: PrismaRepository<'featuredProvider'>,
    private _transaction: PrismaTransaction,
  ) {}

  list(domain?: string) {
    return this._featuredProvider.model.featuredProvider.findMany({
      where: domain ? { domain } : {},
      orderBy: [{ domain: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  upsert(domain: string, providerId: string, sortOrder: number) {
    return this._featuredProvider.model.featuredProvider.upsert({
      where: { domain_providerId: { domain, providerId } },
      create: { domain, providerId, sortOrder },
      update: { sortOrder },
    });
  }

  remove(domain: string, providerId: string) {
    return this._featuredProvider.model.featuredProvider.deleteMany({
      where: { domain, providerId },
    });
  }

  /**
   * Bulk set sortOrder for a domain's featured providers. 6.1: run the upserts
   * in one `$transaction` so ordering is atomic — a mid-loop failure no longer
   * leaves a partially-reordered set, and it is a single round-trip.
   */
  async reorder(
    domain: string,
    entries: Array<{ providerId: string; sortOrder: number }>,
  ) {
    const ops = entries.map(({ providerId, sortOrder }) =>
      this._featuredProvider.model.featuredProvider.upsert({
        where: { domain_providerId: { domain, providerId } },
        create: { domain, providerId, sortOrder },
        update: { sortOrder },
      }),
    );
    await this._transaction.model.$transaction(ops);
    return this.list(domain);
  }
}
