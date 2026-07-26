import { forwardRef, Inject, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import {
  pricing,
  AddonExtraColumn,
} from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/pricing';
import {
  OVERRIDABLE_LIMIT_KEYS,
  mergeEffectiveLimits,
} from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/effective.limits';
import { SubscriptionRepository } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { IntegrationService } from '@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.service';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';
import { Organization } from '@prisma/client';
import dayjs from 'dayjs';
import { makeId } from '@postmill-ai/nestjs-libraries/services/make.is';
import { AuthService } from '@postmill-ai/helpers/auth/auth.service';

export type BillingTier = 'STARTER' | 'PRO' | 'TEAM' | 'AGENCY';

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly _subscriptionRepository: SubscriptionRepository,
    @Inject(forwardRef(() => IntegrationService))
    private readonly _integrationService: IntegrationService,
    @Inject(forwardRef(() => OrganizationService))
    private readonly _organizationService: OrganizationService
  ) {}

  getSubscriptionByOrganizationId(organizationId: string) {
    return this._subscriptionRepository.getSubscriptionByOrganizationId(
      organizationId
    );
  }

  getCreditsFrom(organizationId: string, from: dayjs.Dayjs, type: string) {
    return this._subscriptionRepository.getCreditsFrom(organizationId, from, type);
  }

  useCredit<T>(
    organization: Organization,
    type = 'video_export',
    func: () => Promise<T>
  ): Promise<T> {
    return this._subscriptionRepository.useCredit(organization, type, func);
  }

  // Record one credit for an already-completed operation (plain insert, no transaction).
  recordCredit(organization: Organization, type = 'video_export') {
    return this._subscriptionRepository.recordCredit(organization.id, type);
  }

  getCode(code: string) {
    return this._subscriptionRepository.getCode(code);
  }

  async deleteSubscription(customerId: string) {
    await this.modifySubscription(
      customerId,
      pricing.STARTER.channel || 0,
      'STARTER'
    );
    return this._subscriptionRepository.deleteSubscriptionByCustomerId(
      customerId
    );
  }

  updateCustomerId(organizationId: string, customerId: string) {
    return this._subscriptionRepository.updateCustomerId(
      organizationId,
      customerId
    );
  }

  async checkSubscription(organizationId: string, subscriptionId: string) {
    return await this._subscriptionRepository.checkSubscription(
      organizationId,
      subscriptionId
    );
  }

  private async _pruneToPlanLimits(
    organizationId: string,
    totalChannels: number,
    billing: BillingTier
  ) {
    // Prune to EFFECTIVE limits (plan + surviving add-on packs + manual
    // overrides), not the bare plan — resources a customer still pays add-ons
    // for must survive a plan downgrade. The row's `totalChannels` is stale
    // here (applyTier persists the new base after pruning), so the passed-in
    // value stands in for it.
    const subscription =
      await this._subscriptionRepository.getSubscription(organizationId);
    const effective = mergeEffectiveLimits(pricing[billing], {
      extraStorageGb: 0,
      extraVideoExports: 0,
      extraChannels: 0,
      extraTeamMembers: 0,
      extraPosts: 0,
      extraBrandKits: 0,
      extraWebhooks: 0,
      extraCompetitors: 0,
      ...(subscription || {}),
      totalChannels,
    });

    const currentTotalChannels = (
      await this._integrationService.getIntegrationsList(organizationId)
    ).filter((f) => !f.disabled);

    if (currentTotalChannels.length > effective.channel) {
      await this._integrationService.disableIntegrations(
        organizationId,
        currentTotalChannels.length - effective.channel
      );
    }

    await this._organizationService.disableExcessNonOwnerUsers(
      organizationId,
      effective.team_members
    );
  }

  async modifySubscriptionByOrg(
    organizationId: string,
    totalChannels: number,
    billing: BillingTier
  ) {
    if (!organizationId) {
      return false;
    }

    await this._pruneToPlanLimits(organizationId, totalChannels, billing);
    // Persist the applied tier + channel cap. _pruneToPlanLimits only disables excess
    // resources; without this the Subscription row keeps its old subscriptionTier and every
    // tier-keyed gate (campaigns/api/mcp/brand_kits/analytics/storage) would still grant the
    // pre-change tier — e.g. a scheduled downgrade would never actually take effect.
    await this._subscriptionRepository.applyTier(organizationId, billing, totalChannels);
    return true;
  }

  /**
   * Parse a JWT-signed `params` payload from the public `/modify-subscription`
   * webhook and apply the requested billing tier. Non-fatal: returns { success: false }
   * on any validation or processing error.
   */
  async modifyFromJwtToken(params: string): Promise<{ success: boolean }> {
    try {
      const load = AuthService.verifyJWT(params) as {
        orgId: string;
        billing: BillingTier;
      };

      if (!load || !load.orgId || !load.billing || !pricing[load.billing]) {
        return { success: false };
      }

      const plan = pricing[load.billing];

      await this.modifySubscriptionByOrg(
        load.orgId,
        plan.channel,
        load.billing
      );

      return { success: true };
    } catch {
      return { success: false };
    }
  }

  async modifySubscription(
    customerId: string,
    totalChannels: number,
    billing: BillingTier
  ) {
    if (!customerId) {
      return false;
    }

    const getOrgByCustomerId =
      await this._subscriptionRepository.getOrganizationByCustomerId(
        customerId
      );

    const getCurrentSubscription =
      (await this._subscriptionRepository.getSubscriptionByCustomerId(
        customerId
      ))!;

    if (
      !getOrgByCustomerId ||
      (getCurrentSubscription && getCurrentSubscription?.isLifetime)
    ) {
      return false;
    }

    await this._pruneToPlanLimits(
      getOrgByCustomerId.id,
      totalChannels,
      billing
    );

    return true;
  }

  async createOrUpdateSubscription(
    isTrailing: boolean,
    identifier: string,
    customerId: string,
    totalChannels: number,
    billing: BillingTier,
    period: 'MONTHLY' | 'YEARLY',
    cancelAt: number | null,
    code?: string,
    org?: string
  ) {
    if (!code) {
      try {
        const load = await this.modifySubscription(
          customerId,
          totalChannels,
          billing
        );
        if (!load) {
          return {};
        }
      } catch (e) {
        return {};
      }
    }
    return this._subscriptionRepository.createOrUpdateSubscription(
      isTrailing,
      identifier,
      customerId,
      totalChannels,
      billing,
      period,
      cancelAt,
      code,
      org ? { id: org } : undefined
    );
  }

  getSubscriptionByIdentifier(identifier: string) {
    return this._subscriptionRepository.getSubscriptionByIdentifier(identifier);
  }

  async getSubscription(organizationId: string) {
    return this._subscriptionRepository.getSubscription(organizationId);
  }

  async addSubscription(orgId: string, userId: string, subscription: BillingTier) {
    await this._subscriptionRepository.setCustomerId(orgId, userId);
    return this.createOrUpdateSubscription(
      false,
      makeId(5),
      userId,
      pricing[subscription].channel,
      subscription,
      'MONTHLY',
      null,
      undefined,
      orgId
    );
  }

  async setPendingTier(organizationId: string, tier: BillingTier) {
    return this._subscriptionRepository.setPendingTier(organizationId, tier);
  }

  async clearPendingTier(organizationId: string) {
    return this._subscriptionRepository.clearPendingTier(organizationId);
  }

  async updateAddonQuantities(
    organizationId: string,
    quantities: Partial<Record<AddonExtraColumn, number>>
  ) {
    return this._subscriptionRepository.updateAddonQuantities(
      organizationId,
      quantities
    );
  }

  /**
   * Super-admin manual limit overrides: merge-patch the `limitOverrides` JSON.
   * A number sets the key, `null` deletes it, absent keys stay untouched.
   * Only OVERRIDABLE_LIMIT_KEYS are accepted.
   */
  async setLimitOverrides(
    orgId: string,
    patch: Record<string, number | null>
  ) {
    const unknown = Object.keys(patch).filter(
      (key) => !(OVERRIDABLE_LIMIT_KEYS as readonly string[]).includes(key)
    );
    if (unknown.length) {
      throw new BadRequestException(
        `Unknown limit override keys: ${unknown.join(', ')}`
      );
    }

    const subscription =
      await this._subscriptionRepository.getSubscription(orgId);
    if (!subscription) {
      // updateMany would silently match 0 rows — tell the admin app the org
      // has no subscription to override instead of returning success.
      throw new NotFoundException(
        `Organization ${orgId} has no subscription to override`
      );
    }
    const current = subscription.limitOverrides;
    const merged: Record<string, number> = {
      ...(current && typeof current === 'object' && !Array.isArray(current)
        ? (current as Record<string, number>)
        : {}),
    };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }

    return this._subscriptionRepository.setLimitOverrides(orgId, merged);
  }
}
