import { describe, it, expect } from 'vitest';
import { pricing } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/pricing';
import { PaymentsTier } from '@postmill-ai/provider-kernel';

// The kernel cannot import pricing.ts, so it carries its own tier union; keep
// it in lockstep with the plan table (adding a tier means touching both).
const KERNEL_TIERS: PaymentsTier[] = ['STARTER', 'PRO', 'TEAM', 'AGENCY'];

describe('payments tier union ↔ pricing.ts', () => {
  it('names exactly the plans in pricing.ts', () => {
    expect([...KERNEL_TIERS].sort()).toEqual(Object.keys(pricing).sort());
  });
});
