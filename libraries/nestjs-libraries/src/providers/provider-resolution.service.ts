import {
  BadRequestException,
  GoneException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  ProviderKernel,
  ProviderKey,
  ProviderModule,
  ProviderRuntimeContext,
  ResolvedProvider,
  DEFAULT_VERSION,
  ProviderDomain,
  ContentPackCapability,
  ProviderManifest,
  ProviderNotFoundError,
  ProviderVersionRetiredError,
  ProviderVersionDeprecatedForWriteError,
  ProviderVersionPreviewError,
  ProviderVersionInvalidError,
} from '@gitroom/provider-kernel';
import { accountFingerprint } from '@gitroom/nestjs-libraries/utils/account-fingerprint';
import { AIProviderAdapter } from '@gitroom/nestjs-libraries/ai/ai-provider.interface';
import { MediaProviderAdapter } from '@gitroom/nestjs-libraries/media/media-provider-adapter.interface';
import { ShortLinkAdapter } from '@gitroom/nestjs-libraries/short-linking/short-link.interface';
import { VpnProviderAdapter } from '@gitroom/nestjs-libraries/vpn/vpn-provider.interface';
import { EmailAdapter } from '@gitroom/nestjs-libraries/emails/email-adapter.interface';
import { IStorageAdapter } from '@gitroom/nestjs-libraries/upload/upload.interface';
import { SocialProvider } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { PROVIDER_KERNEL } from './provider-kernel.token';
import { RuntimeContextFactory } from './runtime-context.factory';
import { trace } from '@opentelemetry/api';

export interface ResolutionOptions {
  version?: string;
  credentials?: Record<string, string>;
  orgId?: string;
  extras?: Record<string, unknown>;
}

// 4.1: deterministic JSON with lexicographically-sorted object keys, so the
// cache fingerprint is independent of caller key-insertion order. BigInt (and
// other non-JSON-safe scalars) are coerced to a string instead of throwing,
// which plain JSON.stringify would do on a BigInt in `extras`.
function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (typeof v === 'bigint') return `${v}n`;
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) return '[circular]';
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      out[key] = walk((v as Record<string, unknown>)[key]);
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

function makeTelemetryProxy<T extends object>(
  target: T,
  key: ProviderKey,
  logger: Logger,
  kernel: ProviderKernel,
): T {
  const keyStr = `${key.domain}/${key.providerId}@${key.version}`;
  // 6.4: cache one wrapper per property so `adapter.m === adapter.m` and
  // referential identity is preserved across accesses.
  const wrapperCache = new Map<string | symbol, unknown>();
  const proxy: T = new Proxy(target, {
    get(obj, prop) {
      const value = (obj as Record<string | symbol, unknown>)[prop];
      if (typeof value !== 'function') {
        return value;
      }
      const cached = wrapperCache.get(prop);
      if (cached) return cached;
      const operation = String(prop);
      const wrapped = function (...args: unknown[]) {
        const start = performance.now();
        logger.debug(`provider-call ${keyStr}.${operation}`, {
          keyString: keyStr,
          operation,
        });
        const result = (value as (...args: unknown[]) => unknown).apply(obj, args);
        // 4.2: only asynchronous (promise-returning) results are counted as
        // provider calls. Synchronous local helpers (resolveRegions,
        // generateAuthUrl, capability getters) and synchronous validation
        // throws must not inflate successCount / consecutiveErrors.
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          // G4: provider-call span. `trace.getTracer` is a no-op when no OTel SDK
          // is started, so this is zero-cost on the production default.
          const span = trace
            .getTracer('postmill')
            .startSpan(`provider.${key.domain}.${key.providerId}`);
          span.setAttribute('keyString', keyStr);
          span.setAttribute('provider.operation', operation);
          return (result as Promise<unknown>)
            .then((res) => {
              kernel.recordSuccess(key, performance.now() - start); // 4.1
              span.end();
              // 6.4: if the method returned the adapter itself, hand back the
              // proxy so telemetry wrapping survives the escape.
              return res === target ? proxy : res;
            })
            .catch((err: Error) => {
              kernel.recordError(key, err?.message, performance.now() - start); // 4.1/4.3
              span.end();
              throw err;
            });
        }
        return result === target ? proxy : result;
      };
      wrapperCache.set(prop, wrapped);
      return wrapped;
    },
  }) as T;
  return proxy;
}

/**
 * 1.3: size-capped LRU so rotated-credential fingerprints and deleted-org
 * entries age out even if a caller forgets to invalidate. Insertion order in a
 * JS Map is iteration order; re-inserting on read marks an entry most-recent.
 */
class LruMap<V> {
  private readonly _map = new Map<string, V>();
  constructor(private readonly _max: number) {}
  get(key: string): V | undefined {
    const v = this._map.get(key);
    if (v !== undefined) {
      this._map.delete(key);
      this._map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V): void {
    if (this._map.has(key)) this._map.delete(key);
    this._map.set(key, value);
    while (this._map.size > this._max) {
      const oldest = this._map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this._map.delete(oldest);
    }
  }
  delete(key: string): void {
    this._map.delete(key);
  }
  keys(): IterableIterator<string> {
    return this._map.keys();
  }
  get size(): number {
    return this._map.size;
  }
}

@Injectable()
export class ProviderResolutionService {
  constructor(
    @Inject(PROVIDER_KERNEL) private readonly _kernel: ProviderKernel,
    private readonly _runtimeContext: RuntimeContextFactory,
    private readonly _logger: Logger,
  ) {}

  /**
   * Capability instance cache (7.0.6). Keyed by
   * `${domain}/${providerId}@${version}:${orgId ?? 'global'}:${creds-fingerprint}`
   * — mirrors the VPN dispatcher cache key. `module.create(ctx)` is cheap and
   * side-effect-free, but services should not rebuild 37 social / N media
   * adapters per request; the cache preserves the de-facto singleton behaviour
   * the social VPN-egress AsyncLocalStorage path assumes.
   */
  private readonly _capabilityCache = new LruMap<unknown>(2048);

  private _buildContext(options: ResolutionOptions): ProviderRuntimeContext {
    return this._runtimeContext.build({
      credentials: options.credentials,
      orgId: options.orgId,
      extras: options.extras,
    });
  }

  private _cacheKey(
    domain: ProviderDomain,
    providerId: string,
    version: string,
    options: ResolutionOptions,
  ): string {
    // 0.5: fold `extras` into the key. S3/storage and content-pack adapters bind
    // `extras` (bucket/region/endpoint/publicUrl, extraConfig) at create time and
    // are stateful — two configs in one org with the same credentials but a
    // different bucket must NOT share a cached adapter, or uploads land in the
    // wrong bucket. Credentials + extras are fingerprinted together into one
    // stable hash.
    // 4.1: canonicalize with SORTED keys before hashing — plain JSON.stringify
    // serializes in construction order, so two call sites building the same
    // logical extras in different key order would double-cache. stableStringify
    // also coerces non-JSON-safe values (BigInt) instead of throwing.
    const fingerprint = accountFingerprint(
      options.credentials || options.extras
        ? stableStringify({
            credentials: options.credentials ?? null,
            extras: options.extras ?? null,
          })
        : null,
    );
    return `${domain}/${providerId}@${version}:${options.orgId ?? 'global'}:${fingerprint}`;
  }

  /**
   * Resolve a kernel-registered provider into a cached, telemetry-wrapped
   * capability plus its module/version (7.0.4 + 7.0.6). The kernel is the sole
   * resolution path — the legacy in-memory registries have been removed.
   */
  private _resolveKernel<C>(
    domain: ProviderDomain,
    providerId: string,
    options: ResolutionOptions,
  ): ResolvedProvider<C> {
    // PF-03: an empty-string version is not "no version"; it is invalid data.
    if (options.version === '') {
      throw new ProviderVersionInvalidError(
        { domain, providerId, version: options.version },
        'Version cannot be empty',
      );
    }
    // 1.2: when no version is pinned, resolve the latest ACTIVE version rather
    // than hard-defaulting to v1 — otherwise the moment a provider ships v2 and
    // retires v1 every no-version caller 404/410s a provider that is active.
    const version =
      options.version ??
      this._kernel.latestActive(domain, providerId)?.manifest.version ??
      DEFAULT_VERSION;
    // 1.5: read-path lifecycle errors (ProviderVersionRetiredError → 410 with a
    // `latestActive` upgrade hint, ProviderNotFoundError → 404) are mapped by the
    // GLOBAL ProviderExceptionFilter (apps/backend app.module APP_FILTER), which
    // also carries providerId/version in the body. Let the raw kernel errors
    // propagate to it — mapping to Nest exceptions here would bypass the filter
    // and lose the richer body. (Non-HTTP callers — Inngest activities — catch or
    // fail their own step; no 500 surface either way.)
    const mod = this._kernel.resolveForRead<unknown, C>(
      domain,
      providerId,
      version,
    );

    const cacheKey = this._cacheKey(domain, providerId, version, options);
    let capability = this._capabilityCache.get(cacheKey) as C | undefined;
    if (capability === undefined) {
      capability = makeTelemetryProxy(
        mod.create(this._buildContext(options)) as object,
        { domain, providerId, version },
        this._logger,
        this._kernel,
      ) as C;
      this._capabilityCache.set(cacheKey, capability);
    }

    return { module: mod as ProviderModule, capability, version };
  }

  /**
   * Public resolution variant returning the full {@link ResolvedProvider}
   * (module + capability + version) for callers that need the manifest/version
   * alongside the capability. Resolves exclusively through the kernel.
   */
  resolveProvider<C>(
    domain: ProviderDomain,
    providerId: string,
    options: ResolutionOptions = {},
  ): ResolvedProvider<C> {
    return this._resolveKernel<C>(domain, providerId, options);
  }

  /**
   * Invalidate cached capability instances. Config-mutation services
   * (e.g. OrgAiSettingsService, OrgShortLinkSettingsService,
   * OrgMediaProviderSettingsService, OrgVpnConfig writes, channel credential
   * updates) MUST call this after a credential/config change so the next
   * resolve rebuilds the capability with fresh credentials.
   */
  invalidate(
    domain: ProviderDomain,
    providerId: string,
    orgId?: string,
  ): void {
    const prefix = `${domain}/${providerId}@`;
    const orgSegment = orgId !== undefined ? `:${orgId}:` : undefined;
    for (const key of this._capabilityCache.keys()) {
      if (!key.startsWith(prefix)) continue;
      if (orgSegment && !key.includes(orgSegment)) continue;
      this._capabilityCache.delete(key);
    }
  }

  /** Invalidate every cached capability for an org (e.g. on org-wide changes). */
  invalidateOrg(orgId: string): void {
    const orgSegment = `:${orgId}:`;
    for (const key of this._capabilityCache.keys()) {
      if (key.includes(orgSegment)) {
        this._capabilityCache.delete(key);
      }
    }
  }

  resolveAI(
    providerId: string,
    options: ResolutionOptions = {},
  ): AIProviderAdapter {
    return this._resolveKernel<AIProviderAdapter>('ai', providerId, options)
      .capability;
  }

  resolveMedia(
    providerId: string,
    options: ResolutionOptions = {},
  ): MediaProviderAdapter {
    return this._resolveKernel<MediaProviderAdapter>('media', providerId, options)
      .capability;
  }

  resolveShortLink(
    providerId: string,
    options: ResolutionOptions = {},
  ): ShortLinkAdapter {
    return this._resolveKernel<ShortLinkAdapter>(
      'shortlink',
      providerId,
      options,
    ).capability;
  }

  resolveVpn(
    providerId: string,
    options: ResolutionOptions = {},
  ): VpnProviderAdapter {
    return this._resolveKernel<VpnProviderAdapter>('vpn', providerId, options)
      .capability;
  }

  resolveEmail(
    providerId: string,
    options: ResolutionOptions = {},
  ): EmailAdapter {
    return this._resolveKernel<EmailAdapter>('email', providerId, options)
      .capability;
  }

  resolveStorage(
    providerId: string,
    options: ResolutionOptions = {},
  ): IStorageAdapter {
    return this._resolveKernel<IStorageAdapter>('storage', providerId, options)
      .capability;
  }

  resolveSocial(
    providerId: string,
    options: ResolutionOptions = {},
  ): SocialProvider {
    return this._resolveKernel<SocialProvider>('social', providerId, options)
      .capability;
  }

  resolveContentPack(
    providerId: string,
    options: ResolutionOptions = {},
  ): ContentPackCapability {
    return this._resolveKernel<ContentPackCapability>(
      'contentpack',
      providerId,
      options,
    ).capability;
  }

  /**
   * Public manifest catalog for a domain (or all domains). The kernel is the
   * single source of truth for provider metadata (displayName, capabilities,
   * credentialFields, status/version) — settings surfaces project these instead
   * of holding their own hardcoded catalog object.
   */
  listManifests(domain?: ProviderDomain): ProviderManifest[] {
    return this._kernel.listManifests(domain);
  }

  latestActiveVersion(domain: ProviderDomain, providerId: string): string | undefined {
    return this._kernel.latestActive(domain, providerId)?.manifest.version;
  }

  /**
   * 1.1: single entry point every settings write path must call before pinning a
   * config to a version. Validates the (client-supplied or defaulted) version
   * against the lifecycle — a deprecated version rejects new writes, a retired
   * version is 410, an unknown version is a 400 — and returns the resolved
   * version to persist. When no version is supplied it resolves latest-active.
   */
  resolveWriteVersion(
    domain: ProviderDomain,
    providerId: string,
    version?: string,
    opts?: { allowPreview?: boolean; currentVersion?: string },
  ): string {
    try {
      // 1.4 / PF-03: distinguish pinning a NEW version (create, or an explicit
      // version change) from updating an existing row AT its current pinned
      // version. An empty-string version is invalid data, not "no version".
      if (version === '') {
        throw new ProviderVersionInvalidError(
          { domain, providerId, version },
          'Version cannot be empty',
        );
      }

      // 1.4: an in-place update of a deprecated-pinned row (disable / credential
      // rotation / rename) must be allowed — only a write that would newly pin a
      // deprecated/retired/preview version is rejected. `currentVersion` is the
      // row's already-pinned version on updates.
      let currentVersion = opts?.currentVersion;

      // PF-04: do not trust caller-supplied `currentVersion` for the deprecated
      // bypass. Verify it resolves to a real registered module before treating
      // the call as an in-place update. A spoofed or unknown currentVersion
      // falls back to the stricter new-pin path.
      if (
        currentVersion !== undefined &&
        !this._kernel.get(domain, providerId, currentVersion)
      ) {
        currentVersion = undefined;
      }

      const target = version ?? currentVersion;
      const isInPlaceUpdate =
        currentVersion !== undefined &&
        (version === undefined || version === currentVersion);
      return this._kernel
        .resolveForWrite(domain, providerId, target, {
          allowPreview: opts?.allowPreview,
          allowDeprecated: isInPlaceUpdate,
        })
        .manifest.version;
    } catch (err) {
      if (err instanceof ProviderVersionRetiredError) {
        throw new GoneException(err.message);
      }
      if (
        err instanceof ProviderVersionDeprecatedForWriteError ||
        err instanceof ProviderVersionPreviewError ||
        err instanceof ProviderNotFoundError ||
        err instanceof ProviderVersionInvalidError
      ) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /** Kernel-owned per-version health counters (4.6). */
  getHealth(domain: ProviderDomain, providerId: string, version: string) {
    return this._kernel.getHealth(domain, providerId, version);
  }

  keyString(domain: string, providerId: string, version?: string): string {
    return `${domain}/${providerId}@${version ?? DEFAULT_VERSION}`;
  }
}
