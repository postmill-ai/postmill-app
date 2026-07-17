import { ProviderManifest, validateManifest } from '../manifest';
import { ProviderModule, ProviderRuntimeContext } from '../module';

export function assertManifestValid(manifest: ProviderManifest): void {
  validateManifest(manifest);
}

export interface DomainConformanceFixtures {
  /** Sample decrypted credentials for the provider. */
  credentials?: Record<string, string>;
}

export interface DomainConformanceCheck {
  requiredMethods?: string[];
  capabilityKeys?: string[];
}

export function runDomainConformance(
  domain: string,
  module: ProviderModule,
  check: DomainConformanceCheck = {},
  fixtures: DomainConformanceFixtures = {},
): void {
  assertManifestValid(module.manifest);

  if (module.manifest.domain !== domain) {
    throw new Error(
      `Domain mismatch: expected ${domain}, got ${module.manifest.domain}`,
    );
  }

  if (typeof module.create !== 'function') {
    throw new Error('ProviderModule.create is not a function');
  }

  // create() must be pure — it may store the fetch port but must not invoke it
  // (no network I/O) at construction. Swap in a throwing fetch so an actual call
  // surfaces as a clear conformance failure; merely holding the reference is fine.
  let fetchCalledDuringCreate = false;
  const ctx: ProviderRuntimeContext = {
    credentials: fixtures.credentials || {},
    encryption: {
      encrypt: (v) => v,
      decrypt: (v) => v,
    },
    fetch: async () => {
      fetchCalledDuringCreate = true;
      throw new Error(
        'create() must not perform network I/O at construction',
      );
    },
    logger: {
      log: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    telemetry: {
      recordCall: () => {},
    },
  };

  const capability = module.create(ctx);
  if (fetchCalledDuringCreate) {
    throw new Error('create() must not perform network I/O at construction');
  }
  if (capability === undefined || capability === null) {
    throw new Error('ProviderModule.create returned null/undefined');
  }

  if (check.requiredMethods) {
    for (const method of check.requiredMethods) {
      if (typeof (capability as any)[method] !== 'function') {
        throw new Error(`Capability missing required method: ${method}`);
      }
    }
  }

  if (check.capabilityKeys) {
    for (const key of check.capabilityKeys) {
      if ((capability as any).capabilities?.[key] === undefined) {
        throw new Error(`Capability object missing key: ${key}`);
      }
    }
  }
}
