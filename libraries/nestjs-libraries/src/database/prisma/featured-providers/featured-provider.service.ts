import { BadRequestException, Injectable } from '@nestjs/common';
import { ProviderDomain, isProviderDomain } from '@gitroom/provider-kernel';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { FeaturedProviderRepository } from './featured-provider.repository';

// 3.3: domain set + guard now come from the shared kernel export (single source
// of truth) instead of a local duplicate that could drift.

/**
 * Platform-wide "featured providers" curation. Featured providers are surfaced
 * at the top of their domain's provider-configuration list (below the tenant's
 * configured providers, above the alphabetized rest), ordered by sortOrder.
 * Global (not per-org); managed by super-admins.
 */
@Injectable()
export class FeaturedProviderService {
  constructor(
    private readonly _repo: FeaturedProviderRepository,
    private readonly _resolution: ProviderResolutionService,
  ) {}

  private _assertDomain(domain: string): ProviderDomain {
    if (!isProviderDomain(domain)) {
      throw new BadRequestException(`Unknown provider domain: ${domain}`);
    }
    return domain;
  }

  private _assertProviderExists(domain: ProviderDomain, providerId: string) {
    const known = this._resolution
      .listManifests(domain)
      .some((m) => m.providerId === providerId);
    if (!known) {
      throw new BadRequestException(
        `Unknown provider "${providerId}" for domain "${domain}"`,
      );
    }
  }

  list(domain?: string) {
    return this._repo.list(domain ? this._assertDomain(domain) : undefined);
  }

  upsert(domain: string, providerId: string, sortOrder = 0) {
    const d = this._assertDomain(domain);
    this._assertProviderExists(d, providerId);
    return this._repo.upsert(d, providerId, sortOrder);
  }

  remove(domain: string, providerId: string) {
    return this._repo.remove(this._assertDomain(domain), providerId);
  }

  reorder(domain: string, entries: Array<{ providerId: string; sortOrder: number }>) {
    const d = this._assertDomain(domain);
    entries.forEach((e) => this._assertProviderExists(d, e.providerId));
    return this._repo.reorder(d, entries);
  }

  /**
   * Featured lookup keyed by `${domain}/${providerId}` → sortOrder. Consumed by
   * the public /providers/catalog projection to tag catalog entries. Composite
   * key because the catalog may span domains (no `domain` filter) and providerId
   * is only unique within a domain. An invalid domain yields an empty map (the
   * catalog endpoint is lenient by design).
   */
  async getFeaturedKeyed(domain?: string): Promise<Map<string, number>> {
    if (domain && !isProviderDomain(domain)) return new Map();
    const rows = await this._repo.list(domain);
    return new Map(rows.map((r) => [`${r.domain}/${r.providerId}`, r.sortOrder]));
  }
}
