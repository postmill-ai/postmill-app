import { Inject, Injectable } from '@nestjs/common';
import {
  ProviderDomain,
  ProviderKernel,
} from '@gitroom/provider-kernel';
import { PROVIDER_KERNEL } from './provider-kernel.token';

export interface HealthEntry {
  domain: string;
  providerId: string;
  version: string;
  status: string;
  health: ReturnType<ProviderKernel['getHealth']>;
}

@Injectable()
export class ProviderHealthService {
  constructor(
    @Inject(PROVIDER_KERNEL) private readonly _kernel: ProviderKernel,
  ) {}

  buildHealth(domainFilter?: ProviderDomain): HealthEntry[] {
    const manifests = this._kernel.listManifests(domainFilter);

    return manifests.map((m) => {
      // PROVIDER_REMEDIATION 4.6: health is kernel-owned (keyed by keyString), no
      // longer mutated onto the provider module — read it via kernel.getHealth.
      return {
        domain: m.domain,
        providerId: m.providerId,
        version: m.version,
        status: m.status,
        health: this._kernel.getHealth(m.domain, m.providerId, m.version),
      };
    });
  }
}
