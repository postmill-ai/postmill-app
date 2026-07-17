import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Dispatcher } from 'undici';
import { buildVpnDispatcher } from './vpn-dispatcher.factory';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import type { VpnResolvedProxy } from './org-vpn-config.service';

// Pools undici proxy dispatchers (each owns a connection pool — expensive to
// build). Keyed including a creds fingerprint so a rotation produces a new key
// and the stale dispatcher is abandoned; explicit invalidate() drops entries on
// any VPN config change.
@Injectable()
export class VpnDispatcherService implements OnModuleDestroy {
  private readonly _logger = new Logger(VpnDispatcherService.name);
  private readonly _cache = new Map<
    string,
    { dispatcher: Dispatcher; lastUsed: number }
  >();
  private readonly _max = 50;

  constructor(private _resolution: ProviderResolutionService) {}

  get(orgId: string, identifier: string, resolved: VpnResolvedProxy): Dispatcher {
    const version = resolved.version ?? 'v1';
    const key = `${orgId}:${identifier}:${version}:${resolved.region.id}:${resolved.credsFingerprint}`;

    // Resolve the versioned VPN capability through the kernel for telemetry and
    // to surface retired/unknown versions early. The proxy endpoint itself comes
    // from the pre-resolved VpnResolvedProxy (region + auth) passed in.
    try {
      this._resolution.resolveVpn(identifier, { version });
    } catch (err) {
      this._logger.warn(
        `VPN kernel resolution failed for ${identifier}@${version}: ${(err as Error)?.message}`
      );
    }

    const hit = this._cache.get(key);
    if (hit) {
      hit.lastUsed = Date.now();
      return hit.dispatcher;
    }
    const dispatcher = buildVpnDispatcher(resolved.region, resolved.auth);
    this._cache.set(key, { dispatcher, lastUsed: Date.now() });
    this._evictIfNeeded();
    return dispatcher;
  }

  // Close + drop every dispatcher for an (org, provider) — called on cred/region
  // change or disable so the next post rebuilds with fresh config.
  invalidate(orgId: string, identifier: string): void {
    const prefix = `${orgId}:${identifier}:`;
    for (const [k, v] of this._cache) {
      if (k.startsWith(prefix)) {
        this._close(v.dispatcher);
        this._cache.delete(k);
      }
    }
  }

  onModuleDestroy(): void {
    for (const v of this._cache.values()) this._close(v.dispatcher);
    this._cache.clear();
  }

  private _evictIfNeeded(): void {
    while (this._cache.size > this._max) {
      let oldestKey: string | undefined;
      let oldest = Infinity;
      for (const [k, v] of this._cache) {
        if (v.lastUsed < oldest) {
          oldest = v.lastUsed;
          oldestKey = k;
        }
      }
      if (!oldestKey) break;
      const v = this._cache.get(oldestKey)!;
      this._close(v.dispatcher);
      this._cache.delete(oldestKey);
    }
  }

  private _close(dispatcher: Dispatcher): void {
    try {
      void dispatcher.close();
    } catch (err) {
      this._logger.warn(`Failed to close VPN dispatcher: ${(err as Error)?.message}`);
    }
  }
}
