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

/**
 * Payments-domain conformance: the base check plus the mode/flag-driven
 * method requirements of `domains/payments.ts`. A flag set to `true` without
 * its method (or a native provider without `verifyPurchase`) is a hard failure
 * so the orchestrator can trust `capabilities` when deciding what to call.
 */
export function runPaymentsConformance(
  module: ProviderModule,
  fixtures: DomainConformanceFixtures = {},
): void {
  runDomainConformance(
    'payments',
    module,
    { requiredMethods: ['isConfigured', 'publicConfig', 'receiveWebhook'] },
    fixtures,
  );

  const capability: any = module.create({
    credentials: fixtures.credentials || {},
    encryption: { encrypt: (v) => v, decrypt: (v) => v },
    fetch: async () => {
      throw new Error('conformance fetch');
    },
    logger: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    telemetry: { recordCall: () => {} },
  });
  const flags = capability.capabilities;
  if (!flags || !['hosted', 'embedded', 'native'].includes(flags.checkoutMode)) {
    throw new Error('payments capability must declare capabilities.checkoutMode');
  }
  if (!Array.isArray(capability.requiredEnvKeys) || capability.requiredEnvKeys.length === 0) {
    throw new Error('payments capability must declare requiredEnvKeys');
  }

  const requireMethod = (method: string, reason: string) => {
    if (typeof capability[method] !== 'function') {
      throw new Error(`payments capability missing ${method} (${reason})`);
    }
  };

  if (flags.checkoutMode === 'native') {
    requireMethod('verifyPurchase', 'checkoutMode native');
  } else {
    for (const m of ['ensureCustomer', 'createCheckout', 'setCancelAtPeriodEnd', 'cancelNow', 'checkoutStatus']) {
      requireMethod(m, `checkoutMode ${flags.checkoutMode}`);
    }
  }

  const FLAG_METHODS: Record<string, string[]> = {
    portal: ['manageUrl'],
    proration: ['previewProration'],
    addons: ['upsertAddon', 'cancelAddon', 'listAddonQuantities'],
    refunds: ['refund'],
    chargesHistory: ['listCharges'],
    promoCodes: ['checkDiscount', 'applyDiscount'],
    cardCheck: ['verifyPaymentMethod'],
    planChange: ['changePlan'],
  };
  for (const [flag, methods] of Object.entries(FLAG_METHODS)) {
    if (flags[flag]) {
      for (const m of methods) requireMethod(m, `capabilities.${flag}`);
    }
  }
  if (flags.trials && flags.checkoutMode !== 'native') {
    requireMethod('finishTrial', 'capabilities.trials on a web provider');
  }
}
