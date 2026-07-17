import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';

import { StripeController } from './stripe.controller';
import { BillingController } from './billing.controller';
import { REQUIRE_PERMISSION_KEY } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import type { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';

// ---------------------------------------------------------------------------
// F2 — Billing/Stripe behavioural tests (Stripe mocked).
//
//   * a bad signature is rejected and drives no state change;
//   * a valid customer.subscription.updated / .deleted dispatches the mapped
//     tier transition exactly once;
//   * a duplicate event.id is ignored (C1 idempotency — the transition runs once
//     across two identical events);
//   * the privileged billing mutating routes carry the @RequirePermission guard.
// ---------------------------------------------------------------------------

function postmillEvent(type: string, id = 'evt_1') {
  return {
    id,
    type,
    data: { object: { metadata: { service: 'postmill' } } },
  };
}

function makeController() {
  // A stateful idempotency ledger: isEventProcessed() reflects what recordEvent() has stored.
  const recorded = new Set<string>();
  const stripeService = {
    validateRequest: vi.fn(),
    createSubscription: vi.fn().mockResolvedValue({ ok: true }),
    updateSubscription: vi.fn().mockResolvedValue({ ok: true }),
    deleteSubscription: vi.fn().mockResolvedValue({ ok: true }),
    paymentSucceeded: vi.fn().mockResolvedValue({ ok: true }),
    paymentFailed: vi.fn().mockResolvedValue({ ok: true }),
    isEventProcessed: vi.fn(async (id: string) => recorded.has(id)),
    recordEvent: vi.fn(async (id: string) => {
      recorded.add(id);
    }),
  };

  const controller = new StripeController(stripeService as unknown as StripeService);

  return { controller, stripeService, recorded };
}

function req(rawBody = Buffer.from('{}')) {
  return { rawBody, headers: { 'stripe-signature': 'sig' } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StripeController — F2 behavioural tests', () => {
  it('rejects a bad signature and drives no state change', async () => {
    const { controller, stripeService } = makeController();
    stripeService.validateRequest.mockImplementation(() => {
      throw new Error('Webhook signature verification failed');
    });

    await expect(controller.stripe(req())).rejects.toThrow(/signature/i);

    expect(stripeService.updateSubscription).not.toHaveBeenCalled();
    expect(stripeService.deleteSubscription).not.toHaveBeenCalled();
    expect(stripeService.recordEvent).not.toHaveBeenCalled();
  });

  it('drives the tier transition for customer.subscription.updated and records the event', async () => {
    const { controller, stripeService } = makeController();
    const event = postmillEvent('customer.subscription.updated');
    stripeService.validateRequest.mockReturnValue(event);

    await controller.stripe(req());

    expect(stripeService.updateSubscription).toHaveBeenCalledTimes(1);
    expect(stripeService.updateSubscription).toHaveBeenCalledWith(event);
    expect(stripeService.recordEvent).toHaveBeenCalledWith(event.id, event.type);
  });

  it('drives the teardown transition for customer.subscription.deleted', async () => {
    const { controller, stripeService } = makeController();
    const event = postmillEvent('customer.subscription.deleted');
    stripeService.validateRequest.mockReturnValue(event);

    await controller.stripe(req());

    expect(stripeService.deleteSubscription).toHaveBeenCalledTimes(1);
    expect(stripeService.deleteSubscription).toHaveBeenCalledWith(event);
  });

  it('ignores a duplicate event.id — the transition runs once across two identical events', async () => {
    const { controller, stripeService } = makeController();
    const event = postmillEvent('customer.subscription.updated', 'evt_dup');
    stripeService.validateRequest.mockReturnValue(event);

    // First delivery processes; second (same event.id) is short-circuited.
    const first = await controller.stripe(req());
    const second = await controller.stripe(req());

    expect(stripeService.updateSubscription).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ ok: true });
    expect(first).toBeDefined();
  });

  it('dispatches customer.subscription.created to createSubscription', async () => {
    const { controller, stripeService } = makeController();
    const event = postmillEvent('customer.subscription.created', 'evt_created');
    stripeService.validateRequest.mockReturnValue(event);

    await controller.stripe(req());

    expect(stripeService.createSubscription).toHaveBeenCalledWith(event);
    expect(stripeService.recordEvent).toHaveBeenCalledWith('evt_created', 'customer.subscription.created');
  });

  it('dispatches invoice.payment_succeeded / invoice.payment_failed even without postmill metadata', async () => {
    const { controller, stripeService } = makeController();

    stripeService.validateRequest.mockReturnValue({
      id: 'evt_paid',
      type: 'invoice.payment_succeeded',
      data: { object: {} },
    });
    await controller.stripe(req());
    expect(stripeService.paymentSucceeded).toHaveBeenCalledTimes(1);

    stripeService.validateRequest.mockReturnValue({
      id: 'evt_failed',
      type: 'invoice.payment_failed',
      data: { object: {} },
    });
    await controller.stripe(req());
    expect(stripeService.paymentFailed).toHaveBeenCalledTimes(1);
  });

  it('returns ok for an unhandled postmill event type (default case) and records it', async () => {
    const { controller, stripeService } = makeController();
    const event = postmillEvent('customer.subscription.paused', 'evt_paused');
    stripeService.validateRequest.mockReturnValue(event);

    const result = await controller.stripe(req());

    expect(result).toEqual({ ok: true });
    expect(stripeService.updateSubscription).not.toHaveBeenCalled();
    expect(stripeService.recordEvent).toHaveBeenCalledWith('evt_paused', 'customer.subscription.paused');
  });

  it('wraps a processing error in a 500 and does NOT record the event (keeps it retryable)', async () => {
    const { controller, stripeService } = makeController();
    const event = postmillEvent('customer.subscription.updated', 'evt_boom');
    stripeService.validateRequest.mockReturnValue(event);
    stripeService.updateSubscription.mockRejectedValue(new Error('downstream failure'));

    await expect(controller.stripe(req())).rejects.toBeTruthy();
    expect(stripeService.recordEvent).not.toHaveBeenCalled();
  });

  it('ignores webhooks from other Stripe integrations (no postmill metadata)', async () => {
    const { controller, stripeService } = makeController();
    stripeService.validateRequest.mockReturnValue({
      id: 'evt_other',
      type: 'customer.subscription.updated',
      data: { object: { metadata: { service: 'something-else' } } },
    });

    const result = await controller.stripe(req());

    expect(result).toEqual({ ok: true });
    expect(stripeService.updateSubscription).not.toHaveBeenCalled();
    expect(stripeService.isEventProcessed).not.toHaveBeenCalled();
  });

  it('the privileged billing mutating routes carry the @RequirePermission(billing, manage) guard', () => {
    const proto = BillingController.prototype as any;
    for (const method of [
      'refundCharges',
      'cancelSubscription',
      'addSubscription',
    ]) {
      const meta = Reflect.getMetadata(REQUIRE_PERMISSION_KEY, proto[method]);
      expect(meta, `${method} must be RBAC-gated`).toBeDefined();
      expect(meta.resource).toBe('billing');
      expect(meta.action).toBe('manage');
    }
  });
});
