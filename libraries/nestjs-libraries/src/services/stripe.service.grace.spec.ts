import { describe, it, expect, vi, beforeEach } from 'vitest';

// F5 — dunning grace: the gracePeriodEnd marker must be cleared on genuine
// recovery (active/trialing ONLY — never on unpaid/canceled), and a grace
// window may only be opened after verifying the LIVE subscription is still
// past_due (Stripe webhook ordering is not guaranteed).

// Mutable singleton so tests can change Stripe responses while the module-level
// `stripe` instance inside StripeService points at the same object (same pattern
// as stripe.service.pending-tier.spec.ts).
const mockStripe = vi.hoisted(() => ({
  subscriptions: {
    retrieve: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    cancel: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('stripe', () => {
  return {
    default: class MockStripe {
      subscriptions = mockStripe.subscriptions;
    },
  };
});

import { StripeService } from './stripe.service';

function subscriptionUpdatedEvent(
  status: string,
  extra: Record<string, unknown> = {}
) {
  return {
    data: {
      object: {
        id: 'sub_1',
        customer: 'cus_1',
        status,
        cancel_at: null,
        metadata: { billing: 'TEAM', period: 'MONTHLY', uniqueId: 'u1' },
        ...extra,
      },
    },
  } as any;
}

function invoiceEvent(withSubscription = true) {
  return {
    data: {
      object: {
        amount_paid: 2900,
        customer: 'cus_1',
        parent: withSubscription
          ? { subscription_details: { subscription: 'sub_1' } }
          : {},
      },
    },
  } as any;
}

function makeService(
  overrides: { existingGrace?: Date | null } = {}
) {
  const subscriptionService = {
    createOrUpdateSubscription: vi.fn().mockResolvedValue(undefined),
    getSubscription: vi.fn().mockResolvedValue({ pendingTier: null }),
    modifySubscriptionByOrg: vi.fn().mockResolvedValue(undefined),
    clearPendingTier: vi.fn().mockResolvedValue(undefined),
  };
  const organizationService = {
    // allowTrial falsy → checkValidCard short-circuits to "valid" without
    // touching the Stripe API.
    getOrgByCustomerId: vi
      .fn()
      .mockResolvedValue({ id: 'org-1', allowTrial: false }),
  };
  const userService = { getUserById: vi.fn().mockResolvedValue(null) };
  const trackService = { track: vi.fn() };
  const stripeEventRepository = {
    getGracePeriod: vi
      .fn()
      .mockResolvedValue(overrides.existingGrace ?? null),
    setGracePeriod: vi.fn().mockResolvedValue(undefined),
  };
  const notificationService = { notify: vi.fn().mockResolvedValue(undefined) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };

  const service = new StripeService(
    subscriptionService as any,
    organizationService as any,
    userService as any,
    trackService as any,
    stripeEventRepository as any,
    notificationService as any,
    audit as any
  );

  return {
    service,
    subscriptionService,
    stripeEventRepository,
    notificationService,
  };
}

describe('StripeService — dunning grace (F5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStripe.subscriptions.retrieve.mockReset();
  });

  describe('clear on recovery (only active/trialing)', () => {
    it.each(['active', 'trialing'])(
      'updateSubscription with status %s clears the grace marker',
      async (status) => {
        const { service, stripeEventRepository, subscriptionService } =
          makeService();

        await service.updateSubscription(subscriptionUpdatedEvent(status));

        expect(
          stripeEventRepository.setGracePeriod
        ).toHaveBeenCalledWith('cus_1', null);
        expect(
          subscriptionService.createOrUpdateSubscription
        ).toHaveBeenCalled();
      }
    );

    it.each(['unpaid', 'canceled', 'incomplete_expired', 'paused'])(
      'updateSubscription with status %s does NOT clear the grace marker',
      async (status) => {
        const { service, stripeEventRepository } = makeService();

        await service.updateSubscription(subscriptionUpdatedEvent(status));

        // Clearing here would null the marker on a dunning-exhausted sub and
        // grant permanent paid access (I1) — the marker must survive.
        expect(
          stripeEventRepository.setGracePeriod
        ).not.toHaveBeenCalled();
      }
    );

    it('paymentSucceeded clears the marker on the non-addon subscription path', async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        customer: 'cus_1',
        status: 'active',
        metadata: { userId: 'u1', ud: 'ud1' },
      });
      const { service, stripeEventRepository } = makeService();

      const result = await service.paymentSucceeded(invoiceEvent());

      expect(result).toEqual({ ok: true });
      expect(stripeEventRepository.setGracePeriod).toHaveBeenCalledWith(
        'cus_1',
        null
      );
    });

    it('paymentSucceeded does NOT clear when the live subscription is not active/trialing', async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        customer: 'cus_1',
        status: 'past_due',
        metadata: { userId: 'u1', ud: 'ud1' },
      });
      const { service, stripeEventRepository } = makeService();

      await service.paymentSucceeded(invoiceEvent());

      expect(stripeEventRepository.setGracePeriod).not.toHaveBeenCalled();
    });

    it('paymentSucceeded does NOT clear on an addon invoice', async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        customer: 'cus_1',
        status: 'active',
        metadata: { userId: 'u1', ud: 'ud1', addon: 'storage' },
      });
      const { service, stripeEventRepository } = makeService();

      await service.paymentSucceeded(invoiceEvent());

      expect(stripeEventRepository.setGracePeriod).not.toHaveBeenCalled();
    });
  });

  describe('ordering guard — only enter grace when LIVE status is past_due', () => {
    it('opens a grace window when the live subscription is genuinely past_due', async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_1',
        customer: 'cus_1',
        status: 'past_due',
      });
      const { service, stripeEventRepository, notificationService } =
        makeService();

      await service.updateSubscription(subscriptionUpdatedEvent('past_due'));

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1');
      expect(stripeEventRepository.setGracePeriod).toHaveBeenCalledTimes(1);
      const [, until] = stripeEventRepository.setGracePeriod.mock.calls[0];
      expect(until).toBeInstanceOf(Date);
      expect(until.getTime()).toBeGreaterThan(Date.now());
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org-1', category: 'budget' })
      );
    });

    it('ignores a delayed past_due snapshot processed after recovery', async () => {
      // Live status already recovered — the stale snapshot must NOT open a
      // fresh window (it would downgrade a paid customer when it lapses).
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
      });
      const { service, stripeEventRepository, notificationService } =
        makeService();

      await service.updateSubscription(subscriptionUpdatedEvent('past_due'));

      expect(stripeEventRepository.setGracePeriod).not.toHaveBeenCalled();
      expect(notificationService.notify).not.toHaveBeenCalled();
    });

    it('keeps an existing unexpired window without re-setting it', async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_1',
        customer: 'cus_1',
        status: 'past_due',
      });
      const { service, stripeEventRepository, notificationService } =
        makeService({
          existingGrace: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        });

      await service.updateSubscription(subscriptionUpdatedEvent('past_due'));

      expect(stripeEventRepository.setGracePeriod).not.toHaveBeenCalled();
      expect(notificationService.notify).not.toHaveBeenCalled();
    });

    it('paymentFailed opens a window only after verifying the live subscription', async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_1',
        customer: 'cus_1',
        status: 'past_due',
      });
      const { service, stripeEventRepository } = makeService();

      await service.paymentFailed(invoiceEvent());

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1');
      expect(stripeEventRepository.setGracePeriod).toHaveBeenCalledTimes(1);
      const [, until] = stripeEventRepository.setGracePeriod.mock.calls[0];
      expect(until.getTime()).toBeGreaterThan(Date.now());
    });

    it('paymentFailed for a non-subscription invoice opens no window', async () => {
      const { service, stripeEventRepository } = makeService();

      await service.paymentFailed(invoiceEvent(false));

      expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(stripeEventRepository.setGracePeriod).not.toHaveBeenCalled();
    });
  });
});
