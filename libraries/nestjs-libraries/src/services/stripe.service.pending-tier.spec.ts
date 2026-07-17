import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// Mutable singleton so tests can change Stripe responses while the module-level
// `stripe` instance inside StripeService points at the same object. Hoisted so it
// exists before StripeService's top-level `new Stripe()` runs at import time.
const mockStripe = vi.hoisted(() => ({
  subscriptions: {
    retrieve: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
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

// A renewal invoice (invoice.payment_succeeded) with a resolvable subscription.
function renewalEvent() {
  return {
    data: {
      object: {
        amount_paid: 2900,
        parent: { subscription_details: { subscription: 'sub_1' } },
      },
    },
  } as any;
}

// The Stripe subscription retrieved for the invoice. `addon` absent = a real
// plan renewal; set it to skip the pending-tier block.
function stripeSubscription(extra: Record<string, unknown> = {}) {
  return {
    customer: 'cus_1',
    metadata: { userId: 'u1', ud: 'ud1', ...(extra as any) },
  };
}

function makeService(overrides: {
  pendingTier?: string | null;
} = {}) {
  const subscriptionService = {
    getSubscription: vi
      .fn()
      .mockResolvedValue({ pendingTier: overrides.pendingTier ?? null }),
    modifySubscriptionByOrg: vi.fn().mockResolvedValue(undefined),
    clearPendingTier: vi.fn().mockResolvedValue(undefined),
  };
  const organizationService = {
    getOrgByCustomerId: vi.fn().mockResolvedValue({ id: 'org-1' }),
  };
  const userService = {
    // null user short-circuits the analytics track branch.
    getUserById: vi.fn().mockResolvedValue(null),
  };
  const trackService = { track: vi.fn() };

  const service = new StripeService(
    subscriptionService as any,
    organizationService as any,
    userService as any,
    trackService as any,
    {} as any,
    {} as any,
    {} as any
  );

  return { service, subscriptionService, organizationService, userService };
}

describe('StripeService.paymentSucceeded — pendingTier apply-on-renewal (B9.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStripe.subscriptions.retrieve.mockReset();
  });

  it('applies the pending tier then clears it on a renewal invoice', async () => {
    mockStripe.subscriptions.retrieve.mockResolvedValue(stripeSubscription());
    const { service, subscriptionService } = makeService({ pendingTier: 'PRO' });

    const result = await service.paymentSucceeded(renewalEvent());

    expect(result).toEqual({ ok: true });
    expect(subscriptionService.modifySubscriptionByOrg).toHaveBeenCalledTimes(1);
    expect(subscriptionService.modifySubscriptionByOrg).toHaveBeenCalledWith(
      'org-1',
      pricing.PRO.channel,
      'PRO'
    );
    expect(subscriptionService.clearPendingTier).toHaveBeenCalledWith('org-1');
  });

  it('does nothing when there is no pending tier', async () => {
    mockStripe.subscriptions.retrieve.mockResolvedValue(stripeSubscription());
    const { service, subscriptionService } = makeService({ pendingTier: null });

    const result = await service.paymentSucceeded(renewalEvent());

    expect(result).toEqual({ ok: true });
    expect(subscriptionService.modifySubscriptionByOrg).not.toHaveBeenCalled();
    expect(subscriptionService.clearPendingTier).not.toHaveBeenCalled();
  });

  it('skips addon invoices entirely (no pending-tier lookup)', async () => {
    mockStripe.subscriptions.retrieve.mockResolvedValue(
      stripeSubscription({ addon: 'storage' })
    );
    const { service, subscriptionService, organizationService } = makeService({
      pendingTier: 'PRO',
    });

    const result = await service.paymentSucceeded(renewalEvent());

    expect(result).toEqual({ ok: true });
    expect(organizationService.getOrgByCustomerId).not.toHaveBeenCalled();
    expect(subscriptionService.getSubscription).not.toHaveBeenCalled();
    expect(subscriptionService.modifySubscriptionByOrg).not.toHaveBeenCalled();
    expect(subscriptionService.clearPendingTier).not.toHaveBeenCalled();
  });

  it('returns early when the invoice has no subscription', async () => {
    const { service } = makeService({ pendingTier: 'PRO' });

    const result = await service.paymentSucceeded({
      data: { object: { amount_paid: 0, parent: {} } },
    } as any);

    expect(result).toEqual({ ok: true });
    expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });
});
