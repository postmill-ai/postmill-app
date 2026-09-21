import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaypalPaymentsAdapter } from '../payments.adapter';
import { PaymentsUnsupportedOperationError, PaymentsWebhookVerificationError } from '@postmill-ai/provider-kernel';

type Handler = (init: RequestInit | undefined) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>;

/** Route table for the fetch port: `METHOD path` → handler. Records every call. */
function fakeFetch() {
  const routes = new Map<string, Handler>();
  const calls: Array<{ method: string; url: string; body: any; headers: Record<string, string> }> = [];
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    const path = url.replace(/^https:\/\/api-m(\.sandbox)?\.paypal\.com/, '');
    calls.push({ method, url, body: init?.body ? safeParse(init.body as string) : undefined, headers: (init?.headers as any) || {} });
    const handler = routes.get(`${method} ${path}`) ?? routes.get(`${method} ${path.split('?')[0]}`);
    if (!handler) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => `no route ${method} ${path}` } as any;
    }
    const r = await handler(init);
    const status = r.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body ?? ''),
    } as any;
  });
  routes.set('POST /v1/oauth2/token', () => ({ body: { access_token: 'tok', expires_in: 3600 } }));
  return { fetch, routes, calls };
}
const safeParse = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

const PLAN = { tier: 'PRO' as const, monthlyCents: 2900, yearlyCents: 29000, currency: 'usd' };
const sub = (overrides: Record<string, any> = {}) => ({
  id: 'I-ABC',
  status: 'ACTIVE',
  plan_id: 'P-1',
  custom_id: 'org-1|uid-1',
  billing_info: { next_billing_time: '2030-01-01T00:00:00Z' },
  links: [{ rel: 'approve', href: 'https://paypal.com/approve' }],
  ...overrides,
});

let f: ReturnType<typeof fakeFetch>;
let adapter: PaypalPaymentsAdapter;

beforeEach(() => {
  process.env.PAYPAL_CLIENT_ID = 'cid';
  process.env.PAYPAL_CLIENT_SECRET = 'sec';
  process.env.PAYPAL_WEBHOOK_ID = 'WH-1';
  process.env.PAYPAL_ENV = 'sandbox';
  f = fakeFetch();
  adapter = new PaypalPaymentsAdapter(f.fetch as any);
  f.routes.set('GET /v1/billing/plans/P-1', () => ({ body: { id: 'P-1', name: 'Postmill PRO MONTHLY' } }));
});

describe('config + auth', () => {
  it('is enabled by the client id alone, exposes it as the public key, uses the sandbox host', async () => {
    expect(adapter.isConfigured()).toBe(true);
    expect(adapter.publicConfig()).toMatchObject({ providerId: 'paypal', checkoutMode: 'hosted', publicKey: 'cid' });
    delete process.env.PAYPAL_CLIENT_ID;
    expect(adapter.isConfigured()).toBe(false);
  });

  it('caches the access token across calls', async () => {
    f.routes.set('GET /v1/billing/subscriptions/I-ABC', () => ({ body: sub() }));
    await adapter.checkoutStatus({ customerRef: 'I-ABC', identifier: 'x' });
    await adapter.checkoutStatus({ customerRef: 'I-ABC', identifier: 'x' });
    expect(f.calls.filter((c) => c.url.endsWith('/v1/oauth2/token'))).toHaveLength(1);
    expect(f.calls[0].url).toContain('api-m.sandbox.paypal.com');
    expect(f.calls[0].headers.Authorization).toMatch(/^Basic /);
  });
});

describe('catalog + checkout', () => {
  it('creates product and plan on demand (with a trial cycle) and returns the approval redirect', async () => {
    f.routes.set('GET /v1/catalogs/products', () => ({ body: { products: [] } }));
    f.routes.set('POST /v1/catalogs/products', () => ({ body: { id: 'PROD-1', name: 'Postmill PRO' } }));
    f.routes.set('GET /v1/billing/plans', () => ({ body: { plans: [] } }));
    f.routes.set('POST /v1/billing/plans', () => ({ body: { id: 'P-NEW', name: 'Postmill PRO MONTHLY TRIAL' } }));
    f.routes.set('POST /v1/billing/subscriptions', () => ({ body: sub({ id: 'I-NEW' }) }));

    const r = await adapter.createCheckout({
      customerRef: null,
      orgId: 'org-1',
      userId: 'u',
      email: 'a@b.c',
      plan: PLAN,
      period: 'MONTHLY',
      allowTrial: true,
      identifier: 'uid-1',
      metadata: {},
      returnUrls: { success: 'https://app/ok', cancel: 'https://app/cancel' },
      mode: 'hosted',
    });
    expect(r).toEqual({ kind: 'redirect', url: 'https://paypal.com/approve' });

    const planCall = f.calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/billing/plans'));
    expect(planCall!.body.billing_cycles).toHaveLength(2);
    expect(planCall!.body.billing_cycles[0]).toMatchObject({ tenure_type: 'TRIAL', frequency: { interval_unit: 'DAY', interval_count: 30 } });
    expect(planCall!.body.billing_cycles[1]).toMatchObject({ tenure_type: 'REGULAR', sequence: 2, pricing_scheme: { fixed_price: { value: '29.00', currency_code: 'USD' } } });
    const subCall = f.calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/billing/subscriptions'));
    expect(subCall!.body).toMatchObject({ plan_id: 'P-NEW', custom_id: 'org-1|uid-1', subscriber: { email_address: 'a@b.c' }, application_context: { user_action: 'SUBSCRIBE_NOW', return_url: 'https://app/ok', cancel_url: 'https://app/cancel' } });
    expect(subCall!.headers['PayPal-Request-Id']).toBe('sub-uid-1');
  });

  it('reuses an existing plan by name and yearly amounts', async () => {
    f.routes.set('GET /v1/catalogs/products', () => ({ body: { products: [{ id: 'PROD-1', name: 'Postmill PRO' }] } }));
    f.routes.set('GET /v1/billing/plans', () => ({ body: { plans: [{ id: 'P-Y', name: 'Postmill PRO YEARLY' }] } }));
    f.routes.set('POST /v1/billing/subscriptions', () => ({ body: sub() }));
    await adapter.createCheckout({ customerRef: null, orgId: 'org-1', userId: 'u', email: '', plan: PLAN, period: 'YEARLY', allowTrial: false, identifier: 'uid-2', metadata: {}, returnUrls: { success: 's', cancel: 'c' }, mode: 'hosted' });
    expect(f.calls.some((c) => c.method === 'POST' && c.url.endsWith('/v1/billing/plans'))).toBe(false);
    expect(f.calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/billing/subscriptions'))!.body.plan_id).toBe('P-Y');
  });

  it('ensureCustomer returns the existing ref — PayPal has no customer object', async () => {
    expect(await adapter.ensureCustomer({ existingRef: 'I-ABC' })).toBe('I-ABC');
    expect(await adapter.ensureCustomer({ existingRef: null })).toBeNull();
  });
});

describe('plan change + cancel', () => {
  it('revise with an approval link redirects; a downgrade without one stays pending', async () => {
    f.routes.set('GET /v1/catalogs/products', () => ({ body: { products: [{ id: 'PROD-1', name: 'Postmill STARTER' }] } }));
    f.routes.set('GET /v1/billing/plans', () => ({ body: { plans: [{ id: 'P-S', name: 'Postmill STARTER MONTHLY' }] } }));
    f.routes.set('POST /v1/billing/subscriptions/I-ABC/revise', () => ({ body: { links: [{ rel: 'approve', href: 'https://paypal.com/revise' }] } }));
    const req = { customerRef: 'I-ABC', currentTier: 'PRO' as const, plan: { ...PLAN, tier: 'STARTER' as const }, period: 'MONTHLY' as const, direction: 'downgrade' as const, identifier: 'i', userId: 'u', metadata: {} };
    expect(await adapter.changePlan(req)).toEqual({ kind: 'redirect', url: 'https://paypal.com/revise' });
    f.routes.set('POST /v1/billing/subscriptions/I-ABC/revise', () => ({ body: { links: [] } }));
    expect(await adapter.changePlan(req)).toEqual({ kind: 'pending', tier: 'STARTER' });
    expect(await adapter.changePlan({ ...req, direction: 'upgrade' })).toEqual({ kind: 'applied' });
  });

  it('cancel is immediate at PayPal but reports the paid-through date; resume is unsupported', async () => {
    f.routes.set('GET /v1/billing/subscriptions/I-ABC', () => ({ body: sub() }));
    f.routes.set('POST /v1/billing/subscriptions/I-ABC/cancel', () => ({ status: 204 }));
    const r = await adapter.setCancelAtPeriodEnd('I-ABC', 'toggle');
    expect(r).toEqual({ cancelAt: new Date('2030-01-01T00:00:00Z'), cancelAtPeriodEnd: false, canceledNow: false });
    expect(f.calls.some((c) => c.url.endsWith('/cancel'))).toBe(true);
    await expect(adapter.setCancelAtPeriodEnd('I-ABC', false)).rejects.toBeInstanceOf(PaymentsUnsupportedOperationError);
    f.routes.set('GET /v1/billing/subscriptions/I-ABC', () => ({ body: sub({ status: 'CANCELLED' }) }));
    await expect(adapter.setCancelAtPeriodEnd('I-ABC', 'toggle')).rejects.toBeInstanceOf(PaymentsUnsupportedOperationError);
    await expect(adapter.finishTrial('I-ABC')).rejects.toBeInstanceOf(PaymentsUnsupportedOperationError);
  });

  it('checkoutStatus + pullSubscription read the live subscription', async () => {
    f.routes.set('GET /v1/billing/subscriptions/I-ABC', () => ({ body: sub({ status: 'APPROVAL_PENDING' }) }));
    expect(await adapter.checkoutStatus({ customerRef: null, identifier: 'x', providerRef: 'I-ABC' })).toBe('pending');
    expect(await adapter.pullSubscription('I-ABC')).toEqual([]);
    f.routes.set('GET /v1/billing/subscriptions/I-ABC', () => ({ body: sub({ status: 'CANCELLED' }) }));
    expect(await adapter.checkoutStatus({ customerRef: null, identifier: 'x', providerRef: 'I-ABC' })).toBe('canceled');
    f.routes.set('GET /v1/billing/subscriptions/I-ABC', () => ({ body: sub() }));
    expect(await adapter.pullSubscription('I-ABC')).toEqual([
      {
        type: 'subscription.activated',
        customerRef: 'I-ABC',
        orgIdHint: 'org-1',
        state: { tier: 'PRO', period: 'MONTHLY', status: 'active', identifier: 'uid-1', providerSubscriptionRef: 'I-ABC', isTrialing: false, cancelAt: null, pendingTier: null },
      },
    ]);
    expect(await adapter.checkoutStatus({ customerRef: null, identifier: 'x' })).toBe('unknown');
  });
});

describe('webhooks', () => {
  const headers = { 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-id': 't', 'paypal-transmission-sig': 's', 'paypal-transmission-time': 'now' };
  const deliver = (event: any) => adapter.receiveWebhook({ rawBody: Buffer.from(JSON.stringify(event)), headers, query: {} });

  it('verifies through PayPal and rejects a FAILURE (or malformed body) with the verification error', async () => {
    f.routes.set('POST /v1/notifications/verify-webhook-signature', () => ({ body: { verification_status: 'FAILURE' } }));
    await expect(deliver({ id: 'WH-EVT', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: sub() })).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
    await expect(adapter.receiveWebhook({ rawBody: Buffer.from('not json'), headers, query: {} })).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
    const verifyCall = f.calls.find((c) => c.url.endsWith('/verify-webhook-signature'));
    expect(verifyCall!.body).toMatchObject({ webhook_id: 'WH-1', auth_algo: 'SHA256withRSA', transmission_id: 't', webhook_event: { id: 'WH-EVT' } });
  });

  it('maps subscription events with the org hint from custom_id', async () => {
    f.routes.set('POST /v1/notifications/verify-webhook-signature', () => ({ body: { verification_status: 'SUCCESS' } }));
    const activated = await deliver({ id: 'E1', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: sub() });
    expect(activated).toEqual({
      eventId: 'E1',
      eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
      events: [{ type: 'subscription.activated', customerRef: 'I-ABC', orgIdHint: 'org-1', state: expect.objectContaining({ tier: 'PRO', period: 'MONTHLY', identifier: 'uid-1' }) }],
    });
    expect((await deliver({ id: 'E2', event_type: 'BILLING.SUBSCRIPTION.SUSPENDED', resource: sub() })).events).toEqual([{ type: 'subscription.past_due', customerRef: 'I-ABC', orgIdHint: 'org-1', providerSubscriptionRef: 'I-ABC' }]);
    expect((await deliver({ id: 'E3', event_type: 'BILLING.SUBSCRIPTION.EXPIRED', resource: sub() })).events).toEqual([{ type: 'subscription.canceled', customerRef: 'I-ABC', orgIdHint: 'org-1' }]);
    expect((await deliver({ id: 'E4', event_type: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', resource: sub() })).events[0].type).toBe('payment.failed');
    expect((await deliver({ id: 'E5', event_type: 'BILLING.SUBSCRIPTION.CREATED', resource: sub() })).events).toEqual([]);
  });

  it('CANCELLED keeps access until the paid-through date, or tears down when it has passed', async () => {
    f.routes.set('POST /v1/notifications/verify-webhook-signature', () => ({ body: { verification_status: 'SUCCESS' } }));
    const future = await deliver({ id: 'E6', event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: sub({ status: 'CANCELLED' }) });
    expect(future.events[0]).toMatchObject({ type: 'subscription.updated', state: { status: 'active', cancelAt: new Date('2030-01-01T00:00:00Z') } });
    const past = await deliver({ id: 'E7', event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: sub({ status: 'CANCELLED', billing_info: { next_billing_time: '2020-01-01T00:00:00Z' } }) });
    expect(past.events).toEqual([{ type: 'subscription.canceled', customerRef: 'I-ABC', orgIdHint: 'org-1' }]);
  });

  it('PAYMENT.SALE.COMPLETED becomes payment.succeeded keyed on the billing agreement', async () => {
    f.routes.set('POST /v1/notifications/verify-webhook-signature', () => ({ body: { verification_status: 'SUCCESS' } }));
    const r = await deliver({ id: 'E8', event_type: 'PAYMENT.SALE.COMPLETED', resource: { billing_agreement_id: 'I-ABC', custom: 'org-1|uid-1', amount: { total: '29.00', currency: 'USD' } } });
    expect(r.events).toEqual([{ type: 'payment.succeeded', customerRef: 'I-ABC', orgIdHint: 'org-1', amountCents: 2900, currency: 'usd', isAddon: false, providerSubscriptionRef: 'I-ABC', subscriptionStatus: 'active' }]);
    expect((await deliver({ id: 'E9', event_type: 'PAYMENT.SALE.COMPLETED', resource: {} })).events).toEqual([]);
  });

  it('drops events whose plan is not a Postmill plan', async () => {
    f.routes.set('POST /v1/notifications/verify-webhook-signature', () => ({ body: { verification_status: 'SUCCESS' } }));
    f.routes.set('GET /v1/billing/plans/P-X', () => ({ body: { id: 'P-X', name: 'Something else' } }));
    expect((await deliver({ id: 'E10', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: sub({ plan_id: 'P-X' }) })).events).toEqual([]);
  });
});

describe('charges + refunds', () => {
  it('lists completed transactions and refunds via sale then capture', async () => {
    f.routes.set('GET /v1/billing/subscriptions/I-ABC', () => ({ body: sub({ start_time: '2026-01-01T00:00:00Z' }) }));
    f.routes.set('GET /v1/billing/subscriptions/I-ABC/transactions', () => ({
      body: { transactions: [{ id: 'T1', status: 'COMPLETED', time: '2026-02-01T00:00:00Z', amount_with_breakdown: { gross_amount: { value: '29.00', currency_code: 'USD' } } }, { id: 'T2', status: 'DECLINED', time: '2026-02-02T00:00:00Z' }] },
    }));
    expect(await adapter.listCharges('I-ABC')).toEqual([{ id: 'T1', amountCents: 2900, currency: 'usd', createdAt: new Date('2026-02-01T00:00:00Z'), refunded: false, amountRefundedCents: 0, description: null, receiptUrl: null, invoicePdfUrl: null }]);
    f.routes.set('POST /v1/payments/sale/T1/refund', () => ({ status: 404, body: {} }));
    f.routes.set('POST /v2/payments/captures/T1/refund', () => ({ body: { status: 'COMPLETED' } }));
    f.routes.set('POST /v1/payments/sale/T2/refund', () => ({ status: 404, body: {} }));
    f.routes.set('POST /v2/payments/captures/T2/refund', () => ({ status: 404, body: {} }));
    expect(await adapter.refund('I-ABC', ['T1', 'T2'])).toEqual({ refunded: ['T1'], failed: ['T2'] });
  });
});
