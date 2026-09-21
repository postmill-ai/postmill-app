import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentsWebhooksController } from './payments.webhooks.controller';
import { StripeController } from './stripe.controller';
import { BillingController } from './billing.controller';
import { REQUIRE_PERMISSION_KEY } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';

// The pipeline (signature → idempotency → apply → record) is covered in
// libraries/nestjs-libraries/src/payments/payments.service.spec.ts; these
// controllers only route the raw request to it.

function req(rawBody = Buffer.from('{}')) {
  return { rawBody, headers: { 'stripe-signature': 'sig' } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PaymentsWebhooksController', () => {
  it('forwards the raw body, headers and query for the lower-cased provider', async () => {
    const payments = { handleWebhook: vi.fn().mockResolvedValue({ ok: true }) };
    const controller = new PaymentsWebhooksController(payments as any);
    const body = Buffer.from('{"a":1}');
    expect(await controller.receive('PayPal', req(body), { token: 't' })).toEqual({ ok: true });
    expect(payments.handleWebhook).toHaveBeenCalledWith('paypal', body, { 'stripe-signature': 'sig' }, { token: 't' });
  });

  it('propagates the service error (401/404/500 semantics live in the service)', async () => {
    const payments = { handleWebhook: vi.fn().mockRejectedValue(new Error('Webhook signature verification failed')) };
    const controller = new PaymentsWebhooksController(payments as any);
    await expect(controller.receive('stripe', req(), {})).rejects.toThrow(/signature/i);
  });
});

describe('StripeController (deprecated alias)', () => {
  it('forwards POST /stripe to the stripe provider pipeline', async () => {
    const payments = { handleWebhook: vi.fn().mockResolvedValue({ ok: true }) };
    const controller = new StripeController(payments as any);
    await controller.stripe(req());
    expect(payments.handleWebhook).toHaveBeenCalledWith('stripe', expect.any(Buffer), { 'stripe-signature': 'sig' }, {});
  });

  it('substitutes an empty body when the raw body is missing (signature check then fails downstream)', async () => {
    const payments = { handleWebhook: vi.fn().mockResolvedValue({ ok: true }) };
    await new StripeController(payments as any).stripe({ headers: {} } as any);
    await new PaymentsWebhooksController(payments as any).receive('stripe', { headers: {} } as any, undefined as any);
    expect(payments.handleWebhook).toHaveBeenNthCalledWith(1, 'stripe', Buffer.from(''), {}, {});
    expect(payments.handleWebhook).toHaveBeenNthCalledWith(2, 'stripe', Buffer.from(''), {}, {});
  });
});

describe('BillingController guards', () => {
  it('the privileged billing mutating routes carry the @RequirePermission(billing, manage) guard', () => {
    const proto = BillingController.prototype as any;
    for (const method of ['refundCharges', 'cancelSubscription', 'addSubscription', 'verifyNativePurchase']) {
      const meta = Reflect.getMetadata(REQUIRE_PERMISSION_KEY, proto[method]);
      expect(meta, `${method} must be RBAC-gated`).toBeDefined();
      expect(meta.resource).toBe('billing');
      expect(meta.action).toBe('manage');
    }
  });
});
