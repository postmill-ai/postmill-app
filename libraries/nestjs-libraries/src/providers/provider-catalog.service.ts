import { Inject, Injectable } from '@nestjs/common';
import {
  ProviderDomain,
  ProviderKernel,
  isProviderVerified,
  LanguageCode,
} from '@gitroom/provider-kernel';
import { FeaturedProviderService } from '@gitroom/nestjs-libraries/database/prisma/featured-providers/featured-provider.service';
import { PROVIDER_KERNEL } from './provider-kernel.token';

export interface CatalogEntry {
  domain: string;
  providerId: string;
  version: string;
  displayName: string;
  status: string;
  verified: boolean;
  capabilities: unknown;
  authType: string;
  defaultDomain: string | null;
  setupNotes: string | null;
  credentialFields: unknown;
  deprecatedAt: Date | null;
  sunsetAt: Date | null;
  description: Partial<Record<LanguageCode, string>> | null;
  website: string | null;
  mediaCategories: unknown;
  featured: boolean;
  featuredSortOrder: number | null;
}

@Injectable()
export class ProviderCatalogService {
  constructor(
    @Inject(PROVIDER_KERNEL) private readonly _kernel: ProviderKernel,
    private readonly _featured: FeaturedProviderService,
  ) {}

  async buildCatalog(domainFilter?: ProviderDomain): Promise<CatalogEntry[]> {
    const manifests = this._kernel.listManifests(domainFilter);
    // Featured curation, keyed by `${domain}/${providerId}` (version-agnostic —
    // all version-entries of a featured provider carry the badge/order).
    const featured = await this._featured.getFeaturedKeyed(domainFilter);

    return manifests.map((m) => {
      const featuredKey = `${m.domain}/${m.providerId}`;
      return {
        domain: m.domain,
        providerId: m.providerId,
        version: m.version,
        displayName: m.displayName,
        status: m.status,
        // Live-key verification: false = "built without a live key" (Beta badge).
        verified: isProviderVerified(m.domain, m.providerId),
        capabilities: m.capabilities,
        authType: m.authType,
        defaultDomain: m.defaultDomain,
        setupNotes: m.setupNotes,
        // Version-aware settings UI drives the credential form from the selected
        // version's fields and surfaces sunset timing on deprecated configs.
        credentialFields: m.credentialFields,
        deprecatedAt: m.deprecatedAt ? new Date(m.deprecatedAt) : null,
        sunsetAt: m.sunsetAt ? new Date(m.sunsetAt) : null,
        // Localized provider description + website for the media-defaults surface.
        description: m.metadata?.description,
        website: m.metadata?.website,
        mediaCategories: m.metadata?.mediaCategories,
        // Platform-curated "featured" flag + order (super-admin managed).
        featured: featured.has(featuredKey),
        featuredSortOrder: featured.get(featuredKey) ?? null,
      };
    });
  }
}
