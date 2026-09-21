import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { pricing, ADDONS } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/pricing';
import { PaymentsUnsupportedOperationError, PaymentsWebhookVerificationError } from '@postmill-ai/provider-kernel';

// ---------------------------------------------------------------------------
// PaymentsService — the DB-transition half of the former StripeService and the
// webhook pipeline of the former StripeController, now driven by normalized
// events from any provider adapter. Adapters are faked; nothing touches a vendor.
// ---------------------------------------------------------------------------

const ORG = { id: 'org-1', name: 'Org', paymentId: 'cus_1', paymentProvider: 'stripe', allowTrial: false };

function fakeCapability(overrides: Record<string, any> = {}) {
  return {
    name: 'stripe',
    capabilities: {
      checkoutMode: 'embedded',
      portal: true,
      proration: true,
      addons: true,
      refunds: true,
      promoCodes: true,
      trials: true,
      cardCheck: true,
      chargesHistory: true,
      periodEndCancel: true,
      planChange: true,
    },
    requiredEnvKeys: ['STRIPE_PUBLISHABLE_KEY'],
    isConfigured: () => true,
    publicConfig: () => ({}),
    receiveWebhook: vi.fn(),
    ensureCustomer: vi.fn().mockResolvedValue('cus_new'),
    createCheckout: vi.fn(),
    changePlan: vi.fn(),
    commitPendingTier: vi.fn().mockResolvedValue(undefined),
    setCancelAtPeriodEnd: vi.fn(),
    cancelNow: vi.fn().mockResolvedValue(undefined),
    manageUrl: vi.fn().mockResolvedValue('https://portal'),
    listAddonQuantities: vi.fn().mockResolvedValue({}),
    upsertAddon: vi.fn().mockResolvedValue(undefined),
    verifyPaymentMethod: vi.fn().mockResolvedValue(true),
    fetchSubscriptionState: vi.fn(),
    checkoutStatus: vi.fn().mockResolvedValue('pending'),
    ...overrides,
  };
}

function build(capability = fakeCapability(), orgOverrides: Record<string, any> = {}) {
  const org = { ...ORG, ...orgOverrides };
  const subscriptionService = {
    getSubscription: vi.fn().mockResolvedValue(null),
    getSubscriptionByOrganizationId: vi.fn().mockResolvedValue(null),
    createOrUpdateSubscription: vi.fn().mockResolvedValue({ ok: true }),
    deleteSubscription: vi.fn().mockResolvedValue(undefined),
    updateCustomerId: vi.fn().mockResolvedValue(undefined),
    checkSubscription: vi.fn().mockResolvedValue(false),
    setPendingTier: vi.fn().mockResolvedValue(undefined),
    clearPendingTier: vi.fn().mockResolvedValue(undefined),
    modifySubscriptionByOrg: vi.fn().mockResolvedValue(undefined),
    updateAddonQuantities: vi.fn().mockResolvedValue(undefined),
    setCancelAt: vi.fn().mockResolvedValue(undefined),
    findExpiredCancellations: vi.fn().mockResolvedValue([]),
    findStaleStripeCancellations: vi.fn().mockResolvedValue({ count: 0, sample: [] }),
    getCode: vi.fn().mockResolvedValue(null),
  };
  const organizationService = {
    getOrgByCustomerId: vi.fn().mockImplementation(async (ref: string, provider?: string) =>
      ref === org.paymentId && (!provider || provider === org.paymentProvider) ? org : null,
    ),
    getOrgById: vi.fn().mockImplementation(async (id: string) => (id === org.id ? org : null)),
    getTeam: vi.fn().mockResolvedValue({ users: [{ user: { email: 'owner@x.y' } }] }),
  };
  const userService = { getUserById: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@x.y', ip: '1.1.1.1', agent: 'ua' }) };
  const trackService = { track: vi.fn() };
  const recorded = new Set<string>();
  const paymentEventRepository = {
    exists: vi.fn().mockImplementation(async (id: string) => recorded.has(id)),
    record: vi.fn().mockImplementation(async (id: string) => {
      recorded.add(id);
    }),
    getGracePeriod: vi.fn().mockResolvedValue(null),
    setGracePeriod: vi.fn().mockResolvedValue(undefined),
  };
  const notificationService = { notify: vi.fn().mockResolvedValue(undefined) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const config = {
    tryResolve: vi.fn().mockImplementation((id: string) => (id === capability.name ? capability : null)),
    resolve: vi.fn().mockImplementation((id: string) => {
      if (id !== capability.name) throw new Error(`not configured: ${id}`);
      return capability;
    }),
    defaultWebProvider: vi.fn().mockReturnValue(capability.name),
    defaultNativeProvider: vi.fn().mockReturnValue(null),
    billingEnabled: vi.fn().mockReturnValue(true),
    publicConfig: vi.fn().mockReturnValue({ enabled: true, defaultProvider: capability.name, providers: [] }),
  };
  const service = new PaymentsService(
    subscriptionService as any,
    organizationService as any,
    userService as any,
    trackService as any,
    paymentEventRepository as any,
    notificationService as any,
    audit as any,
    config as any,
  );
  return { service, org, capability, subscriptionService, organizationService, userService, trackService, paymentEventRepository, notificationService, audit, config, recorded };
}

const state = (overrides: Record<string, any> = {}) => ({
  tier: 'TEAM',
  period: 'MONTHLY',
  status: 'active',
  identifier: 'u1',
  providerSubscriptionRef: 'sub_1',
  isTrialing: false,
  cancelAt: null,
  pendingTier: null,
  ...overrides,
});
const activated = (overrides: Record<string, any> = {}, stateOverrides: Record<string, any> = {}) => ({
  type: 'subscription.activated' as const,
  customerRef: 'cus_1',
  state: state(stateOverrides),
  requiresCardCheck: true,
  ...overrides,
});
const webhook = (rawBody = '{}') => ({ rawBody: Buffer.from(rawBody), headers: { 'stripe-signature': 'sig' }, query: {} });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FRONTEND_URL = 'https://app';
});

describe('handleWebhook pipeline', () => {
  it('rejects a bad signature with 401 and drives no state change', async () => {
    const { service, capability, subscriptionService, paymentEventRepository } = build();
    capability.receiveWebhook.mockRejectedValue(new PaymentsWebhookVerificationError('bad'));
    await expect(service.handleWebhook('stripe', Buffer.from(''), {}, {})).rejects.toMatchObject({ status: 401 });
    expect(subscriptionService.createOrUpdateSubscription).not.toHaveBeenCalled();
    expect(paymentEventRepository.record).not.toHaveBeenCalled();
  });

  it('404s an unconfigured provider', async () => {
    const { service } = build();
    await expect(service.handleWebhook('razorpay', Buffer.from(''), {}, {})).rejects.toThrow(/not configured/);
  });

  it('applies the transition once across two identical deliveries (idempotency)', async () => {
    const { service, capability, subscriptionService, paymentEventRepository } = build();
    capability.receiveWebhook.mockResolvedValue({ eventId: 'evt_1', eventType: 'customer.subscription.updated', events: [{ ...activated({ type: 'subscription.updated' }) }] });
    await service.handleWebhook('stripe', Buffer.from(''), {}, {});
    const second = await service.handleWebhook('stripe', Buffer.from(''), {}, {});
    expect(subscriptionService.createOrUpdateSubscription).toHaveBeenCalledTimes(1);
    expect(paymentEventRepository.record).toHaveBeenCalledWith('evt_1', 'customer.subscription.updated', 'stripe');
    expect(second).toEqual({ ok: true });
  });

  it('records an unhandled event type without applying anything', async () => {
    const { service, capability, paymentEventRepository } = build();
    capability.receiveWebhook.mockResolvedValue({ eventId: 'evt_x', eventType: 'charge.refunded', events: [] });
    expect(await service.handleWebhook('stripe', Buffer.from(''), {}, {})).toEqual({ ok: true });
    expect(paymentEventRepository.record).toHaveBeenCalledWith('evt_x', 'charge.refunded', 'stripe');
  });

  it('acknowledges foreign traffic without a ledger row', async () => {
    const { service, capability, paymentEventRepository } = build();
    capability.receiveWebhook.mockResolvedValue({ eventId: 'evt_f', eventType: 'x', events: [], skipRecord: true });
    expect(await service.handleWebhook('stripe', Buffer.from(''), {}, {})).toEqual({ ok: true });
    expect(paymentEventRepository.exists).not.toHaveBeenCalled();
    expect(paymentEventRepository.record).not.toHaveBeenCalled();
  });

  it('wraps a processing error in a 500 and does NOT record the event (keeps it retryable)', async () => {
    const { service, capability, subscriptionService, paymentEventRepository } = build();
    capability.receiveWebhook.mockResolvedValue({ eventId: 'evt_err', eventType: 'customer.subscription.updated', events: [activated({ type: 'subscription.updated' })] });
    subscriptionService.createOrUpdateSubscription.mockRejectedValue(new Error('db down'));
    await expect(service.handleWebhook('stripe', Buffer.from(''), {}, {})).rejects.toMatchObject({ status: 500 });
    expect(paymentEventRepository.record).not.toHaveBeenCalled();
  });

  it('a non-signature adapter failure answers 500 so the vendor redelivers, and records nothing', async () => {
    const { service, capability, paymentEventRepository } = build();
    capability.receiveWebhook.mockRejectedValue(new Error('vendor API down'));
    await expect(service.handleWebhook('stripe', Buffer.from(''), {}, {})).rejects.toMatchObject({ status: 500 });
    expect(paymentEventRepository.record).not.toHaveBeenCalled();
  });

  it('returns the adapter ackBody verbatim when one is given', async () => {
    const { service, capability } = build();
    capability.receiveWebhook.mockResolvedValue({ eventId: 'evt_a', eventType: 'ping', events: [], ackBody: { pong: true } });
    expect(await service.handleWebhook('stripe', Buffer.from(''), {}, {})).toEqual({ pong: true });
  });
});

describe('applyEvent — subscription transitions', () => {
  it('creates the subscription row with the plan channel count and audits the status', async () => {
    const { service, subscriptionService, audit } = build();
    await service.applyEvent('stripe', activated());
    expect(subscriptionService.createOrUpdateSubscription).toHaveBeenCalledWith(false, 'u1', 'cus_1', pricing.TEAM.channel, 'TEAM', 'MONTHLY', null, undefined, 'org-1', 'stripe');
    expect(audit.record).toHaveBeenCalledWith({ orgId: 'org-1', action: 'billing.subscription.changed', resource: 'subscription', metadata: { status: 'active' } });
  });

  it('treats an incomplete subscription as not-yet-paid (no row, ok:false)', async () => {
    const { service, subscriptionService } = build();
    expect(await service.applyEvent('stripe', activated({}, { status: 'incomplete' }))).toEqual({ ok: false });
    expect(subscriptionService.createOrUpdateSubscription).not.toHaveBeenCalled();
  });

  it('runs the card check only for trial orgs and refuses on failure', async () => {
    const { service, capability, subscriptionService } = build(fakeCapability(), { allowTrial: true });
    capability.verifyPaymentMethod.mockResolvedValue(false);
    expect(await service.applyEvent('stripe', activated())).toEqual({ ok: false });
    expect(capability.verifyPaymentMethod).toHaveBeenCalledWith({ customerRef: 'cus_1', providerSubscriptionRef: 'sub_1' });
    expect(subscriptionService.createOrUpdateSubscription).not.toHaveBeenCalled();

    const noTrial = build();
    await noTrial.service.applyEvent('stripe', activated());
    expect(noTrial.capability.verifyPaymentMethod).not.toHaveBeenCalled();
    expect(noTrial.subscriptionService.createOrUpdateSubscription).toHaveBeenCalled();
  });

  it('a native downgrade sets pendingTier from the state', async () => {
    const { service, subscriptionService } = build();
    await service.applyEvent('stripe', activated({}, { pendingTier: 'PRO' }));
    expect(subscriptionService.setPendingTier).toHaveBeenCalledWith('org-1', 'PRO');
    subscriptionService.setPendingTier.mockClear();
    await service.applyEvent('stripe', activated({}, { pendingTier: 'TEAM' }));
    expect(subscriptionService.setPendingTier).not.toHaveBeenCalled();
  });

  it('canceled tears the row down and audits "deleted"', async () => {
    const { service, subscriptionService, audit } = build();
    await service.applyEvent('stripe', { type: 'subscription.canceled', customerRef: 'cus_1' });
    // Teardown is scoped to the provider: a ref string alone must never match another provider's org.
    expect(subscriptionService.deleteSubscription).toHaveBeenCalledWith('cus_1', 'stripe');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { status: 'deleted' } }));
  });

  it('audit is non-fatal when the write rejects or no org resolves', async () => {
    const { service, audit, subscriptionService } = build();
    audit.record.mockRejectedValue(new Error('audit down'));
    await expect(service.applyEvent('stripe', { type: 'subscription.canceled', customerRef: 'cus_1' })).resolves.toEqual({ ok: true });
    audit.record.mockClear();
    await service.applyEvent('stripe', { type: 'subscription.canceled', customerRef: 'cus_unknown' });
    expect(subscriptionService.deleteSubscription).toHaveBeenCalledWith('cus_unknown', 'stripe');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('addons.changed recomputes every extra* column from packs × pack size', async () => {
    const { service, capability, subscriptionService } = build();
    capability.listAddonQuantities.mockResolvedValue({ storage: 2, channels: 1, bogus: 9 });
    await service.applyEvent('stripe', { type: 'addons.changed', customerRef: 'cus_1' });
    const expected: Record<string, number> = {};
    for (const [type, def] of Object.entries(ADDONS)) expected[def.column] = 0;
    expected.extraStorageGb = 2 * ADDONS.storage.defaultPackSize;
    expected.extraChannels = 1 * ADDONS.channels.defaultPackSize;
    expect(subscriptionService.updateAddonQuantities).toHaveBeenCalledWith('org-1', expected);
  });

  it('addons.changed returns early when the customer has no org', async () => {
    const { service, subscriptionService } = build();
    expect(await service.applyEvent('stripe', { type: 'addons.changed', customerRef: 'cus_nobody' })).toEqual({ ok: true });
    expect(subscriptionService.updateAddonQuantities).not.toHaveBeenCalled();
  });
});

describe('applyEvent — org resolution by hint', () => {
  it('binds an unbound org from orgIdHint on first activation', async () => {
    const { service, subscriptionService } = build(fakeCapability({ name: 'paypal' }), { paymentId: null, paymentProvider: null });
    await service.applyEvent('paypal', activated({ customerRef: 'I-1', orgIdHint: 'org-1' }));
    expect(subscriptionService.updateCustomerId).toHaveBeenCalledWith('org-1', 'I-1', 'paypal');
    expect(subscriptionService.createOrUpdateSubscription).toHaveBeenCalledWith(expect.anything(), 'u1', 'I-1', expect.anything(), 'TEAM', 'MONTHLY', null, undefined, 'org-1', 'paypal');
  });

  it('re-points a rotated Google purchase token only when the vendor asserts the link (previousCustomerRef)', async () => {
    const { service, subscriptionService } = build(fakeCapability({ name: 'google' }), { paymentId: 'token_old', paymentProvider: 'google' });
    subscriptionService.getSubscription.mockResolvedValue({ provider: 'google' });
    // Same org id in the hint, but no link to the org's current token: a stranger's purchase — ignored.
    expect(await service.applyEvent('google', activated({ customerRef: 'token_attacker', orgIdHint: 'org-1' }))).toEqual({ ok: false });
    expect(subscriptionService.updateCustomerId).not.toHaveBeenCalled();
    await service.applyEvent('google', activated({ customerRef: 'token_new', orgIdHint: 'org-1', previousCustomerRef: 'token_old' }));
    expect(subscriptionService.updateCustomerId).toHaveBeenCalledWith('org-1', 'token_new', 'google');
  });

  it('a lapsed native subscriber re-binds freely on a fresh purchase (no live row ⇒ stale binding)', async () => {
    // Google: full expiry deleted the row; the org still carries the dead token.
    const g = build(fakeCapability({ name: 'google' }), { paymentId: 'tok_dead', paymentProvider: 'google' });
    g.subscriptionService.getSubscription.mockResolvedValue(null);
    await g.service.applyEvent('google', activated({ customerRef: 'tok_fresh', orgIdHint: 'org-1' }));
    expect(g.subscriptionService.updateCustomerId).toHaveBeenCalledWith('org-1', 'tok_fresh', 'google');
    expect(g.subscriptionService.createOrUpdateSubscription).toHaveBeenCalled();
    // Apple: resubscribing from another Apple ID yields a new originalTransactionId with no link.
    const a = build(fakeCapability({ name: 'apple' }), { paymentId: 'otx_dead', paymentProvider: 'apple' });
    a.subscriptionService.getSubscription.mockResolvedValue(null);
    await a.service.applyEvent('apple', activated({ customerRef: 'otx_new', orgIdHint: 'org-1' }));
    expect(a.subscriptionService.updateCustomerId).toHaveBeenCalledWith('org-1', 'otx_new', 'apple');
    // …but an org with a LIVE subscription on this provider is still protected.
    const live = build(fakeCapability({ name: 'google' }), { paymentId: 'tok_live', paymentProvider: 'google' });
    live.subscriptionService.getSubscription.mockResolvedValue({ provider: 'google' });
    expect(await live.service.applyEvent('google', activated({ customerRef: 'tok_attacker', orgIdHint: 'org-1' }))).toEqual({ ok: false });
    expect(live.subscriptionService.updateCustomerId).not.toHaveBeenCalled();
  });

  it('a zombie row (lapsed grace, or a missed teardown past cancelAt) no longer blocks a fresh purchase — and the re-bind resets the stale grace/downgrade', async () => {
    const DAY = 24 * 3600 * 1000;
    const graceLapsed = build(fakeCapability({ name: 'google' }), { paymentId: 'tok_zombie', paymentProvider: 'google' });
    graceLapsed.subscriptionService.getSubscription.mockResolvedValue({ provider: 'google', gracePeriodEnd: new Date(Date.now() - DAY) });
    await graceLapsed.service.applyEvent('google', activated({ customerRef: 'tok_fresh', orgIdHint: 'org-1' }));
    expect(graceLapsed.subscriptionService.updateCustomerId).toHaveBeenCalledWith('org-1', 'tok_fresh', 'google');
    expect(graceLapsed.paymentEventRepository.setGracePeriod).toHaveBeenCalledWith('tok_fresh', 'google', null);
    expect(graceLapsed.subscriptionService.clearPendingTier).toHaveBeenCalledWith('org-1');
    expect(graceLapsed.subscriptionService.createOrUpdateSubscription).toHaveBeenCalled();

    const cancelPassed = build(fakeCapability({ name: 'google' }), { paymentId: 'tok_zombie', paymentProvider: 'google' });
    cancelPassed.subscriptionService.getSubscription.mockResolvedValue({ provider: 'google', cancelAt: new Date(Date.now() - 2 * DAY) });
    await cancelPassed.service.applyEvent('google', activated({ customerRef: 'tok_fresh', orgIdHint: 'org-1' }));
    expect(cancelPassed.subscriptionService.updateCustomerId).toHaveBeenCalledWith('org-1', 'tok_fresh', 'google');

    // …while a genuinely live row (grace or scheduled end still ahead) keeps the guard.
    for (const live of [{ gracePeriodEnd: new Date(Date.now() + DAY) }, { cancelAt: new Date(Date.now() + DAY) }]) {
      const b = build(fakeCapability({ name: 'google' }), { paymentId: 'tok_live', paymentProvider: 'google' });
      b.subscriptionService.getSubscription.mockResolvedValue({ provider: 'google', ...live });
      expect(await b.service.applyEvent('google', activated({ customerRef: 'tok_attacker', orgIdHint: 'org-1' }))).toEqual({ ok: false });
      expect(b.subscriptionService.updateCustomerId).not.toHaveBeenCalled();
    }

    // An unpaid (incomplete) activation re-binds the ref but never revives the zombie's entitlement.
    const incomplete = build(fakeCapability({ name: 'google' }), { paymentId: 'tok_zombie', paymentProvider: 'google' });
    incomplete.subscriptionService.getSubscription.mockResolvedValue({ provider: 'google', gracePeriodEnd: new Date(Date.now() - DAY) });
    expect(await incomplete.service.applyEvent('google', activated({ customerRef: 'tok_fresh', orgIdHint: 'org-1' }, { status: 'incomplete' }))).toEqual({ ok: false });
    expect(incomplete.paymentEventRepository.setGracePeriod).not.toHaveBeenCalled();
    expect(incomplete.subscriptionService.clearPendingTier).not.toHaveBeenCalled();
  });

  it('a hint never re-binds an org already bound to another provider, even before its first subscription row', async () => {
    const { service, subscriptionService } = build(fakeCapability({ name: 'paypal' }), { paymentId: 'cus_1', paymentProvider: 'stripe' });
    subscriptionService.getSubscription.mockResolvedValue(null);
    expect(await service.applyEvent('paypal', activated({ customerRef: 'I-1', orgIdHint: 'org-1' }))).toEqual({ ok: false });
    expect(subscriptionService.updateCustomerId).not.toHaveBeenCalled();
  });

  it('hints are honoured on activation only — a cancel or past-due event for an unknown ref no-ops', async () => {
    const { service, subscriptionService, paymentEventRepository } = build(fakeCapability({ name: 'google' }), { paymentId: 'token_new', paymentProvider: 'google' });
    await service.applyEvent('google', { type: 'subscription.canceled', customerRef: 'token_old', orgIdHint: 'org-1' });
    expect(subscriptionService.updateCustomerId).not.toHaveBeenCalled();
    expect(subscriptionService.deleteSubscription).toHaveBeenCalledWith('token_old', 'google');
    await service.applyEvent('google', { type: 'subscription.past_due', customerRef: 'token_old', orgIdHint: 'org-1', providerSubscriptionRef: 'token_old' });
    expect(subscriptionService.updateCustomerId).not.toHaveBeenCalled();
    expect(paymentEventRepository.setGracePeriod).not.toHaveBeenCalled();
  });

  it('never lets a hint steal an org billed by another provider', async () => {
    const { service, subscriptionService } = build(fakeCapability({ name: 'apple' }), { paymentId: 'cus_1', paymentProvider: 'stripe' });
    subscriptionService.getSubscription.mockResolvedValue({ provider: 'stripe' });
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(await service.applyEvent('apple', activated({ customerRef: 'otx_1', orgIdHint: 'org-1' }))).toEqual({ ok: false });
    expect(subscriptionService.updateCustomerId).not.toHaveBeenCalled();
    expect(subscriptionService.createOrUpdateSubscription).not.toHaveBeenCalled();
    // The locked rule is a deliberate product decision: the log names both providers and the operator escape hatch.
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/locked to stripe[\s\S]*through apple[\s\S]*Organization\.paymentProvider/));
    warn.mockRestore();
  });

  it('ignores a hint for an unknown org', async () => {
    const { service, subscriptionService } = build();
    expect(await service.applyEvent('stripe', activated({ customerRef: 'cus_x', orgIdHint: 'org-nope' }))).toEqual({ ok: false });
    expect(subscriptionService.updateCustomerId).not.toHaveBeenCalled();
  });
});

describe('dunning grace (F5)', () => {
  it('updated with status active/trialing clears the grace marker', async () => {
    for (const status of ['active', 'trialing']) {
      const { service, paymentEventRepository } = build();
      await service.applyEvent('stripe', activated({ type: 'subscription.updated' }, { status }));
      expect(paymentEventRepository.setGracePeriod).toHaveBeenCalledWith('cus_1', 'stripe', null);
    }
  });

  it('activated (a brand-new subscription) does not touch the marker', async () => {
    const { service, paymentEventRepository } = build();
    await service.applyEvent('stripe', activated());
    expect(paymentEventRepository.setGracePeriod).not.toHaveBeenCalled();
  });

  it('payment.succeeded clears the marker only when the live status is active/trialing', async () => {
    const paid = (subscriptionStatus: any) => ({ type: 'payment.succeeded' as const, customerRef: 'cus_1', amountCents: 2900, currency: 'usd', isAddon: false, providerSubscriptionRef: 'sub_1', subscriptionStatus });
    const a = build();
    await a.service.applyEvent('stripe', paid('active'));
    expect(a.paymentEventRepository.setGracePeriod).toHaveBeenCalledWith('cus_1', 'stripe', null);
    const b = build();
    await b.service.applyEvent('stripe', paid('past_due'));
    expect(b.paymentEventRepository.setGracePeriod).not.toHaveBeenCalled();
    const c = build();
    await c.service.applyEvent('stripe', { ...paid('active'), isAddon: true });
    expect(c.paymentEventRepository.setGracePeriod).not.toHaveBeenCalled();
  });

  it('opens a 7-day window + notifies when the live subscription is genuinely past_due', async () => {
    const { service, capability, paymentEventRepository, notificationService } = build();
    capability.fetchSubscriptionState.mockResolvedValue(state({ status: 'past_due' }));
    const result = await service.applyEvent('stripe', { type: 'subscription.past_due', customerRef: 'cus_1', providerSubscriptionRef: 'sub_1' });
    expect(result).toEqual({ ok: true, grace: true });
    const [ref, provider, until] = paymentEventRepository.setGracePeriod.mock.calls[0];
    expect(ref).toBe('cus_1');
    expect(provider).toBe('stripe');
    expect(until).toBeInstanceOf(Date);
    expect((until as Date).getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
    expect(notificationService.notify).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', category: 'budget', link: 'https://app/billing' }));
  });

  it('ignores a delayed past_due snapshot processed after recovery', async () => {
    const { service, capability, paymentEventRepository } = build();
    capability.fetchSubscriptionState.mockResolvedValue(state({ status: 'active' }));
    expect(await service.applyEvent('stripe', { type: 'payment.failed', customerRef: 'cus_1', providerSubscriptionRef: 'sub_1' })).toEqual({ ok: true });
    expect(paymentEventRepository.setGracePeriod).not.toHaveBeenCalled();
  });

  it('keeps an existing unexpired window without re-setting it', async () => {
    const { service, capability, paymentEventRepository, notificationService } = build();
    capability.fetchSubscriptionState.mockResolvedValue(state({ status: 'past_due' }));
    paymentEventRepository.getGracePeriod.mockResolvedValue(new Date(Date.now() + 3600_000));
    expect(await service.applyEvent('stripe', { type: 'subscription.past_due', customerRef: 'cus_1', providerSubscriptionRef: 'sub_1' })).toEqual({ ok: true, grace: true });
    expect(paymentEventRepository.setGracePeriod).not.toHaveBeenCalled();
    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('opens no window when the live status cannot be verified or there is no subscription ref', async () => {
    const { service, capability, paymentEventRepository } = build();
    capability.fetchSubscriptionState.mockRejectedValue(new Error('api down'));
    expect(await service.applyEvent('stripe', { type: 'payment.failed', customerRef: 'cus_1', providerSubscriptionRef: 'sub_1' })).toEqual({ ok: true });
    expect(await service.applyEvent('stripe', { type: 'payment.failed', customerRef: 'cus_1' })).toEqual({ ok: true });
    expect(paymentEventRepository.setGracePeriod).not.toHaveBeenCalled();
  });

  it('providers without a live-state hook enter grace on the vendor’s word', async () => {
    const { service, paymentEventRepository } = build(fakeCapability({ name: 'paypal', fetchSubscriptionState: undefined }), { paymentId: 'I-1', paymentProvider: 'paypal' });
    expect(await service.applyEvent('paypal', { type: 'subscription.past_due', customerRef: 'I-1' })).toEqual({ ok: true, grace: true });
    expect(paymentEventRepository.setGracePeriod).toHaveBeenCalled();
  });
});

describe('payment.succeeded — pendingTier apply-on-renewal (B9.2) + tracking', () => {
  const paid = { type: 'payment.succeeded' as const, customerRef: 'cus_1', amountCents: 2900, currency: 'usd', isAddon: false, providerSubscriptionRef: 'sub_1', subscriptionStatus: 'active' as const, userIdHint: 'user-1', trackingRef: 'track-1' };

  it('applies the pending tier, clears it, commits it at the vendor and tracks the purchase', async () => {
    const { service, capability, subscriptionService, trackService } = build();
    subscriptionService.getSubscription.mockResolvedValue({ pendingTier: 'PRO', subscriptionTier: 'TEAM', period: 'MONTHLY' });
    await service.applyEvent('stripe', paid);
    expect(subscriptionService.modifySubscriptionByOrg).toHaveBeenCalledWith('org-1', pricing.PRO.channel, 'PRO');
    expect(subscriptionService.clearPendingTier).toHaveBeenCalledWith('org-1');
    expect(capability.commitPendingTier).toHaveBeenCalledWith('cus_1', 'PRO', 'sub_1');
    expect(trackService.track).toHaveBeenCalledWith('track-1', '1.1.1.1', 'ua', expect.anything(), { value: 29 });
  });

  it('does nothing when there is no pending tier and skips add-on invoices entirely', async () => {
    const { service, subscriptionService, capability } = build();
    subscriptionService.getSubscription.mockResolvedValue({ pendingTier: null });
    await service.applyEvent('stripe', paid);
    expect(subscriptionService.modifySubscriptionByOrg).not.toHaveBeenCalled();
    await service.applyEvent('stripe', { ...paid, isAddon: true });
    expect(subscriptionService.getSubscription).toHaveBeenCalledTimes(1);
    expect(capability.commitPendingTier).not.toHaveBeenCalled();
  });

  it('skips conversion tracking when the vendor gives no amount (never attributes the list price)', async () => {
    const { service, subscriptionService, trackService } = build();
    subscriptionService.getSubscription.mockResolvedValue({ pendingTier: null, subscriptionTier: 'PRO', period: 'YEARLY' });
    await service.applyEvent('stripe', { ...paid, amountCents: undefined });
    expect(trackService.track).not.toHaveBeenCalled();
  });
});

describe('web checkout + plan changes', () => {
  it('first purchase creates the vendor customer, binds it and returns the embedded secret', async () => {
    const { service, capability, subscriptionService } = build(fakeCapability(), { paymentId: null, paymentProvider: null });
    capability.createCheckout.mockResolvedValue({ kind: 'client_secret', clientSecret: 'cs', autoApplyCoupon: 'WELCOME' });
    const result = await service.startCheckout('embedded', 'track-1', 'org-1', 'user-1', { billing: 'PRO', period: 'MONTHLY', utm: 'ads', dub: '', datafast_session_id: undefined } as any, true);
    expect(result).toEqual({ client_secret: 'cs', auto_apply_coupon: 'WELCOME' });
    expect(subscriptionService.updateCustomerId).toHaveBeenCalledWith('org-1', 'cus_new', 'stripe');
    expect(capability.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        customerRef: 'cus_new',
        plan: { tier: 'PRO', monthlyCents: pricing.PRO.month_price * 100, yearlyCents: pricing.PRO.year_price * 100, currency: 'usd' },
        period: 'MONTHLY',
        allowTrial: true,
        trackingRef: 'track-1',
        metadata: { utm: 'ads' },
        mode: 'embedded',
        returnUrls: { success: expect.stringMatching(/^https:\/\/app\/posts\?onboarding=true&check=.{10}&utm_source=ads$/), cancel: 'https://app/billing?cancel=true&utm_source=ads' },
      }),
    );
  });

  it('an org with a subscription upgrades in place; a portal fallback is passed through', async () => {
    const { service, capability, subscriptionService } = build();
    subscriptionService.getSubscription.mockResolvedValue({ subscriptionTier: 'STARTER', period: 'MONTHLY', isLifetime: false });
    capability.changePlan.mockResolvedValue({ kind: 'applied' });
    expect(await service.startCheckout('hosted', 't', 'org-1', 'user-1', { billing: 'PRO', period: 'MONTHLY' } as any, false)).toEqual({ id: expect.any(String) });
    expect(capability.changePlan).toHaveBeenCalledWith(expect.objectContaining({ direction: 'upgrade', currentTier: 'STARTER', customerRef: 'cus_1' }));
    capability.changePlan.mockResolvedValue({ kind: 'portal', url: 'https://portal' });
    expect(await service.startCheckout('hosted', 't', 'org-1', 'user-1', { billing: 'PRO', period: 'MONTHLY' } as any, false)).toEqual({ portal: 'https://portal' });
  });

  it('a hosted provider asked for embedded checkout gets a redirect', async () => {
    const cap = fakeCapability({ name: 'paypal', capabilities: { ...fakeCapability().capabilities, checkoutMode: 'hosted' } });
    const { service, capability } = build(cap, { paymentId: null, paymentProvider: null });
    capability.ensureCustomer.mockResolvedValue(null);
    capability.createCheckout.mockResolvedValue({ kind: 'redirect', url: 'https://approve' });
    expect(await service.startCheckout('embedded', undefined, 'org-1', 'user-1', { billing: 'PRO', period: 'YEARLY' } as any, false)).toEqual({ url: 'https://approve' });
    expect(capability.createCheckout).toHaveBeenCalledWith(expect.objectContaining({ mode: 'hosted', customerRef: null }));
  });

  it('changePlan: same tier is a no-op, upgrade clears pendingTier and re-subscribes, downgrade sets pendingTier', async () => {
    const { service, capability, subscriptionService } = build();
    subscriptionService.getSubscription.mockResolvedValue({ subscriptionTier: 'PRO', period: 'YEARLY', isLifetime: false });
    expect(await service.changePlan('org-1', 'user-1', 'PRO')).toEqual({ ok: true });

    capability.changePlan.mockResolvedValue({ kind: 'applied' });
    await service.changePlan('org-1', 'user-1', 'AGENCY');
    expect(subscriptionService.clearPendingTier).toHaveBeenCalledWith('org-1');
    expect(capability.changePlan).toHaveBeenLastCalledWith(expect.objectContaining({ direction: 'upgrade', period: 'YEARLY', plan: expect.objectContaining({ tier: 'AGENCY' }) }));

    capability.changePlan.mockResolvedValue({ kind: 'pending', tier: 'STARTER' });
    expect(await service.changePlan('org-1', 'user-1', 'STARTER')).toEqual({ pendingTier: 'STARTER' });
    expect(subscriptionService.setPendingTier).toHaveBeenCalledWith('org-1', 'STARTER');
  });

  it('unsupported operations surface as PaymentsUnsupportedOperationError', async () => {
    const { service } = build(fakeCapability({ name: 'paypal', manageUrl: undefined, previewProration: undefined }), { paymentProvider: 'paypal', paymentId: 'I-1' });
    await expect(service.portalUrl('org-1')).rejects.toBeInstanceOf(PaymentsUnsupportedOperationError);
    expect(await service.prorate('org-1', { billing: 'PRO', period: 'MONTHLY' } as any)).toEqual({ price: 0 });
  });

  it('refuses when no provider is configured', async () => {
    const { service, config } = build();
    config.tryResolve.mockReturnValue(null);
    config.defaultWebProvider.mockReturnValue(null);
    await expect(service.portalUrl('org-1')).rejects.toThrow('No payment provider is configured');
    config.billingEnabled.mockReturnValue(false);
    expect(service.getPackages()).toEqual({});
  });
});

describe('native-only deployment fallback', () => {
  const nativeCap = () => fakeCapability({ name: 'apple', capabilities: { ...fakeCapability().capabilities, checkoutMode: 'native', portal: true }, manageUrl: vi.fn().mockResolvedValue('https://apps.apple.com/account/subscriptions'), createCheckout: undefined, ensureCustomer: undefined });

  it('a never-subscribed org binds to the store provider when no web provider exists', async () => {
    const { service, config, org } = build(nativeCap(), { paymentId: null, paymentProvider: null });
    config.defaultWebProvider.mockReturnValue(null);
    config.defaultNativeProvider.mockReturnValue('apple');
    const cfg = await service.getConfig(org as any);
    expect(cfg.org).toEqual({
      provider: 'apple',
      checkoutMode: 'native',
      capabilities: expect.objectContaining({ checkoutMode: 'native' }),
      manageUrl: 'https://apps.apple.com/account/subscriptions',
      lockedTo: null,
    });
    await expect(
      service.startCheckout('hosted', undefined, 'org-1', 'user-1', { billing: 'PRO', period: 'MONTHLY' } as any, false),
    ).rejects.toMatchObject({ operation: 'createCheckout' });
  });

  it('the web default still wins over the store fallback, and lockedTo reflects the org row', async () => {
    const { service, config, org } = build(fakeCapability(), { paymentId: 'cus_1', paymentProvider: 'stripe' });
    config.defaultNativeProvider.mockReturnValue('apple');
    const cfg = await service.getConfig(org as any);
    expect(cfg.org).toMatchObject({ provider: 'stripe', checkoutMode: 'embedded', lockedTo: 'stripe' });
  });
});

describe('cancel + expiry', () => {
  it('toggle cancel passes the vendor cancelAt through; an immediate teardown drops the row', async () => {
    const { service, capability, subscriptionService } = build();
    const cancelAt = new Date('2030-01-01');
    capability.setCancelAtPeriodEnd.mockResolvedValue({ cancelAt, cancelAtPeriodEnd: true, canceledNow: false });
    expect(await service.setToCancel('org-1')).toEqual({ id: expect.any(String), cancel_at: cancelAt });
    expect(capability.setCancelAtPeriodEnd).toHaveBeenCalledWith('cus_1', 'toggle');
    expect(subscriptionService.deleteSubscription).not.toHaveBeenCalled();

    capability.setCancelAtPeriodEnd.mockResolvedValue({ cancelAt: new Date(), cancelAtPeriodEnd: false, canceledNow: true });
    await service.setToCancel('org-1');
    expect(subscriptionService.deleteSubscription).toHaveBeenCalledWith('cus_1', 'stripe');
  });

  it('a provider without period-end cancel keeps the row with cancelAt for the expiry cron', async () => {
    const cap = fakeCapability({ name: 'paypal', capabilities: { ...fakeCapability().capabilities, periodEndCancel: false } });
    const { service, capability, subscriptionService } = build(cap, { paymentId: 'I-1', paymentProvider: 'paypal' });
    const cancelAt = new Date('2030-02-01');
    capability.setCancelAtPeriodEnd.mockResolvedValue({ cancelAt, cancelAtPeriodEnd: false, canceledNow: false });
    await service.setToCancel('org-1');
    expect(subscriptionService.setCancelAt).toHaveBeenCalledWith('org-1', cancelAt);
    expect(subscriptionService.deleteSubscription).not.toHaveBeenCalled();
  });

  it('expireCanceledSubscriptions tears each expired row down exactly once', async () => {
    const { service, subscriptionService, paymentEventRepository } = build(fakeCapability({ name: 'paypal' }), { paymentId: 'I-1', paymentProvider: 'paypal' });
    const past = new Date('2020-01-01');
    // Stripe and manual rows never reach the cron (excluded at the query).
    subscriptionService.findExpiredCancellations.mockResolvedValue([
      { id: 's1', provider: 'paypal', cancelAt: past, organization: { id: 'org-1', paymentId: 'I-1', paymentProvider: 'paypal' } },
    ]);
    expect(await service.expireCanceledSubscriptions()).toEqual({ checked: 1, tornDown: 1, failed: 0, staleStripe: 0 });
    expect(subscriptionService.deleteSubscription).toHaveBeenCalledTimes(1);
    expect(subscriptionService.deleteSubscription).toHaveBeenCalledWith('I-1', 'paypal');
    expect(paymentEventRepository.record).toHaveBeenCalledWith(`expiry:s1:${past.getTime()}`, 'subscription.expired', 'paypal');
    expect(await service.expireCanceledSubscriptions()).toEqual({ checked: 1, tornDown: 0, failed: 0, staleStripe: 0 });
  });

  it('counts and warns about Stripe rows past cancelAt with no teardown webhook, without touching them', async () => {
    const { service, subscriptionService } = build();
    const past = new Date('2020-01-01');
    subscriptionService.findStaleStripeCancellations.mockResolvedValue({
      count: 2,
      sample: [
        { id: 's7', organizationId: 'org-7', cancelAt: past },
        { id: 's8', organizationId: 'org-8', cancelAt: past },
      ],
    });
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(await service.expireCanceledSubscriptions()).toEqual({ checked: 0, tornDown: 0, failed: 0, staleStripe: 2 });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/2 Stripe subscription[\s\S]*s7[\s\S]*s8/));
    expect(subscriptionService.deleteSubscription).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a failing stale-Stripe read is non-fatal', async () => {
    const { service, subscriptionService } = build();
    subscriptionService.findStaleStripeCancellations.mockRejectedValue(new Error('db hiccup'));
    expect(await service.expireCanceledSubscriptions()).toEqual({ checked: 0, tornDown: 0, failed: 0, staleStripe: 0 });
  });

  it('expireCanceledSubscriptions survives one bad row and still tears down the rest', async () => {
    const { service, subscriptionService, config } = build(fakeCapability({ name: 'paypal' }), { paymentId: 'I-2', paymentProvider: 'paypal' });
    const past = new Date('2020-01-01');
    subscriptionService.findExpiredCancellations.mockResolvedValue([
      { id: 's1', provider: 'razorpay', cancelAt: past, organization: { id: 'org-9', paymentId: 'rz_1', paymentProvider: 'razorpay' } },
      { id: 's2', provider: 'paypal', cancelAt: past, organization: { id: 'org-1', paymentId: 'I-2', paymentProvider: 'paypal' } },
    ]);
    config.resolve.mockImplementation((id: string) => {
      if (id !== 'paypal') throw new Error(`not configured: ${id}`);
      return fakeCapability({ name: 'paypal' });
    });
    expect(await service.expireCanceledSubscriptions()).toEqual({ checked: 2, tornDown: 1, failed: 1, staleStripe: 0 });
    expect(subscriptionService.deleteSubscription).toHaveBeenCalledWith('I-2', 'paypal');
  });
});

describe('checkSubscription + native verify', () => {
  it('returns 2 from the DB, else pulls from the provider ref, else maps checkoutStatus', async () => {
    const { service, capability, subscriptionService, org } = build(fakeCapability({ name: 'paypal', pullSubscription: vi.fn() }), { paymentId: null, paymentProvider: null });
    subscriptionService.checkSubscription.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    capability.pullSubscription.mockResolvedValue([activated({ customerRef: 'I-9', orgIdHint: 'org-1' })]);
    expect(await service.checkSubscription(org as any, 'u1', 'I-9')).toBe(2);
    expect(subscriptionService.createOrUpdateSubscription).toHaveBeenCalled();

    subscriptionService.checkSubscription.mockResolvedValue(false);
    capability.pullSubscription.mockResolvedValue([]);
    capability.checkoutStatus.mockResolvedValue('canceled');
    expect(await service.checkSubscription(org as any, 'u1', 'I-9')).toBe(1);
    capability.checkoutStatus.mockResolvedValue('pending');
    expect(await service.checkSubscription(org as any, 'u1')).toBe(0);
  });

  it('verifyNativePurchase only accepts native providers and applies what the store confirms', async () => {
    const native = fakeCapability({ name: 'apple', capabilities: { ...fakeCapability().capabilities, checkoutMode: 'native' }, verifyPurchase: vi.fn() });
    const { service, capability, subscriptionService, org } = build(native, { paymentId: null, paymentProvider: null });
    capability.verifyPurchase.mockResolvedValue([activated({ customerRef: 'otx_1', orgIdHint: 'org-1' })]);
    subscriptionService.getSubscription.mockResolvedValueOnce(null).mockResolvedValue({ subscriptionTier: 'TEAM' });
    expect(await service.verifyNativePurchase(org as any, 'apple', { jws: 'x' })).toEqual({ ok: true, tier: 'TEAM' });
    expect(subscriptionService.updateCustomerId).toHaveBeenCalledWith('org-1', 'otx_1', 'apple');

    const web = build();
    await expect(web.service.verifyNativePurchase(org as any, 'stripe', {})).rejects.toBeInstanceOf(PaymentsUnsupportedOperationError);

    capability.verifyPurchase.mockRejectedValue(new PaymentsWebhookVerificationError('bad receipt'));
    await expect(service.verifyNativePurchase(org as any, 'apple', { jws: 'x' })).rejects.toMatchObject({ status: 400 });
  });
});
