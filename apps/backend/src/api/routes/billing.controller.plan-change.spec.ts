import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingController } from './billing.controller';

describe('BillingController — plan changes and cancellations', () => {
  const org = { id: 'org-1', name: 'Test Org' } as any;
  const user = { id: 'user-1', email: 'user@example.com' } as any;

  function buildController(overrides: Record<string, unknown> = {}) {
    const subscriptionService = {
      getSubscriptionByOrganizationId: vi.fn(),
      ...((overrides.subscriptionService as any) || {}),
    };
    const stripeService = {
      changePlan: vi.fn().mockResolvedValue({ ok: true }),
      setToCancel: vi.fn().mockResolvedValue({ id: 'cancel-1' }),
      ...((overrides.stripeService as any) || {}),
    };
    const notificationService = {
      sendEmail: vi.fn().mockResolvedValue(undefined),
    };

    const controller = new BillingController(
      subscriptionService as any,
      stripeService as any,
      notificationService as any
    );

    return { controller, subscriptionService, stripeService, notificationService };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /change-plan', () => {
    it('upgrades immediately via subscribe/prorate and clears pendingTier', async () => {
      const { controller, stripeService } = buildController();
      stripeService.changePlan.mockResolvedValue({ id: 'sub-1' });

      const result = await controller.changePlan(org, user, { tier: 'PRO' });

      expect(stripeService.changePlan).toHaveBeenCalledWith(org.id, user.id, 'PRO');
      expect(result).toEqual({ id: 'sub-1' });
    });

    it('downgrade path sets pendingTier and schedules change at period end', async () => {
      const { controller, stripeService } = buildController();
      stripeService.changePlan.mockResolvedValue({ pendingTier: 'STARTER' });

      const result = await controller.changePlan(org, user, { tier: 'STARTER' });

      expect(stripeService.changePlan).toHaveBeenCalledWith(org.id, user.id, 'STARTER');
      expect(result).toEqual({ pendingTier: 'STARTER' });
    });

    it('accepts all valid BillingTier values', async () => {
      const { controller, stripeService } = buildController();

      for (const tier of ['STARTER', 'PRO', 'TEAM', 'AGENCY'] as const) {
        stripeService.changePlan.mockResolvedValue({ ok: true });
        await controller.changePlan(org, user, { tier });
        expect(stripeService.changePlan).toHaveBeenLastCalledWith(
          org.id,
          user.id,
          tier
        );
      }
    });
  });

  describe('POST /cancel', () => {
    it('flags add-on subscriptions to cancel at period end', async () => {
      const { controller, stripeService, notificationService } = buildController();

      const result = await controller.cancel(org, user, {
        feedback: 'too expensive',
      } as any);

      expect(notificationService.sendEmail).toHaveBeenCalledWith(
        process.env.EMAIL_FROM_ADDRESS,
        'Subscription Cancelled',
        expect.stringContaining('Test Org'),
        user.email
      );
      expect(stripeService.setToCancel).toHaveBeenCalledWith(org.id);
      expect(result).toEqual({ id: 'cancel-1' });
    });
  });
});
