import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStripe = vi.hoisted(() => ({
  webhooks: { constructEvent: vi.fn() },
  subscriptions: {
    retrieve: vi.fn(),
    list: vi.fn().mockResolvedValue({ data: [] }),
    update: vi.fn().mockResolvedValue({}),
    cancel: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  },
  customers: { create: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  products: { list: vi.fn().mockResolvedValue({ data: [] }), create: vi.fn() },
  prices: { list: vi.fn().mockResolvedValue({ data: [] }), create: vi.fn() },
  checkout: { sessions: { create: vi.fn() } },
  promotionCodes: { list: vi.fn().mockResolvedValue({ data: [] }) },
  charges: { list: vi.fn().mockResolvedValue({ data: [] }) },
  invoices: { retrieve: vi.fn(), createPreview: vi.fn() },
  refunds: { create: vi.fn() },
  paymentMethods: { list: vi.fn(), detach: vi.fn().mockResolvedValue({}) },
  paymentIntents: { create: vi.fn(), cancel: vi.fn().mockResolvedValue({}) },
  billingPortal: { sessions: { create: vi.fn().mockResolvedValue({ url: 'https://portal' }) } },
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = mockStripe.webhooks;
    subscriptions = mockStripe.subscriptions;
    customers = mockStripe.customers;
    products = mockStripe.products;
    prices = mockStripe.prices;
    checkout = mockStripe.checkout;
    promotionCodes = mockStripe.promotionCodes;
    charges = mockStripe.charges;
    invoices = mockStripe.invoices;
    refunds = mockStripe.refunds;
    paymentMethods = mockStripe.paymentMethods;
    paymentIntents = mockStripe.paymentIntents;
    billingPortal = mockStripe.billingPortal;
  },
}));

import { StripePaymentsAdapter } from '../payments.adapter';
import { PaymentsWebhookVerificationError } from '@postmill-ai/provider-kernel';

const PLAN = { tier: 'PRO' as const, monthlyCents: 2900, yearlyCents: 29000, currency: 'usd' };
const webhookInput = (event: any) => {
  mockStripe.webhooks.constructEvent.mockReturnValue(event);
  return { rawBody: Buffer.from('{}'), headers: { 'stripe-signature': 'sig' }, query: {} };
};
const subEvent = (type: string, status = 'active', metadata: Record<string, string> = {}) => ({
  id: 'evt_1',
  type,
  data: {
    object: {
      id: 'sub_1',
      customer: 'cus_1',
      status,
      cancel_at: null,
      metadata: { service: 'postmill', billing: 'TEAM', period: 'MONTHLY', uniqueId: 'u1', ...metadata },
    },
  },
});

let adapter: StripePaymentsAdapter;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  process.env.STRIPE_SIGNING_KEY = 'whsec';
  delete process.env.STRIPE_DISCOUNT_ID;
  adapter = new StripePaymentsAdapter();
});

describe('config', () => {
  it('is enabled by the publishable key alone and exposes only public config', () => {
    expect(adapter.isConfigured()).toBe(true);
    expect(adapter.publicConfig()).toMatchObject({ providerId: 'stripe', checkoutMode: 'embedded', publicKey: 'pk_test' });
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    expect(adapter.isConfigured()).toBe(false);
  });
});

describe('receiveWebhook', () => {
  it('rejects a bad signature with PaymentsWebhookVerificationError', async () => {
    mockStripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('bad sig');
    });
    await expect(
      adapter.receiveWebhook({ rawBody: Buffer.from(''), headers: {}, query: {} }),
    ).rejects.toBeInstanceOf(PaymentsWebhookVerificationError);
  });

  it('ignores foreign-service events without ledgering them', async () => {
    const r = await adapter.receiveWebhook(webhookInput(subEvent('customer.subscription.created', 'active', { service: 'other' })));
    expect(r).toEqual({ eventId: 'evt_1', eventType: 'customer.subscription.created', events: [], skipRecord: true });
  });

  it('maps created → activated with the metadata-derived state and a card-check request', async () => {
    const r = await adapter.receiveWebhook(webhookInput(subEvent('customer.subscription.created', 'trialing')));
    expect(r.events).toEqual([
      {
        type: 'subscription.activated',
        customerRef: 'cus_1',
        requiresCardCheck: true,
        state: {
          tier: 'TEAM',
          period: 'MONTHLY',
          status: 'trialing',
          identifier: 'u1',
          providerSubscriptionRef: 'sub_1',
          isTrialing: true,
          cancelAt: null,
          pendingTier: null,
        },
      },
    ]);
  });

  it('maps updated/past_due → past_due, deleted → canceled, addon → addons.changed', async () => {
    expect((await adapter.receiveWebhook(webhookInput(subEvent('customer.subscription.updated', 'past_due')))).events[0]).toEqual({
      type: 'subscription.past_due',
      customerRef: 'cus_1',
      providerSubscriptionRef: 'sub_1',
    });
    expect((await adapter.receiveWebhook(webhookInput(subEvent('customer.subscription.deleted')))).events[0]).toEqual({
      type: 'subscription.canceled',
      customerRef: 'cus_1',
    });
    expect((await adapter.receiveWebhook(webhookInput(subEvent('customer.subscription.updated', 'active', { addon: 'storage' })))).events[0]).toEqual({
      type: 'addons.changed',
      customerRef: 'cus_1',
    });
  });

  it('maps invoice.payment_succeeded via the live subscription and invoice.payment_failed', async () => {
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      metadata: { userId: 'user-1', ud: 'track-1' },
    });
    const paid = await adapter.receiveWebhook(
      webhookInput({
        id: 'evt_inv',
        type: 'invoice.payment_succeeded',
        data: { object: { amount_paid: 2900, currency: 'usd', customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_1' } } } },
      }),
    );
    expect(paid.events[0]).toEqual({
      type: 'payment.succeeded',
      customerRef: 'cus_1',
      amountCents: 2900,
      currency: 'usd',
      isAddon: false,
      providerSubscriptionRef: 'sub_1',
      subscriptionStatus: 'active',
      userIdHint: 'user-1',
      trackingRef: 'track-1',
    });

    const failed = await adapter.receiveWebhook(
      webhookInput({
        id: 'evt_fail',
        type: 'invoice.payment_failed',
        data: { object: { customer: 'cus_1', parent: { subscription_details: { subscription: { id: 'sub_1' } } } } },
      }),
    );
    expect(failed.events[0]).toEqual({ type: 'payment.failed', customerRef: 'cus_1', providerSubscriptionRef: 'sub_1' });
  });

  it('records but does not act on one-off invoices and unknown event types', async () => {
    const r = await adapter.receiveWebhook(
      webhookInput({ id: 'evt_x', type: 'invoice.payment_succeeded', data: { object: { customer: 'cus_1', parent: {} } } }),
    );
    expect(r.events).toEqual([]);
    expect(r.skipRecord).toBeUndefined();
  });
});

describe('catalog + checkout', () => {
  it('creates the product and price on demand and returns an embedded client secret', async () => {
    mockStripe.products.create.mockResolvedValue({ id: 'prod_1' });
    mockStripe.prices.create.mockResolvedValue({ id: 'price_1' });
    mockStripe.checkout.sessions.create.mockResolvedValue({ client_secret: 'cs_1' });
    mockStripe.promotionCodes.list.mockResolvedValue({
      data: [{ code: 'WELCOME', metadata: { autoapply: 'true' }, promotion: { coupon: { metadata: {} } } }],
    });

    const r = await adapter.createCheckout({
      customerRef: 'cus_1',
      orgId: 'org-1',
      userId: 'user-1',
      email: 'a@b.c',
      plan: PLAN,
      period: 'MONTHLY',
      allowTrial: true,
      identifier: 'uid-1',
      trackingRef: 'track-1',
      metadata: { utm: 'x', dub: 'click-1' },
      returnUrls: { success: 'https://app/posts?check=uid-1', cancel: 'https://app/billing?cancel=true' },
      mode: 'embedded',
    });

    expect(r).toEqual({ kind: 'client_secret', clientSecret: 'cs_1', autoApplyCoupon: 'WELCOME' });
    expect(mockStripe.products.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'PRO' }));
    expect(mockStripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({ unit_amount: 2900, recurring: { interval: 'month' }, nickname: 'PRO MONTHLY' }),
    );
    expect(mockStripe.customers.update).toHaveBeenCalledWith('cus_1', {
      email: 'a@b.c',
      metadata: { dubCustomerExternalId: 'user-1', dubClickId: 'click-1' },
    });
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ui_mode: 'custom',
        mode: 'subscription',
        return_url: 'https://app/posts?check=uid-1',
        allow_promotion_codes: true,
        subscription_data: {
          trial_period_days: 30,
          metadata: expect.objectContaining({
            service: 'postmill',
            billing: 'PRO',
            period: 'MONTHLY',
            utm: 'x',
            dub: 'click-1',
            userId: 'user-1',
            uniqueId: 'uid-1',
            ud: 'track-1',
          }),
        },
      }),
    );
  });

  it('reuses an existing price and returns a hosted redirect', async () => {
    mockStripe.products.list.mockResolvedValue({ data: [{ id: 'prod_1', name: 'pro' }] });
    mockStripe.prices.list.mockResolvedValue({ data: [{ id: 'price_y', unit_amount: 29000, recurring: { interval: 'year' } }] });
    mockStripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout' });

    const r = await adapter.createCheckout({
      customerRef: 'cus_1',
      orgId: 'org-1',
      userId: 'user-1',
      email: 'a@b.c',
      plan: PLAN,
      period: 'YEARLY',
      allowTrial: false,
      identifier: 'uid-1',
      metadata: {},
      returnUrls: { success: 's', cancel: 'c' },
      mode: 'hosted',
    });
    expect(r).toEqual({ kind: 'redirect', url: 'https://checkout' });
    expect(mockStripe.prices.create).not.toHaveBeenCalled();
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ success_url: 's', cancel_url: 'c', allow_promotion_codes: false, line_items: [{ price: 'price_y', quantity: 1 }] }),
    );
  });

  it('ensureCustomer returns the existing ref or creates one', async () => {
    expect(await adapter.ensureCustomer({ orgId: 'o', orgName: 'Org', email: 'x', existingRef: 'cus_9' })).toBe('cus_9');
    mockStripe.customers.create.mockResolvedValue({ id: 'cus_new' });
    expect(await adapter.ensureCustomer({ orgId: 'o', orgName: 'Org', email: 'noat', existingRef: null })).toBe('cus_new');
    expect(mockStripe.customers.create).toHaveBeenCalledWith({ email: 'noat@postmill.ai', name: 'Org' });
  });
});

describe('plan changes', () => {
  it('upgrade swaps the price with always_invoice and falls back to the portal on failure', async () => {
    mockStripe.products.list.mockResolvedValue({ data: [{ id: 'prod_1', name: 'PRO' }] });
    mockStripe.prices.list.mockResolvedValue({ data: [{ id: 'price_m', unit_amount: 2900, recurring: { interval: 'month' } }] });
    mockStripe.subscriptions.list.mockResolvedValue({ data: [{ id: 'sub_1', status: 'active', items: { data: [{ id: 'si_1' }] }, metadata: {} }] });

    const req = { customerRef: 'cus_1', currentTier: 'STARTER' as const, plan: PLAN, period: 'MONTHLY' as const, direction: 'upgrade' as const, identifier: 'id-1', userId: 'u', metadata: {} };
    expect(await adapter.changePlan(req)).toEqual({ kind: 'applied' });
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_1', expect.objectContaining({ proration_behavior: 'always_invoice', items: [{ id: 'si_1', price: 'price_m', quantity: 1 }] }));

    mockStripe.subscriptions.update.mockRejectedValueOnce(new Error('nope'));
    expect(await adapter.changePlan(req)).toEqual({ kind: 'portal', url: 'https://portal' });
  });

  it('downgrade keeps billing at the current tier and tags pendingTier with no proration', async () => {
    mockStripe.products.list.mockResolvedValue({ data: [{ id: 'prod_1', name: 'PRO' }] });
    mockStripe.prices.list.mockResolvedValue({ data: [{ id: 'price_y', unit_amount: 29000, recurring: { interval: 'year' } }] });
    mockStripe.subscriptions.list.mockResolvedValue({
      data: [{ id: 'sub_1', status: 'active', items: { data: [{ id: 'si_1', price: { recurring: { interval: 'year' } } }] }, metadata: { uniqueId: 'orig' } }],
    });
    const r = await adapter.changePlan({ customerRef: 'cus_1', currentTier: 'TEAM', plan: PLAN, period: 'MONTHLY', direction: 'downgrade', identifier: 'id-1', userId: 'u', metadata: {} });
    expect(r).toEqual({ kind: 'pending', tier: 'PRO' });
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_1', {
      cancel_at_period_end: false,
      proration_behavior: 'none',
      items: [{ id: 'si_1', price: 'price_y', quantity: 1 }],
      metadata: { uniqueId: 'orig', service: 'postmill', billing: 'TEAM', period: 'YEARLY', pendingTier: 'PRO' },
    });
  });

  it('commitPendingTier rewrites metadata.billing on the given subscription', async () => {
    mockStripe.subscriptions.retrieve.mockResolvedValue({ id: 'sub_1', metadata: { billing: 'TEAM', pendingTier: 'PRO' } });
    await adapter.commitPendingTier('cus_1', 'PRO', 'sub_1');
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_1', { metadata: { billing: 'PRO', pendingTier: 'PRO' } });
  });
});

describe('cancel', () => {
  const base = (extra: any = {}) => ({ id: 'sub_1', status: 'active', cancel_at_period_end: false, latest_invoice: null, items: { data: [{ id: 'si' }] }, metadata: {}, ...extra });

  it('toggle schedules a period-end cancel for base and add-ons', async () => {
    mockStripe.subscriptions.list.mockResolvedValue({ data: [base(), { id: 'sub_a', status: 'active', metadata: { addon: 'storage' } }] });
    mockStripe.subscriptions.update.mockResolvedValue({ cancel_at: 1_800_000_000 });
    const r = await adapter.setCancelAtPeriodEnd('cus_1', 'toggle');
    expect(r).toEqual({ cancelAt: new Date(1_800_000_000 * 1000), cancelAtPeriodEnd: true, canceledNow: false });
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true, metadata: { service: 'postmill' } });
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_a', { cancel_at_period_end: true });
  });

  it('toggle resumes when already scheduled', async () => {
    mockStripe.subscriptions.list.mockResolvedValue({ data: [base({ cancel_at_period_end: true })] });
    mockStripe.subscriptions.update.mockResolvedValue({ cancel_at: null });
    const r = await adapter.setCancelAtPeriodEnd('cus_1', 'toggle');
    expect(r).toEqual({ cancelAt: null, cancelAtPeriodEnd: false, canceledNow: false });
  });

  it('cancels immediately when the latest payment already failed', async () => {
    mockStripe.subscriptions.list.mockResolvedValue({ data: [base({ latest_invoice: { status: 'open' } })] });
    const r = await adapter.setCancelAtPeriodEnd('cus_1', true);
    expect(r.canceledNow).toBe(true);
    expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith('sub_1');
  });

  it('cancelNow throws without a live subscription', async () => {
    mockStripe.subscriptions.list.mockResolvedValue({ data: [{ id: 's', status: 'canceled' }] });
    await expect(adapter.cancelNow('cus_1')).rejects.toThrow('No active subscription found');
  });
});

describe('discounts, add-ons, charges', () => {
  it('applyDiscount awaits the check (the monolith did not) and applies the env coupon', async () => {
    process.env.STRIPE_DISCOUNT_ID = 'coupon_1';
    mockStripe.charges.list.mockResolvedValue({ data: [{ amount: 500 }] });
    expect(await adapter.applyDiscount('cus_1')).toBe(false);
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();

    mockStripe.charges.list.mockResolvedValue({ data: [{ amount: 2900 }] });
    mockStripe.subscriptions.list.mockResolvedValue({ data: [{ id: 'sub_1', status: 'active', discounts: [], items: { data: [{ price: { recurring: { interval: 'month' } } }] } }] });
    expect(await adapter.applyDiscount('cus_1')).toBe(true);
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_1', { discounts: [{ coupon: 'coupon_1' }] });
  });

  it('listAddonQuantities sums packs per type and upsertAddon updates or creates', async () => {
    mockStripe.subscriptions.list.mockResolvedValue({
      data: [
        { id: 'a1', status: 'active', metadata: { addon: 'storage' }, items: { data: [{ id: 'si_a1', quantity: 2 }] } },
        { id: 'a2', status: 'trialing', metadata: { addon: 'storage' }, items: { data: [{ quantity: 1 }] } },
        { id: 'b', status: 'active', metadata: {}, items: { data: [{ quantity: 1 }] } },
      ],
    });
    expect(await adapter.listAddonQuantities('cus_1')).toEqual({ storage: 3 });

    const addon = { type: 'storage', productName: 'Postmill Extra Storage', unitAmountCents: 1900, currency: 'usd' };
    await adapter.upsertAddon('cus_1', addon, 4.7);
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('a1', { cancel_at_period_end: false, items: [{ id: 'si_a1', quantity: 4 }], metadata: { service: 'postmill', addon: 'storage' } });

    mockStripe.subscriptions.list.mockResolvedValue({ data: [] });
    mockStripe.products.list.mockResolvedValue({ data: [] });
    mockStripe.products.create.mockResolvedValue({ id: 'prod_addon' });
    mockStripe.prices.list.mockResolvedValue({ data: [] });
    mockStripe.prices.create.mockResolvedValue({ id: 'price_addon' });
    await adapter.upsertAddon('cus_1', addon, 1);
    expect(mockStripe.subscriptions.create).toHaveBeenCalledWith({ customer: 'cus_1', items: [{ price: 'price_addon', quantity: 1 }], metadata: { service: 'postmill', addon: 'storage' } });
  });

  it('listCharges decorates succeeded charges with invoice PDFs', async () => {
    mockStripe.charges.list.mockResolvedValue({
      data: [
        { id: 'ch_1', status: 'succeeded', amount: 2900, currency: 'usd', created: 1_700_000_000, refunded: false, amount_refunded: 0, description: 'x', receipt_url: 'r', invoice: 'in_1' },
        { id: 'ch_2', status: 'failed' },
      ],
    });
    mockStripe.invoices.retrieve.mockResolvedValue({ invoice_pdf: 'pdf' });
    expect(await adapter.listCharges('cus_1')).toEqual([
      { id: 'ch_1', amountCents: 2900, currency: 'usd', createdAt: new Date(1_700_000_000 * 1000), refunded: false, amountRefundedCents: 0, description: 'x', receiptUrl: 'r', invoicePdfUrl: 'pdf' },
    ]);
    mockStripe.refunds.create.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('x'));
    expect(await adapter.refund('cus_1', ['ch_1', 'ch_2'])).toEqual({ refunded: ['ch_1'], failed: ['ch_2'] });
  });
});

describe('orchestrator hooks', () => {
  it('verifyPaymentMethod authorises $1 and voids it; detaches + cancels on failure', async () => {
    mockStripe.paymentMethods.list.mockResolvedValue({ data: [{ id: 'pm_old', created: 1 }, { id: 'pm_new', created: 2 }] });
    mockStripe.paymentIntents.create.mockResolvedValue({ id: 'pi_1', status: 'requires_capture' });
    expect(await adapter.verifyPaymentMethod({ customerRef: 'cus_1', providerSubscriptionRef: 'sub_1' })).toBe(true);
    expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 100, payment_method: 'pm_new', capture_method: 'manual' }));
    expect(mockStripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_1');

    mockStripe.paymentIntents.create.mockResolvedValue({ id: 'pi_2', status: 'requires_payment_method' });
    expect(await adapter.verifyPaymentMethod({ customerRef: 'cus_1', providerSubscriptionRef: 'sub_1' })).toBe(false);
    expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith('sub_1');
  });

  it('checkoutStatus distinguishes canceled from pending and unknown', async () => {
    expect(await adapter.checkoutStatus({ customerRef: null, identifier: 'u1' })).toBe('unknown');
    mockStripe.subscriptions.list.mockResolvedValue({ data: [] });
    expect(await adapter.checkoutStatus({ customerRef: 'cus_1', identifier: 'u1' })).toBe('unknown');
    mockStripe.subscriptions.list.mockResolvedValue({ data: [{ metadata: { uniqueId: 'u1' }, canceled_at: 123 }] });
    expect(await adapter.checkoutStatus({ customerRef: 'cus_1', identifier: 'u1' })).toBe('canceled');
    mockStripe.subscriptions.list.mockResolvedValue({ data: [{ metadata: { uniqueId: 'u1' }, canceled_at: null }] });
    expect(await adapter.checkoutStatus({ customerRef: 'cus_1', identifier: 'u1' })).toBe('pending');
  });

  it('fetchSubscriptionState maps the live status', async () => {
    mockStripe.subscriptions.retrieve.mockResolvedValue({ id: 'sub_1', status: 'past_due', cancel_at: null, metadata: { billing: 'PRO', period: 'MONTHLY', uniqueId: 'u' } });
    expect((await adapter.fetchSubscriptionState({ customerRef: 'cus_1', providerSubscriptionRef: 'sub_1' }))?.status).toBe('past_due');
  });
});
