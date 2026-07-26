import { inject } from 'vitest';
import { getTestPrisma } from '@postmill-ai/nestjs-libraries/testing/test-db';
import {
  PrismaRepository,
  PrismaService,
} from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { SubscriptionRepository } from './subscription.repository';
import { mergeEffectiveLimits } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/effective.limits';
import { pricing } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/pricing';

// Add-on + manual-override round-trip against a real DB (BILLING_ADDONS plan,
// verification section): a partial updateAddonQuantities payload lands on the
// right columns, the merged effective limit rises, a limitOverride replaces
// base+add-ons, and clearing it reverts.
describe('Subscription add-ons & limit overrides (integration)', () => {
  it('extra columns write, overrides win, clearing reverts', async () => {
    const prisma = getTestPrisma(inject('dbUrl'));
    const asService = prisma as unknown as PrismaService;
    const repo = new SubscriptionRepository(
      new PrismaRepository<'subscription'>(asService),
      new PrismaRepository<'organization'>(asService),
      new PrismaRepository<'user'>(asService),
      new PrismaRepository<'credits'>(asService),
      new PrismaRepository<'usedCodes'>(asService),
      asService
    );
    try {
      const org = await prisma.organization.create({ data: { name: 'bia-int' } });
      await prisma.subscription.create({
        data: {
          organizationId: org.id,
          subscriptionTier: 'STARTER',
          totalChannels: pricing.STARTER.channel,
        },
      });

      // 1. Simulate add-ons: 3 channel packs (5/pack) + 2 storage packs (25/pack).
      await repo.updateAddonQuantities(org.id, {
        extraChannels: 15,
        extraStorageGb: 50,
      });
      const withExtras = await repo.getSubscription(org.id);
      expect(withExtras?.extraChannels).toBe(15);
      expect(withExtras?.extraStorageGb).toBe(50);
      // Untouched extras stay at their defaults.
      expect(withExtras?.extraTeamMembers).toBe(0);
      expect(withExtras?.limitOverrides).toBeNull();

      // 2. Effective limits rise: a channel create that previously hit the
      // STARTER cap of 3 now fits 18.
      const merged = mergeEffectiveLimits(pricing.STARTER, withExtras);
      expect(merged.channel).toBe(18);
      expect(merged.storage_gb).toBe(51);
      expect(merged.team_members).toBe(pricing.STARTER.team_members);

      // 3. Manual override replaces base + add-ons.
      await repo.setLimitOverrides(org.id, { channel: 500 });
      const withOverride = await repo.getSubscription(org.id);
      expect(mergeEffectiveLimits(pricing.STARTER, withOverride).channel).toBe(500);

      // 4. Clearing the key (service merge-patch semantics: null deletes)
      // reverts to base + add-ons.
      await repo.setLimitOverrides(org.id, {});
      const cleared = await repo.getSubscription(org.id);
      expect(mergeEffectiveLimits(pricing.STARTER, cleared).channel).toBe(18);
    } finally {
      await prisma.$disconnect();
    }
  });
});
