import { describe, it, expect } from 'vitest';
import {
  billingEnabled,
  configuredPaymentProviders,
  missingPaymentProviderKeys,
  publicPaymentsConfig,
  resolveDefaultNativePaymentProvider,
  resolveDefaultWebPaymentProvider,
} from './payments.env';

const stripe = { STRIPE_PUBLISHABLE_KEY: 'pk_test', STRIPE_SECRET_KEY: 'sk_test', STRIPE_SIGNING_KEY: 'whsec' };
const paypal = { PAYPAL_CLIENT_ID: 'cid', PAYPAL_CLIENT_SECRET: 'PAYPAL_SECRET_X', PAYPAL_WEBHOOK_ID: 'PAYPAL_WEBHOOK_X' };
const apple = { APPLE_IAP_BUNDLE_ID: 'ai.postmill.app', APPLE_IAP_PRIVATE_KEY: 'APPLE_SECRET_P8' };
const google = { GOOGLE_PLAY_PACKAGE_NAME: 'ai.postmill.app', GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: 'GOOGLE_SECRET_SA' };

describe('payments env', () => {
  it('billing is off with no keys and on with any enabling key', () => {
    expect(billingEnabled({})).toBe(false);
    expect(billingEnabled({ STRIPE_PUBLISHABLE_KEY: 'pk' })).toBe(true);
    expect(billingEnabled(apple)).toBe(true);
    expect(configuredPaymentProviders(stripe)).toEqual(['stripe']);
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
    it('none → null (native-only deployments have no web default)', () => {
      expect(resolveDefaultWebPaymentProvider({})).toEqual({ providerId: null, reason: 'none' });
      expect(resolveDefaultWebPaymentProvider(apple)).toEqual({ providerId: null, reason: 'none' });
    });

    it('single configured web provider wins without a flag', () => {
      expect(resolveDefaultWebPaymentProvider(stripe)).toEqual({ providerId: 'stripe', reason: 'single' });
      expect(resolveDefaultWebPaymentProvider({ ...paypal, ...apple })).toEqual({ providerId: 'paypal', reason: 'single' });
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
        detail: expect.stringContaining('not a known payment provider'),
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

  describe('resolveDefaultNativePaymentProvider', () => {
    it('none / single / ambiguous (apple first), ignoring web providers', () => {
      expect(resolveDefaultNativePaymentProvider(stripe)).toEqual({ providerId: null, reason: 'none' });
      expect(resolveDefaultNativePaymentProvider({ ...stripe, ...apple })).toEqual({ providerId: 'apple', reason: 'single' });
      expect(resolveDefaultNativePaymentProvider(google)).toEqual({ providerId: 'google', reason: 'single' });
      const both = resolveDefaultNativePaymentProvider({ ...apple, ...google });
      expect(both).toMatchObject({ providerId: 'apple', reason: 'ambiguous' });
      expect(both.detail).toContain('google');
    });
  });

  it('publicPaymentsConfig never leaks secrets', () => {
    const cfg = publicPaymentsConfig({ ...stripe, ...paypal, ...apple, ...google });
    expect(cfg).toEqual({
      enabled: true,
      defaultProvider: 'stripe',
      providers: [
        { providerId: 'stripe', displayName: 'Stripe', checkoutMode: 'embedded', publicKey: 'pk_test' },
        { providerId: 'paypal', displayName: 'PayPal', checkoutMode: 'hosted', publicKey: 'cid' },
        { providerId: 'apple', displayName: 'App Store', checkoutMode: 'native' },
        { providerId: 'google', displayName: 'Google Play', checkoutMode: 'native' },
      ],
    });
    // Every secret-bearing key in the fixtures must stay out of the browser-safe view.
    for (const secret of ['sk_test', 'whsec', 'PAYPAL_SECRET_X', 'PAYPAL_WEBHOOK_X', 'APPLE_SECRET_P8', 'GOOGLE_SECRET_SA']) {
      expect(JSON.stringify(cfg)).not.toContain(secret);
    }
    expect(publicPaymentsConfig({})).toEqual({ enabled: false, defaultProvider: null, providers: [] });
  });
});
