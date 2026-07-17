import { describe, it, expect, vi } from 'vitest';
import { StripeService } from './stripe.service';

// F2(b): a subscription state transition must emit a non-fatal
// `billing.subscription.changed` audit event with no secret in metadata.
describe('StripeService audit (F2b)', () => {
  const make = (orgId: string | null = 'o1') => {
    const record = vi.fn().mockResolvedValue(undefined);
    const subscriptionService = {
      deleteSubscription: vi.fn().mockResolvedValue(undefined),
    } as any;
    const organizationService = {
      getOrgByCustomerId: vi
        .fn()
        .mockResolvedValue(orgId ? { id: orgId } : null),
    } as any;
    const service = new StripeService(
      subscriptionService,
      organizationService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { record } as any
    );
    return { service, record, subscriptionService };
  };

  it('records billing.subscription.changed on a delete transition', async () => {
    const { service, record, subscriptionService } = make('o1');

    await service.deleteSubscription({
      data: { object: { customer: 'cus_123' } },
    } as any);

    expect(subscriptionService.deleteSubscription).toHaveBeenCalledWith('cus_123');
    expect(record).toHaveBeenCalledTimes(1);
    const arg = record.mock.calls[0][0];
    expect(arg.action).toBe('billing.subscription.changed');
    expect(arg.orgId).toBe('o1');
    expect(arg.resource).toBe('subscription');
    expect(arg.metadata).toEqual({ status: 'deleted' });
    // No secret material — only the status string is logged.
    expect(JSON.stringify(arg)).not.toMatch(/secret|password|sk_|token/i);
  });

  it('is non-fatal when no org resolves for the customer', async () => {
    const { service, record } = make(null);
    await expect(
      service.deleteSubscription({
        data: { object: { customer: 'cus_unknown' } },
      } as any)
    ).resolves.not.toThrow();
    expect(record).not.toHaveBeenCalled();
  });

  it('is non-fatal when the audit write rejects', async () => {
    const { service, record } = make('o1');
    record.mockRejectedValue(new Error('audit down'));
    await expect(
      service.deleteSubscription({
        data: { object: { customer: 'cus_123' } },
      } as any)
    ).resolves.not.toThrow();
  });
});
