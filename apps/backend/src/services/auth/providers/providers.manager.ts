import { Injectable } from '@nestjs/common';
import { AuthProviderAbstract } from '@gitroom/backend/services/auth/providers.interface';
import { AuthProviderManager } from '@gitroom/backend/services/auth/providers/auth-provider.manager';

/**
 * Backwards-compatible adapter that resolves auth provider instances through
 * AuthProviderManager. This layer no longer injects AuthProviderRepository
 * directly; the repository lives in AuthProviderManager and is forwarded to
 * kernel adapters from there.
 */
@Injectable()
export class ProvidersManager {
  constructor(private _authProviderManager: AuthProviderManager) {}

  getProvider(provider: string, version?: string): AuthProviderAbstract {
    return this._authProviderManager.getProvider(provider, version);
  }
}
