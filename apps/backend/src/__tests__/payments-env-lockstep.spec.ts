import { describe, it, expect } from 'vitest';
import { providerModules } from '@postmill-ai/backend/providers.generated';
import { PaymentsCapability } from '@postmill-ai/provider-kernel';
import {
  PAYMENT_PROVIDER_ENV,
  PAYMENT_PROVIDER_IDS,
  isPaymentProviderConfigured,
} from '@postmill-ai/helpers/billing/payments.env';

/**
 * The pure env table in libraries/helpers (the billing master switch, usable
 * where the kernel is not) must describe exactly the payments modules the
 * kernel registers. Adding a payment provider means adding a row AND a module.
 */
const ctx: any = {
  credentials: {},
  encryption: { encrypt: (v: string) => v, decrypt: (v: string) => v },
  fetch: async () => {
    throw new Error('no network in lockstep spec');
  },
  logger: { log() {}, warn() {}, error() {}, debug() {} },
  telemetry: { recordCall() {} },
};

const paymentsModules = providerModules.filter((m) => m.manifest.domain === 'payments');

describe('payments env table ↔ kernel modules lockstep', () => {
  it('every registered payments module has a row and every row has a module', () => {
    const registered = paymentsModules.map((m) => m.manifest.providerId).sort();
    expect(registered).toEqual([...PAYMENT_PROVIDER_IDS].sort());
  });

  for (const mod of paymentsModules) {
    const id = mod.manifest.providerId as keyof typeof PAYMENT_PROVIDER_ENV;
    describe(id, () => {
      const capability = mod.create(ctx) as PaymentsCapability;
      const row = PAYMENT_PROVIDER_ENV[id];

      it('declares the same required env keys, in the same order', () => {
        expect(capability.requiredEnvKeys).toEqual([...row.required]);
      });

      it('agrees on the checkout mode and the enabling key', () => {
        expect(capability.capabilities.checkoutMode).toBe(row.checkoutMode);
        expect(row.required).toContain(row.enabledBy);
      });

      it('isConfigured() flips on exactly the enabling key', () => {
        const saved: Record<string, string | undefined> = {};
        for (const key of row.required) {
          saved[key] = process.env[key];
          delete process.env[key];
        }
        try {
          expect(capability.isConfigured()).toBe(false);
          expect(isPaymentProviderConfigured(id, process.env)).toBe(false);
          process.env[row.enabledBy] = 'x';
          expect(capability.isConfigured()).toBe(true);
          expect(isPaymentProviderConfigured(id, process.env)).toBe(true);
        } finally {
          for (const key of row.required) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
          }
        }
      });
    });
  }
});
