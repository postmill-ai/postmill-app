import { Injectable, Logger } from '@nestjs/common';
import { FeaturedProviderRepository } from '../prisma/featured-providers/featured-provider.repository';

// Canonical, permanent featured set. Re-asserted on every boot. Edit here to change what is
// featured in prod. Keyed by (domain, providerId); version-agnostic.
export const FEATURED_PROVIDERS: Array<{ domain: string; providerId: string; sortOrder: number }> = [
  { domain: 'ai',          providerId: 'openai',     sortOrder: 1 },
  { domain: 'ai',          providerId: 'openrouter', sortOrder: 2 },
  { domain: 'ai',          providerId: 'gateway',    sortOrder: 3 }, // Vercel AI Gateway
  { domain: 'media',       providerId: 'replicate',  sortOrder: 1 },
  { domain: 'media',       providerId: 'heygen',     sortOrder: 2 },
  { domain: 'media',       providerId: 'fal',        sortOrder: 3 }, // "Kling" (fal-backed)
  { domain: 'contentpack', providerId: 'magnific',   sortOrder: 1 },
  { domain: 'storage',     providerId: 'medialocker',sortOrder: 1 },
  { domain: 'shortlink',   providerId: 'lnkify',     sortOrder: 1 },
  { domain: 'vpn',         providerId: 'hideme',     sortOrder: 1 },
  { domain: 'vpn',         providerId: 'custom',     sortOrder: 2 }, // Custom VPN/Proxy
  { domain: 'vpn',         providerId: 'nordvpn',    sortOrder: 3 },
];

@Injectable()
export class FeaturedProviderSeeder {
  private readonly _log = new Logger(FeaturedProviderSeeder.name);

  constructor(private readonly _repo: FeaturedProviderRepository) {}

  async seed(): Promise<void> {
    let succeeded = 0;
    let failed = 0;

    // Write through the repository, NOT FeaturedProviderService — the service validates
    // provider existence via listManifests, and the seeder races provider registration at
    // boot. The repository writes unconditionally.
    for (const { domain, providerId, sortOrder } of FEATURED_PROVIDERS) {
      try {
        await this._repo.upsert(domain, providerId, sortOrder);
        succeeded++;
      } catch (e) {
        // AUD-7: isolate failures per row — one failing row must not starve the rest.
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        this._log.error(`Featured provider ${domain}/${providerId} failed to seed: ${msg}`);
      }
    }

    if (failed === 0) {
      this._log.log(`Featured providers seeded (${FEATURED_PROVIDERS.length} rows).`);
    } else {
      // Partial success still resolves — a seed failure must never crash boot.
      this._log.warn(
        `Featured providers seeded (${succeeded}/${FEATURED_PROVIDERS.length} rows, ${failed} failed).`,
      );
    }
  }
}
