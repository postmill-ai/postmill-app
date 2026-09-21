import { describe, it, expect } from 'vitest';
import {
  billingEnabled,
  configuredPaymentProviders,
  missingPaymentProviderKeys,
  publicPaymentsConfig,
  resolveDefaultWebPaymentProvider,
} from './payments.env';

const stripe = { STRIPE_PUBLISHABLE_KEY: 'pk_test', STRIPE_SECRET_KEY: 'sk_test', STRIPE_SIGNING_KEY: 'whsec' };

describe('payments env', () => {
  it('billing is off with no keys and on with any enabling key', () => {
    expect(billingEnabled({})).toBe(false);
    expect(billingEnabled({ STRIPE_PUBLISHABLE_KEY: 'pk' })).toBe(true);
    expect(configuredPaymentProviders(stripe)).toEqual(['stripe']);
  });

  it('reports missing companion keys only for enabled providers', () => {
    expect(missingPaymentProviderKeys('stripe', {})).toEqual([]);
    expect(missingPaymentProviderKeys('stripe', { STRIPE_PUBLISHABLE_KEY: 'pk' })).toEqual([
      'STRIPE_SECRET_KEY',
      'STRIPE_SIGNING_KEY',
    ]);
  });

  describe('resolveDefaultWebPaymentProvider', () => {
    it('none → null', () => {
      expect(resolveDefaultWebPaymentProvider({})).toEqual({ providerId: null, reason: 'none' });
    });

    it('single configured web provider wins without a flag', () => {
      expect(resolveDefaultWebPaymentProvider(stripe)).toEqual({ providerId: 'stripe', reason: 'single' });
    });

    it('explicit flag picks a configured web provider (version suffix ignored)', () => {
      expect(resolveDefaultWebPaymentProvider({ ...stripe, PAYMENTS_PROVIDER: 'stripe' })).toEqual({
        providerId: 'stripe',
        reason: 'explicit',
      });
      expect(resolveDefaultWebPaymentProvider({ ...stripe, PAYMENTS_PROVIDER: 'stripe@v1' }).providerId).toBe('stripe');
    });

    it('invalid flag values fall back but are reported', () => {
      expect(resolveDefaultWebPaymentProvider({ ...stripe, PAYMENTS_PROVIDER: 'razorpay' })).toMatchObject({
        providerId: 'stripe',
        reason: 'invalid',
        detail: expect.stringContaining('not a known payment provider'),
      });
      expect(resolveDefaultWebPaymentProvider({ PAYMENTS_PROVIDER: 'stripe' })).toMatchObject({
        providerId: null,
        reason: 'invalid',
        detail: expect.stringContaining('STRIPE_PUBLISHABLE_KEY'),
      });
    });
  });

  it('publicPaymentsConfig never leaks secrets', () => {
    const cfg = publicPaymentsConfig(stripe);
    expect(cfg).toEqual({
      enabled: true,
      defaultProvider: 'stripe',
      providers: [{ providerId: 'stripe', displayName: 'Stripe', checkoutMode: 'embedded', publicKey: 'pk_test' }],
    });
    expect(JSON.stringify(cfg)).not.toContain('sk_test');
    expect(publicPaymentsConfig({})).toEqual({ enabled: false, defaultProvider: null, providers: [] });
  });
});
