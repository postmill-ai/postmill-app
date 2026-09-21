import { describe, it, expect } from 'vitest';
import { pricing } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/pricing';
import { PaymentsTier } from '@postmill-ai/provider-kernel';

// The kernel cannot import pricing.ts, so it carries its own tier union. The
// Record below is an exhaustiveness anchor: extending `PaymentsTier` without a
// key here fails `tsc`, and the runtime assertion catches a pricing.ts change.
const KERNEL_TIERS: Record<PaymentsTier, true> = { STARTER: true, PRO: true, TEAM: true, AGENCY: true };

describe('payments tier union ↔ pricing.ts', () => {
  it('names exactly the plans in pricing.ts', () => {
    expect(Object.keys(KERNEL_TIERS).sort()).toEqual(Object.keys(pricing).sort());
  });
});
