import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProviderDomain, ProviderKernel } from '@postmill-ai/provider-kernel';
import {
  PublicCatalogDomainDto,
  PublicCatalogDto,
  PublicCatalogProviderDto,
} from '@postmill-ai/nestjs-libraries/dtos/providers/public-catalog.dto';
import { IntegrationManager } from '@postmill-ai/nestjs-libraries/integrations/integration.manager';
import {
  CatalogEntry,
  ProviderCatalogService,
} from './provider-catalog.service';
import { PROVIDER_KERNEL } from './provider-kernel.token';
import { RuntimeContextFactory } from './runtime-context.factory';

/**
 * Domains exposed on the anonymous catalogue. `auth`, `email` and
 * `contentpack` are deployment plumbing (SSO, transactional mail, stock
 * packs), not product integrations — they stay off the public surface.
 */
export const PUBLIC_CATALOG_DOMAINS = [
  'social',
  'comms',
  'ai',
  'media',
  'storage',
  'shortlink',
  'vpn',
] as const;
export type PublicCatalogDomain = (typeof PUBLIC_CATALOG_DOMAINS)[number];

const DOMAIN_LABELS: Record<PublicCatalogDomain, string> = {
  social: 'Channels',
  comms: 'Comms apps',
  ai: 'LLM providers',
  media: 'Media studios',
  storage: 'Storage',
  shortlink: 'Short links',
  vpn: 'VPN / Proxy',
};

// Storage has no capability matrix; the meaningful distinction is how the
// bucket is hosted. Every storage module except these two is built with
// `makeS3StorageModule` (kernel/src/domains/storage-helpers.ts).
const STORAGE_KIND: Record<string, PublicCatalogProviderDto['storageKind']> = {
  local: 'built-in',
  medialocker: 'proprietary',
};

const STATUS_RANK: Record<string, number> = { active: 0, preview: 1, deprecated: 2 };

const MEMO_TTL_MS = 60_000;

export function isPublicCatalogDomain(value: unknown): value is PublicCatalogDomain {
  return (PUBLIC_CATALOG_DOMAINS as readonly string[]).includes(value as string);
}

/**
 * Icon path on the app frontend (served from `apps/frontend/public`).
 * Channels + comms apps share the `/icons/platforms/<id>.png` set the app's
 * own `PlatformIcon` uses (youtube is the one SVG there); every other domain
 * has an exported SVG under `/icons/providers/` — see
 * `tools/icons/export-provider-icons.mjs`. Kept host-free so the icon
 * completeness spec can assert the file exists on disk.
 */
export function publicProviderIconPath(domain: string, id: string): string {
  if (domain === 'social' || domain === 'comms') {
    return id === 'youtube' ? '/icons/platforms/youtube.svg' : `/icons/platforms/${id}.png`;
  }
  return `/icons/providers/${id}.svg`;
}

@Injectable()
export class PublicCatalogService {
  private readonly _logger = new Logger(PublicCatalogService.name);
  private readonly _memo = new Map<string, { at: number; value: PublicCatalogDto }>();

  constructor(
    private readonly _catalog: ProviderCatalogService,
    private readonly _integrationManager: IntegrationManager,
    @Inject(PROVIDER_KERNEL) private readonly _kernel: ProviderKernel,
    private readonly _runtimeContextFactory: RuntimeContextFactory,
  ) {}

  async build(domain?: PublicCatalogDomain): Promise<PublicCatalogDto> {
    const key = domain ?? '*';
    const hit = this._memo.get(key);
    if (hit && Date.now() - hit.at < MEMO_TTL_MS) {
      return hit.value;
    }
    const value = await this._assemble(domain);
    this._memo.set(key, { at: Date.now(), value });
    return value;
  }

  private async _assemble(domainFilter?: PublicCatalogDomain): Promise<PublicCatalogDto> {
    const domains = domainFilter ? [domainFilter] : [...PUBLIC_CATALOG_DOMAINS];
    const entries = await this._catalog.buildCatalog(
      domainFilter as ProviderDomain | undefined,
    );
    const social = domains.includes('social') ? this._socialExtras() : new Map();
    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');

    const buckets: PublicCatalogDomainDto[] = domains.map((domain) => {
      const providers = dedupe(entries.filter((e) => e.domain === domain))
        .map((e) =>
          this._toDto(e, domain === 'social' ? social.get(e.providerId) : undefined, frontendUrl),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
      const capabilityKeys: string[] = [];
      for (const p of providers) {
        for (const c of p.capabilities) {
          if (!capabilityKeys.includes(c)) capabilityKeys.push(c);
        }
      }
      return {
        id: domain,
        label: DOMAIN_LABELS[domain],
        count: providers.length,
        capabilityKeys,
        providers,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      total: buckets.reduce((n, b) => n + b.count, 0),
      domains: buckets,
    };
  }

  private _toDto(
    e: CatalogEntry,
    social: SocialExtras | undefined,
    frontendUrl: string,
  ): PublicCatalogProviderDto {
    const caps = (e.capabilities || {}) as Record<string, unknown>;
    const dto: PublicCatalogProviderDto = {
      id: e.providerId,
      domain: e.domain,
      name: e.displayName.replace(/\s+/g, ' ').trim(),
      icon: `${frontendUrl}${publicProviderIconPath(e.domain, e.providerId)}`,
      capabilities: Object.keys(caps).filter((k) => caps[k] === true),
      beta: !e.verified,
      featured: e.featured,
    };
    if (e.description && Object.keys(e.description).length) {
      dto.description = e.description as Record<string, string>;
    }
    if (e.website) dto.website = e.website;
    if (e.featuredSortOrder !== null && e.featuredSortOrder !== undefined) {
      dto.featuredSortOrder = e.featuredSortOrder;
    }
    if (typeof caps.maxMedia === 'number') dto.maxMedia = caps.maxMedia;
    // `metadata.kind` is shared by a package's AI and media modules and is
    // reconciled by the media-studio generator (OpenAI is a multi-model "hub"
    // for media but a direct API for text). For the AI bucket the adapter's
    // own `type` is the truth; media keeps the metadata kind.
    if (e.domain === 'ai') {
      const kind = this._aiAdapterType(e) ?? e.kind;
      if (kind) dto.kind = kind;
    } else if (e.domain === 'media' && e.kind) {
      dto.kind = e.kind;
    }
    if (e.domain === 'storage') {
      dto.storageKind = STORAGE_KIND[e.providerId] ?? 's3-compatible';
    }
    if (e.domain === 'media' && Array.isArray(e.mediaCategories)) {
      dto.mediaCategories = e.mediaCategories as string[];
    }
    if (social) Object.assign(dto, social);
    return dto;
  }

  private _aiAdapterType(e: CatalogEntry): 'hub' | 'direct' | undefined {
    try {
      const mod = this._kernel.get('ai', e.providerId, e.version);
      // create() is pure by contract (all-providers.conformance.spec) and
      // only wires the injected safe fetch; no credentials are involved.
      const adapter = mod?.create(this._runtimeContextFactory.build({})) as
        | { type?: 'hub' | 'direct' }
        | undefined;
      return adapter?.type === 'hub' || adapter?.type === 'direct' ? adapter.type : undefined;
    } catch (err) {
      this._logger.debug(`ai/${e.providerId}: adapter type unavailable — ${(err as Error).message}`);
      return undefined;
    }
  }

  // Adapter-level facts the manifest doesn't carry (editor, auth flow,
  // comment inbox, mentions, auto-plugs) — read off the raw social singletons.
  private _socialExtras(): Map<string, SocialExtras> {
    const plugs = new Set(this._integrationManager.getAllPlugs().map((p) => p.identifier));
    const map = new Map<string, SocialExtras>();
    for (const p of this._integrationManager.getSocialProviders()) {
      const extras: SocialExtras = {
        editor: p.editor,
        selfHosted: !!p.externalUrl,
        web3: !!p.isWeb3,
        chromeExtension: !!p.isChromeExtension,
        mentions: !!p.mention,
        autoPlugs: plugs.has(p.identifier),
      };
      if (p.setupDescriptor?.authType) extras.authType = p.setupDescriptor.authType;
      if (p.commentsCapabilities) {
        const { read, reply, like } = p.commentsCapabilities;
        extras.comments = { read: !!read, reply: !!reply, like: !!like };
      }
      map.set(p.identifier, extras);
    }
    return map;
  }
}

type SocialExtras = Pick<
  PublicCatalogProviderDto,
  | 'editor'
  | 'authType'
  | 'selfHosted'
  | 'web3'
  | 'chromeExtension'
  | 'comments'
  | 'mentions'
  | 'autoPlugs'
>;

// One row per providerId: skip retired versions, keep the healthiest status.
function dedupe(entries: CatalogEntry[]): CatalogEntry[] {
  const best = new Map<string, CatalogEntry>();
  for (const e of entries) {
    if (e.status === 'retired') continue;
    const current = best.get(e.providerId);
    if (!current || (STATUS_RANK[e.status] ?? 9) < (STATUS_RANK[current.status] ?? 9)) {
      best.set(e.providerId, e);
    }
  }
  return [...best.values()];
}
