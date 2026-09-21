import { describe, it, expect } from 'vitest';
import { parseStoreProductId, storeProductId } from '../domains/payments-helpers';
import { runPaymentsConformance } from '../testing/conformance';
import { ProviderModule } from '../module';
import { PaymentsCapabilityFlags } from '../domains/payments';

const baseFlags: PaymentsCapabilityFlags = {
  checkoutMode: 'hosted',
  portal: false,
  proration: false,
  addons: false,
  refunds: false,
  promoCodes: false,
  trials: false,
  cardCheck: false,
  chargesHistory: false,
  periodEndCancel: false,
  planChange: false,
};

function moduleWith(flags: Partial<PaymentsCapabilityFlags>, methods: string[]): ProviderModule<any, any> {
  const capability: any = {
    name: 'fake',
    capabilities: { ...baseFlags, ...flags },
    requiredEnvKeys: ['FAKE_KEY'],
    isConfigured: () => true,
    publicConfig: () => ({ providerId: 'fake', checkoutMode: 'hosted', capabilities: baseFlags }),
    receiveWebhook: async () => ({ eventId: 'x', eventType: 'y', events: [] }),
  };
  for (const m of methods) capability[m] = async () => undefined;
  return {
    manifest: {
      domain: 'payments',
      providerId: 'fake',
      version: 'v1',
      displayName: 'fake',
      status: 'active',
      credentialFields: [],
      capabilities: capability.capabilities,
    },
    create: () => capability,
  };
}

const WEB_METHODS = ['ensureCustomer', 'createCheckout', 'setCancelAtPeriodEnd', 'cancelNow', 'checkoutStatus'];

describe('storeProductId', () => {
  it('round-trips every tier/period through the store convention', () => {
    for (const tier of ['STARTER', 'PRO', 'TEAM', 'AGENCY'] as const) {
      for (const period of ['MONTHLY', 'YEARLY'] as const) {
        const id = storeProductId('postmill', tier, period);
        expect(id).toBe(`postmill.${tier.toLowerCase()}.${period === 'MONTHLY' ? 'monthly' : 'yearly'}`);
        expect(parseStoreProductId('postmill', id)).toEqual({ tier, period });
      }
    }
  });

  it('rejects foreign prefixes, unknown tiers and malformed ids', () => {
    expect(parseStoreProductId('postmill', 'other.pro.monthly')).toBeNull();
    expect(parseStoreProductId('postmill', 'postmill.gold.monthly')).toBeNull();
    expect(parseStoreProductId('postmill', 'postmill.pro.weekly')).toBeNull();
    expect(parseStoreProductId('postmill', 'postmill.pro')).toBeNull();
  });
});

describe('runPaymentsConformance', () => {
  it('accepts a minimal hosted provider', () => {
    expect(() => runPaymentsConformance(moduleWith({}, WEB_METHODS))).not.toThrow();
  });

  it('requires the web checkout methods on hosted/embedded providers', () => {
    expect(() => runPaymentsConformance(moduleWith({}, []))).toThrow(/ensureCustomer/);
  });

  it('requires verifyPurchase on native providers and nothing from the web set', () => {
    expect(() => runPaymentsConformance(moduleWith({ checkoutMode: 'native' }, []))).toThrow(/verifyPurchase/);
    expect(() => runPaymentsConformance(moduleWith({ checkoutMode: 'native' }, ['verifyPurchase']))).not.toThrow();
  });

  it('requires the method behind every true flag', () => {
    expect(() => runPaymentsConformance(moduleWith({ addons: true }, WEB_METHODS))).toThrow(/upsertAddon/);
    expect(() => runPaymentsConformance(moduleWith({ trials: true }, WEB_METHODS))).toThrow(/finishTrial/);
    expect(() =>
      runPaymentsConformance(moduleWith({ trials: true, checkoutMode: 'native' }, ['verifyPurchase'])),
    ).not.toThrow();
  });
});
