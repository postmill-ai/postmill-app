import { describe, it, expect, vi, beforeEach } from 'vitest';

const lib = vi.hoisted(() => ({
  verifiers: [] as any[],
  constructorError: null as string | null,
  clients: new Map<string, any>(),
  decodeTransaction: vi.fn(),
  decodeRenewal: vi.fn(),
  decodeNotification: vi.fn(),
  getAllSubscriptionStatuses: vi.fn(),
}));

vi.mock('@apple/app-store-server-library', () => ({
  Environment: { SANDBOX: 'Sandbox', PRODUCTION: 'Production' },
  Status: { ACTIVE: 1, EXPIRED: 2, BILLING_RETRY: 3, BILLING_GRACE_PERIOD: 4, REVOKED: 5 },
  VerificationStatus: { OK: 0, VERIFICATION_FAILURE: 1, RETRYABLE_VERIFICATION_FAILURE: 2, INVALID_APP_IDENTIFIER: 3, INVALID_ENVIRONMENT: 4, INVALID_CHAIN_LENGTH: 5, INVALID_CERTIFICATE: 6, FAILURE: 7 },
  VerificationException: class extends Error {
    constructor(public status: number) {
      super(`verification status ${status}`);
    }
  },
  SignedDataVerifier: class {
    env: string;
    constructor(_certs: Buffer[], _online: boolean, env: string) {
      if (lib.constructorError) throw new Error(lib.constructorError);
      this.env = env;
      lib.verifiers.push(this);
    }
    verifyAndDecodeTransaction(jws: string) {
      return lib.decodeTransaction(jws, this.env);
    }
    verifyAndDecodeRenewalInfo(jws: string) {
      return lib.decodeRenewal(jws, this.env);
    }
    verifyAndDecodeNotification(jws: string) {
      return lib.decodeNotification(jws, this.env);
    }
  },
  AppStoreServerAPIClient: class {
    constructor(_key: string, _keyId: string, _issuer: string, _bundle: string, env: string) {
      lib.clients.set(env, this);
    }
    getAllSubscriptionStatuses(id: string) {
      return lib.getAllSubscriptionStatuses(id);
    }
  },
}));

import { ApplePaymentsAdapter } from './payments.adapter';
import { PaymentsWebhookVerificationError } from '@postmill-ai/provider-kernel';

const ORG = '4f2c8f8e-1111-4222-8333-444455556666';
const tx = (overrides: Record<string, any> = {}) => ({
  originalTransactionId: 'otx_1',
  bundleId: 'ai.postmill.app',
  productId: 'postmill.pro.monthly',
  expiresDate: Date.parse('2030-01-01T00:00:00Z'),
  appAccountToken: ORG,
  environment: 'Production',
  type: 'Auto-Renewable Subscription',
  price: 29990,
  currency: 'USD',
  ...overrides,
});
const statuses = (status = 1, extra: Record<string, any> = {}) => ({
  data: [{ lastTransactions: [{ originalTransactionId: 'otx_1', status, signedTransactionInfo: 'tx-jws', signedRenewalInfo: 'ri-jws', ...extra }] }],
});

let adapter: ApplePaymentsAdapter;

beforeEach(() => {
  vi.clearAllMocks();
  lib.verifiers.length = 0;
  lib.constructorError = null;
  lib.clients.clear();
  process.env.APPLE_IAP_BUNDLE_ID = 'ai.postmill.app';
  process.env.APPLE_IAP_ISSUER_ID = 'iss';
  process.env.APPLE_IAP_KEY_ID = 'kid';
  process.env.APPLE_IAP_PRIVATE_KEY = Buffer.from('-----BEGIN PRIVATE KEY-----').toString('base64');
  delete process.env.APPLE_IAP_ENV;
  delete process.env.APPLE_IAP_ALLOW_SANDBOX;
  delete process.env.PAYMENTS_APPLE_PRODUCT_PREFIX;
  adapter = new ApplePaymentsAdapter();
  lib.decodeTransaction.mockImplementation(async () => tx());
  lib.decodeRenewal.mockImplementation(async () => ({ autoRenewStatus: 1 }));
  lib.getAllSubscriptionStatuses.mockResolvedValue(statuses());
});

describe('config', () => {
  it('is enabled by the bundle id and exposes no public key', () => {
    expect(adapter.isConfigured()).toBe(true);
    expect(adapter.publicConfig()).toEqual({ providerId: 'apple', checkoutMode: 'native', capabilities: adapter.capabilities });
    delete process.env.APPLE_IAP_BUNDLE_ID;
    expect(adapter.isConfigured()).toBe(false);
  });

  it('reports a verifier that cannot be built (missing appAppleId) as a verification failure, not a crash', async () => {
    lib.constructorError = 'appAppleId is required when the environment is Production';
    await expect(adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } })).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
    await expect(adapter.receiveWebhook({ rawBody: Buffer.from('{"signedPayload":"x"}'), headers: {}, query: {} })).rejects.toThrow(/appAppleId/);
  });

  it('builds one verifier per accepted environment', async () => {
    await adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } });
    expect(lib.verifiers.map((v) => v.env)).toEqual(['Production']);
    process.env.APPLE_IAP_ALLOW_SANDBOX = 'true';
    const withSandbox = new ApplePaymentsAdapter();
    lib.verifiers.length = 0;
    await withSandbox.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } });
    expect(lib.verifiers.map((v) => v.env)).toEqual(['Production', 'Sandbox']);
  });
});

describe('verifyPurchase', () => {
  it('activates from a verified transaction + live status, keyed on originalTransactionId', async () => {
    const events = await adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'tx-jws' } });
    expect(events).toEqual([
      {
        type: 'subscription.activated',
        customerRef: 'otx_1',
        orgIdHint: ORG,
        state: {
          tier: 'PRO',
          period: 'MONTHLY',
          status: 'active',
          identifier: 'otx_1',
          providerSubscriptionRef: 'otx_1',
          isTrialing: false,
          cancelAt: null,
          pendingTier: null,
          expiresAt: new Date('2030-01-01T00:00:00Z'),
        },
      },
    ]);
    expect(lib.getAllSubscriptionStatuses).toHaveBeenCalledWith('otx_1');
  });

  it('rejects a token for another org, another bundle, a missing jws, or a failed signature', async () => {
    await expect(adapter.verifyPurchase({ orgId: 'someone-else', payload: { jws: 'x' } })).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
    lib.decodeTransaction.mockImplementation(async () => tx({ bundleId: 'other.app' }));
    await expect(adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } })).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
    await expect(adapter.verifyPurchase({ orgId: ORG, payload: {} })).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
    lib.decodeTransaction.mockRejectedValue(new Error('bad sig'));
    await expect(adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } })).rejects.toThrow(/verification failed/);
  });

  it('falls through to the sandbox verifier when production rejects', async () => {
    process.env.APPLE_IAP_ALLOW_SANDBOX = 'true';
    adapter = new ApplePaymentsAdapter();
    lib.decodeTransaction.mockImplementation(async (_jws: string, env: string) => {
      if (env === 'Production') throw new Error('not prod');
      return tx({ environment: 'Sandbox' });
    });
    const events = await adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } });
    expect(events[0].type).toBe('subscription.activated');
    expect(lib.clients.has('Sandbox')).toBe(true);
  });

  it('maps billing retry/grace to past_due, expired/revoked to canceled, and a scheduled downgrade to pendingTier', async () => {
    lib.getAllSubscriptionStatuses.mockResolvedValue(statuses(4));
    expect((await adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } }))[0]).toMatchObject({ state: { status: 'past_due' } });
    lib.getAllSubscriptionStatuses.mockResolvedValue(statuses(2));
    expect(await adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } })).toEqual([{ type: 'subscription.canceled', customerRef: 'otx_1', orgIdHint: ORG }]);
    lib.getAllSubscriptionStatuses.mockResolvedValue(statuses(1));
    lib.decodeRenewal.mockResolvedValue({ autoRenewStatus: 1, autoRenewProductId: 'postmill.starter.monthly' });
    expect((await adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } }))[0]).toMatchObject({ state: { pendingTier: 'STARTER' } });
    lib.decodeRenewal.mockResolvedValue({ autoRenewStatus: 0 });
    expect((await adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } }))[0]).toMatchObject({ state: { cancelAt: new Date('2030-01-01T00:00:00Z') } });
  });

  it('fails closed when the status API has no item for the transaction, and on an unknown status code', async () => {
    lib.getAllSubscriptionStatuses.mockResolvedValue({ data: [] });
    await expect(adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } })).rejects.toThrow(/no subscription/);
    lib.getAllSubscriptionStatuses.mockResolvedValue(statuses(99));
    expect((await adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } }))[0]).toMatchObject({ state: { status: 'incomplete' } });
  });

  it('accepts sandbox purchases only for allow-listed orgs when a list is set', async () => {
    process.env.APPLE_IAP_ALLOW_SANDBOX = 'true';
    process.env.APPLE_IAP_SANDBOX_ORG_IDS = 'some-other-org';
    adapter = new ApplePaymentsAdapter();
    lib.decodeTransaction.mockImplementation(async () => tx({ environment: 'Sandbox' }));
    await expect(adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } })).rejects.toThrow(/sandbox/i);
    process.env.APPLE_IAP_SANDBOX_ORG_IDS = `x, ${ORG}`;
    expect((await adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } }))[0].type).toBe('subscription.activated');
    delete process.env.APPLE_IAP_SANDBOX_ORG_IDS;
    // Without the flag a sandbox transaction is never accepted.
    delete process.env.APPLE_IAP_ALLOW_SANDBOX;
    adapter = new ApplePaymentsAdapter();
    await expect(adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } })).rejects.toThrow(/sandbox/i);
  });

  it('ignores products outside the configured prefix', async () => {
    process.env.PAYMENTS_APPLE_PRODUCT_PREFIX = 'acme';
    adapter = new ApplePaymentsAdapter();
    expect(await adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } })).toEqual([]);
  });
});

describe('receiveWebhook (App Store Server Notifications V2)', () => {
  const deliver = (notification: any) => {
    lib.decodeNotification.mockResolvedValue(notification);
    return adapter.receiveWebhook({ rawBody: Buffer.from(JSON.stringify({ signedPayload: 'n-jws' })), headers: {}, query: {} });
  };
  const data = (status = 1) => ({ status, signedTransactionInfo: 'tx-jws', signedRenewalInfo: 'ri-jws' });

  it('rejects a malformed body, a missing signedPayload, or a failed signature', async () => {
    await expect(adapter.receiveWebhook({ rawBody: Buffer.from('nope'), headers: {}, query: {} })).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
    await expect(adapter.receiveWebhook({ rawBody: Buffer.from('{}'), headers: {}, query: {} })).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
    lib.decodeNotification.mockRejectedValue(new Error('bad'));
    await expect(adapter.receiveWebhook({ rawBody: Buffer.from('{"signedPayload":"x"}'), headers: {}, query: {} })).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
  });

  it('SUBSCRIBED activates, DID_RENEW pays + updates, DID_FAIL_TO_RENEW is past_due, EXPIRED cancels, TEST is ignored', async () => {
    const subscribed = await deliver({ notificationType: 'SUBSCRIBED', subtype: 'INITIAL_BUY', notificationUUID: 'n1', data: data() });
    expect(subscribed).toMatchObject({ eventId: 'n1', eventType: 'SUBSCRIBED.INITIAL_BUY', events: [{ type: 'subscription.activated', customerRef: 'otx_1', orgIdHint: ORG }] });

    const renewed = await deliver({ notificationType: 'DID_RENEW', notificationUUID: 'n2', data: data() });
    expect(renewed.events).toEqual([
      { type: 'payment.succeeded', customerRef: 'otx_1', amountCents: 2999, currency: 'usd', isAddon: false, providerSubscriptionRef: 'otx_1', subscriptionStatus: 'active' },
      expect.objectContaining({ type: 'subscription.updated' }),
    ]);

    // Cancel/past-due events carry no org hint: they resolve by ref only.
    expect((await deliver({ notificationType: 'DID_FAIL_TO_RENEW', subtype: 'GRACE_PERIOD', notificationUUID: 'n3', data: data(4) })).events).toEqual([{ type: 'subscription.past_due', customerRef: 'otx_1', providerSubscriptionRef: 'otx_1' }]);
    expect((await deliver({ notificationType: 'EXPIRED', subtype: 'VOLUNTARY', notificationUUID: 'n4', data: data(2) })).events).toEqual([{ type: 'subscription.canceled', customerRef: 'otx_1' }]);
    // A refund that ends the entitlement tears down; a refunded renewal on a still-active sub only updates.
    expect((await deliver({ notificationType: 'REFUND', notificationUUID: 'n5', data: data(5) })).events[0].type).toBe('subscription.canceled');
    expect((await deliver({ notificationType: 'REFUND', notificationUUID: 'n5b', data: data(1) })).events[0].type).toBe('subscription.updated');
    expect(await deliver({ notificationType: 'TEST', notificationUUID: 'n6' })).toEqual({ eventId: 'n6', eventType: 'TEST', events: [] });
  });

  it('ignores sandbox notifications for orgs outside the sandbox allowlist', async () => {
    process.env.APPLE_IAP_ALLOW_SANDBOX = 'true';
    process.env.APPLE_IAP_SANDBOX_ORG_IDS = 'someone-else';
    adapter = new ApplePaymentsAdapter();
    const sandbox = { notificationType: 'SUBSCRIBED', notificationUUID: 'n-sb', data: { ...data(), environment: 'Sandbox' } };
    expect((await deliver(sandbox)).events).toEqual([]);
    process.env.APPLE_IAP_SANDBOX_ORG_IDS = ORG;
    expect((await deliver(sandbox)).events[0].type).toBe('subscription.activated');
    delete process.env.APPLE_IAP_SANDBOX_ORG_IDS;
  });

  it('DID_CHANGE_RENEWAL_STATUS with auto-renew off schedules the end at expiresDate; a DOWNGRADE pref carries pendingTier', async () => {
    lib.decodeRenewal.mockResolvedValue({ autoRenewStatus: 0 });
    const off = await deliver({ notificationType: 'DID_CHANGE_RENEWAL_STATUS', subtype: 'AUTO_RENEW_DISABLED', notificationUUID: 'n7', data: data() });
    expect(off.events[0]).toMatchObject({ type: 'subscription.updated', state: { cancelAt: new Date('2030-01-01T00:00:00Z') } });
    lib.decodeRenewal.mockResolvedValue({ autoRenewStatus: 1, autoRenewProductId: 'postmill.starter.monthly' });
    const down = await deliver({ notificationType: 'DID_CHANGE_RENEWAL_PREF', subtype: 'DOWNGRADE', notificationUUID: 'n8', data: data() });
    expect(down.events[0]).toMatchObject({ type: 'subscription.updated', state: { tier: 'PRO', pendingTier: 'STARTER' } });
  });
});

describe('verification status handling', () => {
  const vex = (status: number) => Object.assign(new Error(`status ${status}`), { status });
  const perEnv = (byEnv: Record<string, number>) =>
    lib.decodeNotification.mockImplementation(async (_jws: string, env: string) => {
      throw vex(byEnv[env]);
    });
  const deliver = () => adapter.receiveWebhook({ rawBody: Buffer.from(JSON.stringify({ signedPayload: 'n-jws' })), headers: {}, query: {} });

  beforeEach(() => {
    process.env.APPLE_IAP_ALLOW_SANDBOX = 'true';
    adapter = new ApplePaymentsAdapter();
  });

  it('a foreign-app / other-environment notification is acknowledged without a ledger row', async () => {
    perEnv({ Production: 3, Sandbox: 3 });
    expect(await deliver()).toEqual({ eventId: expect.stringMatching(/^apple:foreign:[0-9a-f]{64}$/), eventType: 'apple.foreign.app', events: [], skipRecord: true });
    perEnv({ Production: 4, Sandbox: 4 });
    expect((await deliver()).eventType).toBe('apple.foreign.environment');
  });

  it('a transient failure on the matching environment is a plain (retryable) error, even when the other says "wrong environment"', async () => {
    perEnv({ Production: 4, Sandbox: 2 });
    await expect(deliver()).rejects.toSatisfy((e: Error) => !(e instanceof PaymentsWebhookVerificationError) && /temporarily unavailable/.test(e.message));
  });

  it('a definitive signature failure anywhere is a verification failure — even beside a retryable one', async () => {
    perEnv({ Production: 1, Sandbox: 4 });
    await expect(deliver()).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
    perEnv({ Production: 2, Sandbox: 1 });
    await expect(deliver()).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
    lib.decodeNotification.mockRejectedValue(new Error('no status at all'));
    await expect(deliver()).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
  });

  it('a transient failure on the receipt path is a plain error (the app retries), not a rejection', async () => {
    lib.decodeTransaction.mockImplementation(async () => {
      throw vex(2);
    });
    await expect(adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } })).rejects.toSatisfy(
      (e: Error) => !(e instanceof PaymentsWebhookVerificationError) && /temporarily unavailable/.test(e.message),
    );
  });

  it('a foreign receipt handed over by the app is rejected (strict path)', async () => {
    lib.decodeTransaction.mockImplementation(async () => {
      throw vex(3);
    });
    await expect(adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } })).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
  });

  it('reports intro-offer trials only when they are free', async () => {
    for (const [fields, expected] of [
      [{ offerType: 1, offerDiscountType: 'FREE_TRIAL' }, true],
      [{ offerType: 1 }, true],
      [{ offerType: 1, offerDiscountType: 'PAY_AS_YOU_GO' }, false],
      [{}, false],
    ] as const) {
      lib.decodeTransaction.mockImplementation(async () => tx(fields));
      expect((await adapter.verifyPurchase({ orgId: ORG, payload: { jws: 'x' } }))[0]).toMatchObject({ state: { isTrialing: expected } });
    }
  });

  it('falls back to a deterministic event id when the notification has no UUID', async () => {
    lib.decodeNotification.mockResolvedValue({ notificationType: 'TEST' });
    const a = await deliver();
    const b = await deliver();
    expect(a.eventId).toMatch(/^apple:[0-9a-f]{64}$/);
    expect(a.eventId).toBe(b.eventId);
  });
});

describe('orchestrator hooks', () => {
  it('fetchSubscriptionState reads the live status and manageUrl is the store page', async () => {
    lib.getAllSubscriptionStatuses.mockResolvedValue(statuses(3));
    expect((await adapter.fetchSubscriptionState({ customerRef: 'otx_1' }))?.status).toBe('past_due');
    lib.getAllSubscriptionStatuses.mockRejectedValue(new Error('down'));
    expect(await adapter.fetchSubscriptionState({ customerRef: 'otx_1' })).toBeNull();
    expect(await adapter.manageUrl()).toBe('https://apps.apple.com/account/subscriptions');
  });
});
