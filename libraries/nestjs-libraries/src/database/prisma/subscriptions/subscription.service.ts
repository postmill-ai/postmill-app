import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { Organization } from '@prisma/client';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

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
    teamMembers: number
  ) {
    const currentTotalChannels = (
      await this._integrationService.getIntegrationsList(organizationId)
    ).filter((f) => !f.disabled);

    if (currentTotalChannels.length > totalChannels) {
      await this._integrationService.disableIntegrations(
        organizationId,
        currentTotalChannels.length - totalChannels
      );
    }

    await this._organizationService.disableExcessNonOwnerUsers(
      organizationId,
      teamMembers
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

    await this._pruneToPlanLimits(organizationId, totalChannels, pricing[billing].team_members);
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
      pricing[billing].team_members
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
    quantities: { extraStorageGb: number; extraVideoExports: number }
  ) {
    return this._subscriptionRepository.updateAddonQuantities(
      organizationId,
      quantities
    );
  }
}
