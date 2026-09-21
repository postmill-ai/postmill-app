import { describe, it, expect } from 'vitest';
import {
  billingEnabled,
  configuredPaymentProviders,
  missingPaymentProviderKeys,
  publicPaymentsConfig,
  resolveDefaultWebPaymentProvider,
} from './payments.env';

const stripe = { STRIPE_PUBLISHABLE_KEY: 'pk_test', STRIPE_SECRET_KEY: 'sk_test', STRIPE_SIGNING_KEY: 'whsec' };
const paypal = { PAYPAL_CLIENT_ID: 'cid', PAYPAL_CLIENT_SECRET: 'sec', PAYPAL_WEBHOOK_ID: 'wh' };
const apple = { APPLE_IAP_BUNDLE_ID: 'ai.postmill.app' };

describe('payments env', () => {
  it('billing is off with no keys and on with any enabling key', () => {
    expect(billingEnabled({})).toBe(false);
    expect(billingEnabled({ STRIPE_PUBLISHABLE_KEY: 'pk' })).toBe(true);
    expect(billingEnabled(apple)).toBe(true);
    expect(configuredPaymentProviders({ ...paypal, ...stripe })).toEqual(['stripe', 'paypal']);
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
      expect(resolveDefaultWebPaymentProvider(apple)).toEqual({ providerId: null, reason: 'none' });
    });

    it('single configured web provider wins without a flag', () => {
      expect(resolveDefaultWebPaymentProvider(paypal)).toEqual({ providerId: 'paypal', reason: 'single' });
    });

    it('several without a flag → ambiguous, stripe first', () => {
      const r = resolveDefaultWebPaymentProvider({ ...paypal, ...stripe });
      expect(r.providerId).toBe('stripe');
      expect(r.reason).toBe('ambiguous');
      expect(r.detail).toContain('PAYMENTS_PROVIDER');
    });

    it('explicit flag picks a configured web provider (version suffix ignored)', () => {
      expect(resolveDefaultWebPaymentProvider({ ...paypal, ...stripe, PAYMENTS_PROVIDER: 'paypal' })).toEqual({
        providerId: 'paypal',
        reason: 'explicit',
      });
      expect(resolveDefaultWebPaymentProvider({ ...stripe, PAYMENTS_PROVIDER: 'stripe@v1' }).providerId).toBe('stripe');
    });

    it('invalid flag values fall back but are reported', () => {
      expect(resolveDefaultWebPaymentProvider({ ...stripe, PAYMENTS_PROVIDER: 'razorpay' })).toMatchObject({
        providerId: 'stripe',
        reason: 'invalid',
      });
      expect(resolveDefaultWebPaymentProvider({ ...stripe, ...apple, PAYMENTS_PROVIDER: 'apple' })).toMatchObject({
        providerId: 'stripe',
        reason: 'invalid',
        detail: expect.stringContaining('native'),
      });
      expect(resolveDefaultWebPaymentProvider({ ...stripe, PAYMENTS_PROVIDER: 'paypal' })).toMatchObject({
        providerId: 'stripe',
        reason: 'invalid',
        detail: expect.stringContaining('PAYPAL_CLIENT_ID'),
      });
    });
  });

  it('publicPaymentsConfig never leaks secrets', () => {
    const cfg = publicPaymentsConfig({ ...stripe, ...apple });
    expect(cfg).toEqual({
      enabled: true,
      defaultProvider: 'stripe',
      providers: [
        { providerId: 'stripe', displayName: 'Stripe', checkoutMode: 'embedded', publicKey: 'pk_test' },
        { providerId: 'apple', displayName: 'App Store', checkoutMode: 'native' },
      ],
    });
    expect(JSON.stringify(cfg)).not.toContain('sk_test');
    expect(publicPaymentsConfig({})).toEqual({ enabled: false, defaultProvider: null, providers: [] });
  });
});
