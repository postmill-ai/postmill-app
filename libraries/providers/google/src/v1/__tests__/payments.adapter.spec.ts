import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  acknowledge: vi.fn().mockResolvedValue({}),
  verifyIdToken: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class {} },
    androidpublisher: () => ({
      purchases: {
        subscriptionsv2: { get: api.get },
        subscriptions: { acknowledge: api.acknowledge },
      },
    }),
  },
}));
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken(opts: any) {
      return api.verifyIdToken(opts);
    }
  },
}));

import { GooglePaymentsAdapter } from '../payments.adapter';
import { PaymentsWebhookVerificationError } from '@postmill-ai/provider-kernel';

const ORG = 'org-uuid-1';
const purchase = (overrides: Record<string, any> = {}) => ({
  subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
  acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
  latestOrderId: 'GPA.1',
  externalAccountIdentifiers: { obfuscatedExternalAccountId: ORG },
  lineItems: [{ productId: 'postmill.team.yearly', expiryTime: '2030-01-01T00:00:00Z', autoRenewingPlan: { autoRenewEnabled: true } }],
  ...overrides,
});
const rtdn = (payload: any, messageId = 'm1') => ({
  rawBody: Buffer.from(JSON.stringify({ message: { data: Buffer.from(JSON.stringify(payload)).toString('base64'), messageId } })),
  headers: { authorization: 'Bearer oidc' },
  query: {},
});
const subNotification = (notificationType: number, purchaseToken = 'tok_1') => ({
  packageName: 'ai.postmill.app',
  subscriptionNotification: { notificationType, purchaseToken, subscriptionId: 'postmill.team.yearly' },
});

let adapter: GooglePaymentsAdapter;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_PLAY_PACKAGE_NAME = 'ai.postmill.app';
  process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = Buffer.from('{"client_email":"sa@x"}').toString('base64');
  process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL = 'push@x.iam.gserviceaccount.com';
  process.env.GOOGLE_PLAY_RTDN_AUDIENCE = 'https://api/payments/webhooks/google';
  delete process.env.PAYMENTS_GOOGLE_PRODUCT_PREFIX;
  adapter = new GooglePaymentsAdapter();
  api.get.mockResolvedValue({ data: purchase() });
  api.verifyIdToken.mockResolvedValue({ getPayload: () => ({ email: 'push@x.iam.gserviceaccount.com', email_verified: true }) });
});

describe('config', () => {
  it('is enabled by the package name and exposes no public key', () => {
    expect(adapter.isConfigured()).toBe(true);
    expect(adapter.publicConfig()).toEqual({ providerId: 'google', checkoutMode: 'native', capabilities: adapter.capabilities });
    delete process.env.GOOGLE_PLAY_PACKAGE_NAME;
    expect(adapter.isConfigured()).toBe(false);
  });
});

describe('verifyPurchase', () => {
  it('reads the purchase from Play, acknowledges it, and activates keyed on the token', async () => {
    const events = await adapter.verifyPurchase({ orgId: ORG, payload: { purchaseToken: 'tok_1', productId: 'postmill.team.yearly' } });
    expect(api.get).toHaveBeenCalledWith({ packageName: 'ai.postmill.app', token: 'tok_1' });
    expect(api.acknowledge).toHaveBeenCalledWith({ packageName: 'ai.postmill.app', subscriptionId: 'postmill.team.yearly', token: 'tok_1' });
    expect(events).toEqual([
      {
        type: 'subscription.activated',
        customerRef: 'tok_1',
        orgIdHint: ORG,
        state: {
          tier: 'TEAM',
          period: 'YEARLY',
          status: 'active',
          identifier: 'GPA.1',
          providerSubscriptionRef: 'tok_1',
          isTrialing: false,
          cancelAt: null,
          pendingTier: null,
          expiresAt: new Date('2030-01-01T00:00:00Z'),
        },
      },
    ]);
  });

  it('does not re-acknowledge, binds through the caller when Play carries no account id, rejects a foreign account id', async () => {
    api.get.mockResolvedValue({ data: purchase({ acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED', externalAccountIdentifiers: {} }) });
    const events = await adapter.verifyPurchase({ orgId: ORG, payload: { purchaseToken: 'tok_1' } });
    expect(api.acknowledge).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({ orgIdHint: ORG });
    api.get.mockResolvedValue({ data: purchase({ externalAccountIdentifiers: { obfuscatedExternalAccountId: 'other' } }) });
    await expect(adapter.verifyPurchase({ orgId: ORG, payload: { purchaseToken: 'tok_1' } })).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
    await expect(adapter.verifyPurchase({ orgId: ORG, payload: {} })).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
    api.get.mockRejectedValue(new Error('invalid token'));
    await expect(adapter.verifyPurchase({ orgId: ORG, payload: { purchaseToken: 'bad' } })).rejects.toThrow(/rejected the purchase token/);
  });

  it('maps states: canceled-but-entitled keeps access until expiry, grace/hold are past_due, expired tears down', async () => {
    api.get.mockResolvedValue({ data: purchase({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }) });
    expect((await adapter.verifyPurchase({ orgId: ORG, payload: { purchaseToken: 'tok_1' } }))[0]).toMatchObject({ state: { status: 'active', cancelAt: new Date('2030-01-01T00:00:00Z') } });
    api.get.mockResolvedValue({ data: purchase({ subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD' }) });
    expect((await adapter.verifyPurchase({ orgId: ORG, payload: { purchaseToken: 'tok_1' } }))[0]).toMatchObject({ state: { status: 'past_due' } });
    api.get.mockResolvedValue({ data: purchase({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }) });
    expect(await adapter.verifyPurchase({ orgId: ORG, payload: { purchaseToken: 'tok_1' } })).toEqual([{ type: 'subscription.canceled', customerRef: 'tok_1', orgIdHint: ORG }]);
  });

  it('accepts product.basePlan ids and ignores foreign products', async () => {
    api.get.mockResolvedValue({ data: purchase({ lineItems: [{ productId: 'postmill.pro', offerDetails: { basePlanId: 'monthly' }, expiryTime: '2030-01-01T00:00:00Z' }] }) });
    expect((await adapter.verifyPurchase({ orgId: ORG, payload: { purchaseToken: 'tok_1' } }))[0]).toMatchObject({ state: { tier: 'PRO', period: 'MONTHLY' } });
    api.get.mockResolvedValue({ data: purchase({ lineItems: [{ productId: 'other.thing' }] }) });
    expect(await adapter.verifyPurchase({ orgId: ORG, payload: { purchaseToken: 'tok_1' } })).toEqual([]);
  });
});

describe('receiveWebhook (Pub/Sub push)', () => {
  it('verifies the OIDC token against audience + service account and fails closed without config', async () => {
    await adapter.receiveWebhook(rtdn(subNotification(4)));
    expect(api.verifyIdToken).toHaveBeenCalledWith({ idToken: 'oidc', audience: 'https://api/payments/webhooks/google' });
    api.verifyIdToken.mockResolvedValue({ getPayload: () => ({ email: 'someone@else', email_verified: true }) });
    await expect(adapter.receiveWebhook(rtdn(subNotification(4)))).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
    api.verifyIdToken.mockRejectedValue(new Error('expired'));
    await expect(adapter.receiveWebhook(rtdn(subNotification(4)))).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
    await expect(adapter.receiveWebhook({ ...rtdn(subNotification(4)), headers: {} })).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
    delete process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;
    await expect(adapter.receiveWebhook(rtdn(subNotification(4)))).rejects.toThrow(/refusing unauthenticated/);
  });

  it('PURCHASED activates, RENEWED pays + updates, CANCELED updates with cancelAt, ON_HOLD is past_due, EXPIRED cancels', async () => {
    expect(await adapter.receiveWebhook(rtdn(subNotification(4), 'm4'))).toMatchObject({ eventId: 'm4', eventType: 'rtdn.subscription.4', events: [{ type: 'subscription.activated', customerRef: 'tok_1', orgIdHint: ORG }] });

    const renewed = await adapter.receiveWebhook(rtdn(subNotification(2), 'm2'));
    expect(renewed.events).toEqual([
      { type: 'payment.succeeded', customerRef: 'tok_1', orgIdHint: ORG, currency: 'usd', isAddon: false, providerSubscriptionRef: 'tok_1', subscriptionStatus: 'active' },
      expect.objectContaining({ type: 'subscription.updated' }),
    ]);

    api.get.mockResolvedValue({ data: purchase({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED', lineItems: [{ productId: 'postmill.team.yearly', expiryTime: '2030-01-01T00:00:00Z', autoRenewingPlan: { autoRenewEnabled: false } }] }) });
    expect((await adapter.receiveWebhook(rtdn(subNotification(3), 'm3'))).events[0]).toMatchObject({ type: 'subscription.updated', state: { status: 'active', cancelAt: new Date('2030-01-01T00:00:00Z') } });

    api.get.mockResolvedValue({ data: purchase({ subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD' }) });
    expect((await adapter.receiveWebhook(rtdn(subNotification(5), 'm5'))).events).toEqual([{ type: 'subscription.past_due', customerRef: 'tok_1', orgIdHint: ORG, providerSubscriptionRef: 'tok_1' }]);

    api.get.mockRejectedValue(new Error('gone'));
    expect((await adapter.receiveWebhook(rtdn(subNotification(13), 'm13'))).events).toEqual([{ type: 'subscription.canceled', customerRef: 'tok_1' }]);
  });

  it('carries the rotated token as customerRef with the org hint (linkedPurchaseToken)', async () => {
    api.get.mockResolvedValue({ data: purchase({ linkedPurchaseToken: 'tok_old' }) });
    const r = await adapter.receiveWebhook(rtdn(subNotification(4, 'tok_new')));
    expect(r.events[0]).toMatchObject({ customerRef: 'tok_new', orgIdHint: ORG, state: { providerSubscriptionRef: 'tok_new' } });
  });

  it('records test notifications, skips foreign packages, cancels voided purchases, ignores unknown types', async () => {
    expect(await adapter.receiveWebhook(rtdn({ packageName: 'ai.postmill.app', testNotification: { version: '1.0' } }, 't'))).toEqual({ eventId: 't', eventType: 'rtdn.test', events: [] });
    expect(await adapter.receiveWebhook(rtdn({ packageName: 'other.app', subscriptionNotification: { notificationType: 4, purchaseToken: 'x' } }, 'f'))).toEqual({ eventId: 'f', eventType: 'rtdn.foreign-package', events: [], skipRecord: true });
    expect((await adapter.receiveWebhook(rtdn({ packageName: 'ai.postmill.app', voidedPurchaseNotification: { purchaseToken: 'tok_v' } }, 'v'))).events).toEqual([{ type: 'subscription.canceled', customerRef: 'tok_v' }]);
    expect((await adapter.receiveWebhook(rtdn(subNotification(99), 'u'))).events).toEqual([]);
    await expect(adapter.receiveWebhook({ rawBody: Buffer.from('{}'), headers: { authorization: 'Bearer oidc' }, query: {} })).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
  });
});

describe('hooks', () => {
  it('fetchSubscriptionState reads live state; manageUrl points at the Play subscriptions page', async () => {
    api.get.mockResolvedValue({ data: purchase({ subscriptionState: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' }) });
    expect((await adapter.fetchSubscriptionState({ customerRef: 'tok_1' }))?.status).toBe('past_due');
    api.get.mockRejectedValue(new Error('x'));
    expect(await adapter.fetchSubscriptionState({ customerRef: 'tok_1' })).toBeNull();
    expect(await adapter.manageUrl()).toBe('https://play.google.com/store/account/subscriptions?package=ai.postmill.app');
  });
});
