import { ProviderDomain, ProviderKey, keyString, DEFAULT_VERSION } from './identity';
import { ProviderManifest, ProviderHealth, validateManifest, manifestKeyString } from './manifest';
import { ProviderMetadata } from './domains/metadata';
import { ProviderModule, ProviderRuntimeContext } from './module';
import { TelemetryPort } from './ports';
import {
  ProviderNotFoundError,
  ProviderVersionRetiredError,
  ProviderVersionDeprecatedForWriteError,
  ProviderVersionPreviewError,
  ProviderManifestError,
} from './errors';
import { compareVersions } from './version';

export interface KernelOptions {
  telemetry?: TelemetryPort;
}

function freshHealth(): ProviderHealth {
  return {
    lastSuccessAt: null,
    lastErrorAt: null,
    successCount: 0,
    errorCount: 0,
    consecutiveErrors: 0,
  };
}

/**
 * 4.3: provider adapters embed response bodies / `?key=…` URLs in thrown error
 * messages. Scrub obvious secrets and cap length before handing to the
 * telemetry port so secrets/PII never land in telemetry storage.
 */
function scrubErrorMessage(message?: string): string | undefined {
  if (!message) return message;
  let out = message
    // Bearer / api key tokens
    .replace(/(bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
    .replace(/\b(sk|pk|pos|pca|pcs|rk)[_-][A-Za-z0-9]{6,}/g, '[redacted]')
    // key/secret/token/password query params or json values
    .replace(
      /((?:api[_-]?key|apikey|secret|token|password|authorization|access[_-]?token)["'\s]*[:=]["'\s]*)[^"'\s,&}]+/gi,
      '$1[redacted]',
    )
    // ?key=… / &api_key=… in URLs
    .replace(/([?&](?:key|api[_-]?key|token|secret|access_token)=)[^&\s]+/gi, '$1[redacted]');
  if (out.length > 500) out = out.slice(0, 500) + '…';
  return out;
}

export class ProviderKernel {
  private readonly _store = new Map<
    string,
    Map<string, Map<string, ProviderModule>>
  >();
  // 4.6: health state is kernel-owned, keyed by keyString, so two kernel
  // instances in one process (app + test) do not cross-pollute counters via a
  // shared module-level constant.
  private readonly _health = new Map<string, ProviderHealth>();
  private readonly _telemetry?: TelemetryPort;

  constructor(options: KernelOptions = {}) {
    this._telemetry = options.telemetry;
  }

  register<Caps, Capability>(module: ProviderModule<Caps, Capability>): void {
    const manifest = module.manifest;
    try {
      validateManifest(manifest);
    } catch (err) {
      throw new ProviderManifestError(
        {
          domain: manifest?.domain || 'unknown',
          providerId: manifest?.providerId || 'unknown',
          version: manifest?.version,
        },
        (err as Error).message,
      );
    }

    const domainMap = this._store.get(manifest.domain) || new Map<string, Map<string, ProviderModule>>();
    const providerMap = domainMap.get(manifest.providerId) || new Map<string, ProviderModule>();

    if (providerMap.has(manifest.version)) {
      throw new ProviderManifestError(
        {
          domain: manifest.domain,
          providerId: manifest.providerId,
          version: manifest.version,
        },
        `Duplicate registration of ${manifestKeyString(manifest)}`,
      );
    }

    // 4.6: initialise kernel-owned health rather than mutating the shared
    // module constant.
    this._health.set(manifestKeyString(manifest), freshHealth());

    providerMap.set(manifest.version, module);
    domainMap.set(manifest.providerId, providerMap);
    this._store.set(manifest.domain, domainMap);
  }

  /** Kernel-owned health for a provider version (4.6). */
  getHealth(
    domain: ProviderDomain,
    providerId: string,
    version: string,
  ): ProviderHealth | undefined {
    return this._health.get(keyString({ domain, providerId, version }));
  }

  get<Caps, Capability>(
    domain: ProviderDomain,
    providerId: string,
    version: string,
  ): ProviderModule<Caps, Capability> | undefined {
    return this._store.get(domain)?.get(providerId)?.get(version) as
      | ProviderModule<Caps, Capability>
      | undefined;
  }

  // 4.2 / PF-06 — version-ordering INVARIANT: `latestActive` ranks by full
  // semver comparison (`compareVersions`). Prerelease suffixes (`v2-beta`) must
  // carry status `preview`; only `active` versions are considered here, so a
  // `preview` release is excluded and the stable `v2` wins.
  latestActive<Caps, Capability>(
    domain: ProviderDomain,
    providerId: string,
  ): ProviderModule<Caps, Capability> | undefined {
    const providerMap = this._store.get(domain)?.get(providerId);
    if (!providerMap) return undefined;

    let selected: ProviderModule<Caps, Capability> | undefined;
    for (const [version, mod] of providerMap) {
      if (mod.manifest.status !== 'active') continue;
      if (!selected || compareVersions(version, selected.manifest.version) > 0) {
        selected = mod as ProviderModule<Caps, Capability>;
      }
    }
    return selected;
  }

  resolveForRead<Caps, Capability>(
    domain: ProviderDomain,
    providerId: string,
    version = DEFAULT_VERSION,
  ): ProviderModule<Caps, Capability> {
    const mod = this.get<Caps, Capability>(domain, providerId, version);
    if (!mod) {
      throw new ProviderNotFoundError({ domain, providerId, version });
    }
    if (mod.manifest.status === 'retired') {
      throw new ProviderVersionRetiredError({ domain, providerId, version });
    }
    return mod;
  }

  resolveForWrite<Caps, Capability>(
    domain: ProviderDomain,
    providerId: string,
    version?: string,
    opts?: { allowPreview?: boolean; allowDeprecated?: boolean },
  ): ProviderModule<Caps, Capability> {
    if (version) {
      const mod = this.get<Caps, Capability>(domain, providerId, version);
      if (!mod) {
        throw new ProviderNotFoundError({ domain, providerId, version });
      }
      if (mod.manifest.status === 'retired') {
        throw new ProviderVersionRetiredError({ domain, providerId, version });
      }
      // PROVIDER_REMEDIATION_02 §1.4: a deprecated version rejects a write that
      // NEWLY pins it, but an IN-PLACE update of a row already pinned to it
      // (credential rotation, rename, disable) must still be allowed —
      // `allowDeprecated` lets the resolution layer opt into that. Retired stays
      // terminal even in place.
      if (mod.manifest.status === 'deprecated' && !opts?.allowDeprecated) {
        throw new ProviderVersionDeprecatedForWriteError({ domain, providerId, version });
      }
      if (mod.manifest.status === 'preview' && !opts?.allowPreview) {
        // 4.12: distinct error so callers can special-case preview opt-in vs a
        // deprecated version that can never be pinned.
        throw new ProviderVersionPreviewError({ domain, providerId, version });
      }
      return mod;
    }

    const latest = this.latestActive<Caps, Capability>(domain, providerId);
    if (!latest) {
      throw new ProviderNotFoundError({ domain, providerId });
    }
    return latest;
  }

  versions(domain: ProviderDomain, providerId: string): ProviderManifest[] {
    const providerMap = this._store.get(domain)?.get(providerId);
    if (!providerMap) return [];
    return Array.from(providerMap.values()).map((m) => m.manifest);
  }

  listManifests(
    domain?: ProviderDomain,
  ): Array<ProviderManifest & { metadata?: ProviderMetadata }> {
    const out: Array<ProviderManifest & { metadata?: ProviderMetadata }> = [];
    for (const [d, domainMap] of this._store) {
      if (domain && d !== domain) continue;
      for (const providerMap of domainMap.values()) {
        for (const mod of providerMap.values()) {
          out.push({ ...mod.manifest, metadata: mod.metadata });
        }
      }
    }
    return out;
  }

  getMetadata(
    domain: ProviderDomain,
    providerId: string,
    version: string,
  ): ProviderMetadata | undefined {
    return this._store.get(domain)?.get(providerId)?.get(version)?.metadata;
  }

  listMetadata(domain?: ProviderDomain): ProviderMetadata[] {
    const out: ProviderMetadata[] = [];
    for (const [d, domainMap] of this._store) {
      if (domain && d !== domain) continue;
      for (const providerMap of domainMap.values()) {
        for (const mod of providerMap.values()) {
          if (mod.metadata) {
            out.push(mod.metadata);
          }
        }
      }
    }
    return out;
  }

  recordSuccess(key: ProviderKey, latencyMs = 0): void {
    const health = this._health.get(keyString(key));
    if (!health) return;
    health.lastSuccessAt = Date.now();
    health.successCount += 1;
    health.consecutiveErrors = 0;
    this._telemetry?.recordCall({
      domain: key.domain,
      providerId: key.providerId,
      version: key.version,
      ok: true,
      latencyMs,
    });
  }

  recordError(key: ProviderKey, error?: string, latencyMs = 0): void {
    const health = this._health.get(keyString(key));
    if (!health) return;
    health.lastErrorAt = Date.now();
    health.errorCount += 1;
    health.consecutiveErrors += 1;
    this._telemetry?.recordCall({
      domain: key.domain,
      providerId: key.providerId,
      version: key.version,
      ok: false,
      latencyMs,
      error: scrubErrorMessage(error),
    });
  }
}
