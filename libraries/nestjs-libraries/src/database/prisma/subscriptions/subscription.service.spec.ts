import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expectTypeOf } from 'vitest';
import { SubscriptionService, type BillingTier } from './subscription.service';
import { pricing } from './pricing';

describe('SubscriptionService', () => {
  const orgId = 'org-1';
  const userId = 'user-1';

  function buildService(overrides: Record<string, unknown> = {}) {
    const subscriptionRepository = {
      getSubscriptionByOrganizationId: vi.fn().mockResolvedValue(null),
      getCreditsFrom: vi.fn().mockResolvedValue(0),
      useCredit: vi.fn(async (_org: any, _type: any, fn: any) => fn()),
      getCode: vi.fn(),
      deleteSubscriptionByCustomerId: vi.fn(),
      updateCustomerId: vi.fn(),
      checkSubscription: vi.fn(),
      getOrganizationByCustomerId: vi.fn(),
      getSubscriptionByCustomerId: vi.fn(),
      createOrUpdateSubscription: vi.fn().mockResolvedValue({}),
      getSubscriptionByIdentifier: vi.fn(),
      getSubscription: vi.fn(),
      setCustomerId: vi.fn(),
      setPendingTier: vi.fn().mockResolvedValue({ count: 1 }),
      clearPendingTier: vi.fn().mockResolvedValue({ count: 1 }),
      applyTier: vi.fn().mockResolvedValue({ count: 1 }),
      recordCredit: vi.fn().mockResolvedValue({}),
      updateAddonQuantities: vi.fn().mockResolvedValue({ count: 1 }),
      ...((overrides.subscriptionRepository as any) || {}),
    };

    const integrationService = {
      getIntegrationsList: vi.fn().mockResolvedValue([]),
      disableIntegrations: vi.fn().mockResolvedValue(undefined),
      ...((overrides.integrationService as any) || {}),
    };

    const organizationService = {
      getOrgById: vi.fn().mockResolvedValue({ id: orgId }),
      disableExcessNonOwnerUsers: vi.fn().mockResolvedValue(undefined),
      ...((overrides.organizationService as any) || {}),
    };

    const service = new SubscriptionService(
      subscriptionRepository as any,
      integrationService as any,
      organizationService as any
    );

    return {
      service,
      subscriptionRepository,
      integrationService,
      organizationService,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('BillingTier type', () => {
    it('matches the four Postmill tiers exactly', () => {
      expectTypeOf<BillingTier>().toEqualTypeOf<
        'STARTER' | 'PRO' | 'TEAM' | 'AGENCY'
      >();
    });

    it('accepts all four valid tier values at runtime', () => {
      const tiers: BillingTier[] = ['STARTER', 'PRO', 'TEAM', 'AGENCY'];
      for (const tier of tiers) {
        expect(pricing[tier]).toBeDefined();
        expect(pricing[tier].current).toBe(tier);
      }
    });
  });

  describe('modifySubscriptionByOrg', () => {
    it('prunes channels and members to the new plan limits', async () => {
      const { service, integrationService, organizationService, subscriptionRepository } =
        buildService();

      integrationService.getIntegrationsList.mockResolvedValue([
        { id: 'c1', disabled: false },
        { id: 'c2', disabled: false },
        { id: 'c3', disabled: false },
        { id: 'c4', disabled: false },
      ]);

      const result = await service.modifySubscriptionByOrg(orgId, 2, 'STARTER');

      expect(result).toBe(true);
      expect(integrationService.disableIntegrations).toHaveBeenCalledWith(
        orgId,
        2
      );
      expect(organizationService.disableExcessNonOwnerUsers).toHaveBeenCalledWith(
        orgId,
        pricing.STARTER.team_members
      );
      expect(subscriptionRepository.getSubscriptionByOrganizationId).not.toHaveBeenCalled();
    });

    it('does not disable integrations when already within channel limit', async () => {
      const { service, integrationService, organizationService } = buildService();

      integrationService.getIntegrationsList.mockResolvedValue([
        { id: 'c1', disabled: false },
      ]);

      await service.modifySubscriptionByOrg(orgId, 10, 'PRO');

      expect(integrationService.disableIntegrations).not.toHaveBeenCalled();
      expect(organizationService.disableExcessNonOwnerUsers).toHaveBeenCalledWith(
        orgId,
        pricing.PRO.team_members
      );
    });

    it('returns false when organizationId is empty', async () => {
      const { service } = buildService();
      expect(await service.modifySubscriptionByOrg('', 10, 'PRO')).toBe(false);
    });
  });

  describe('addSubscription', () => {
    function setupAddSubscriptionMocks(repo: any) {
      repo.setCustomerId.mockResolvedValue(undefined);
      repo.getOrganizationByCustomerId.mockResolvedValue({ id: orgId });
      repo.getSubscriptionByCustomerId.mockResolvedValue(null);
    }

    it('creates a subscription with the plan channel count and valid BillingTier', async () => {
      const { service, subscriptionRepository } = buildService();
      setupAddSubscriptionMocks(subscriptionRepository);

      await service.addSubscription(orgId, userId, 'TEAM');

      expect(subscriptionRepository.setCustomerId).toHaveBeenCalledWith(
        orgId,
        userId
      );
      expect(subscriptionRepository.createOrUpdateSubscription).toHaveBeenCalledWith(
        false,
        expect.any(String),
        userId,
        pricing.TEAM.channel,
        'TEAM',
        'MONTHLY',
        null,
        undefined,
        { id: orgId }
      );

      const call = subscriptionRepository.createOrUpdateSubscription.mock.calls[0];
      expect(pricing[call[4] as BillingTier]).toBeDefined();
      expect(call[3]).toBe(pricing[call[4] as BillingTier].channel);
    });

    it.each(['STARTER', 'PRO', 'TEAM', 'AGENCY'] as const)(
      'accepts %s as a valid BillingTier',
      async (tier) => {
        const { service, subscriptionRepository } = buildService();
        setupAddSubscriptionMocks(subscriptionRepository);

        await service.addSubscription(orgId, userId, tier);

        const call = subscriptionRepository.createOrUpdateSubscription.mock.calls[0];
        expect(call[4]).toBe(tier);
        expect(call[3]).toBe(pricing[tier].channel);
      }
    );
  });

  describe('pending tier helpers', () => {
    it('setPendingTier delegates to the repository', async () => {
      const { service, subscriptionRepository } = buildService();

      await service.setPendingTier(orgId, 'PRO');

      expect(subscriptionRepository.setPendingTier).toHaveBeenCalledWith(
        orgId,
        'PRO'
      );
    });

    it('clearPendingTier delegates to the repository', async () => {
      const { service, subscriptionRepository } = buildService();

      await service.clearPendingTier(orgId);

      expect(subscriptionRepository.clearPendingTier).toHaveBeenCalledWith(orgId);
    });
  });

  describe('updateAddonQuantities', () => {
    it('delegates to the repository with the right numbers', async () => {
      const { service, subscriptionRepository } = buildService();

      await service.updateAddonQuantities(orgId, {
        extraStorageGb: 50,
        extraVideoExports: 100,
      });

      expect(subscriptionRepository.updateAddonQuantities).toHaveBeenCalledWith(
        orgId,
        { extraStorageGb: 50, extraVideoExports: 100 }
      );
    });
  });
});
