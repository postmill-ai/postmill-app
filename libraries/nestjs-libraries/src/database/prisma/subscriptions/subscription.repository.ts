import { Injectable } from '@nestjs/common';
import {
  PrismaRepository,
  PrismaTransaction,
  PrismaService,
} from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { AddonExtraColumn } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/pricing';
import dayjs from 'dayjs';
import { Organization } from '@prisma/client';

@Injectable()
export class SubscriptionRepository {
  constructor(
    private readonly _subscription: PrismaRepository<'subscription'>,
    private readonly _organization: PrismaRepository<'organization'>,
    private readonly _user: PrismaRepository<'user'>,
    private readonly _credits: PrismaRepository<'credits'>,
    private _usedCodes: PrismaRepository<'usedCodes'>,
    private _prisma: PrismaService,
  ) {}

  getCode(code: string) {
    return this._usedCodes.model.usedCodes.findFirst({
      where: {
        code,
      },
    });
  }

  getSubscriptionByOrganizationId(organizationId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        deletedAt: null,
      },
    });
  }

  getCustomerIdByOrgId(organizationId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        id: organizationId,
      },
      select: {
        paymentId: true,
      },
    });
  }

  checkSubscription(organizationId: string, subscriptionId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        identifier: subscriptionId,
        deletedAt: null,
      },
    });
  }

  // `provider` scopes every customer-ref lookup: paymentId is a cross-provider
  // namespace, so a ref string alone could match another provider's org.
  private _customerWhere(customerId: string, provider?: string) {
    return { paymentId: customerId, ...(provider ? { paymentProvider: provider } : {}) };
  }

  deleteSubscriptionByCustomerId(customerId: string, provider?: string) {
    return this._subscription.model.subscription.deleteMany({
      where: {
        organization: this._customerWhere(customerId, provider),
      },
    });
  }

  updateCustomerId(organizationId: string, customerId: string, provider: string) {
    return this._organization.model.organization.update({
      where: {
        id: organizationId,
      },
      data: {
        paymentId: customerId,
        paymentProvider: provider,
      },
    });
  }

  async getSubscriptionByOrgId(orgId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId: orgId,
      },
    });
  }

  async getSubscriptionByCustomerId(customerId: string, provider?: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organization: this._customerWhere(customerId, provider),
      },
    });
  }

  async getOrganizationByCustomerId(customerId: string, provider?: string) {
    return this._organization.model.organization.findFirst({
      where: this._customerWhere(customerId, provider),
    });
  }

  async createOrUpdateSubscription(
    isTrailing: boolean,
    identifier: string,
    customerId: string,
    totalChannels: number,
    billing: 'STARTER' | 'PRO' | 'TEAM' | 'AGENCY',
    period: 'MONTHLY' | 'YEARLY',
    cancelAt: number | null,
    code?: string,
    org?: { id: string },
    provider = 'stripe'
  ) {
    const findOrg =
      org || (await this.getOrganizationByCustomerId(customerId, provider))!;

    if (!findOrg) {
      return;
    }

    await this._subscription.model.subscription.upsert({
      where: {
        organizationId: findOrg.id,
        ...(!code
          ? {
              organization: this._customerWhere(customerId, provider),
            }
          : {}),
      },
      update: {
        subscriptionTier: billing,
        totalChannels,
        period,
        identifier,
        isLifetime: !!code,
        cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
        deletedAt: null,
        provider,
      },
      create: {
        organizationId: findOrg.id,
        subscriptionTier: billing,
        isLifetime: !!code,
        totalChannels,
        period,
        cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
        identifier,
        deletedAt: null,
        provider,
      },
    });

    await this._organization.model.organization.update({
      where: {
        id: findOrg.id,
      },
      data: {
        isTrailing,
        allowTrial: false,
      },
    });

    if (code) {
      await this._usedCodes.model.usedCodes.create({
        data: {
          code,
          orgId: findOrg.id,
        },
      });
    }
  }

  getSubscriptionByIdentifier(identifier: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        identifier,
        deletedAt: null,
      },
      include: {
        organization: true,
      },
    });
  }

  getSubscription(organizationId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        deletedAt: null,
      },
    });
  }

  async getCreditsFrom(
    organizationId: string,
    from: dayjs.Dayjs,
    type = 'video_export'
  ) {
    const load = await this._credits.model.credits.groupBy({
      by: ['organizationId'],
      where: {
        organizationId,
        type,
        createdAt: {
          gte: from.toDate(),
        },
      },
      _sum: {
        credits: true,
      },
    });

    return load?.[0]?._sum?.credits || 0;
  }

  async useCredit<T>(
    org: Organization,
    type = 'video_export',
    func: () => Promise<T>
  ) {
    return this._prisma.$transaction(async (tx: any) => {
      const data = await tx.credits.create({
        data: {
          organizationId: org.id,
          credits: 1,
          type,
        },
      });

      try {
        return await func();
      } catch (err) {
        await tx.credits.delete({
          where: {
            id: data.id,
          },
        });
        throw err;
      }
    });
  }

  setCustomerId(orgId: string, customerId: string, provider: string) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        paymentId: customerId,
        paymentProvider: provider,
      },
    });
  }

  setPendingTier(
    organizationId: string,
    tier: 'STARTER' | 'PRO' | 'TEAM' | 'AGENCY'
  ) {
    return this._subscription.model.subscription.updateMany({
      where: { organizationId, deletedAt: null },
      data: { pendingTier: tier },
    });
  }

  clearPendingTier(organizationId: string) {
    return this._subscription.model.subscription.updateMany({
      where: { organizationId, deletedAt: null },
      data: { pendingTier: null },
    });
  }

  setCancelAt(organizationId: string, cancelAt: Date | null) {
    return this._subscription.model.subscription.updateMany({
      where: { organizationId, deletedAt: null },
      data: { cancelAt },
    });
  }

  // Rows whose scheduled end has passed — the expiry cron tears these down for
  // providers that cannot keep a cancelled subscription alive until period end.
  findExpiredCancellations(before: Date, limit = 200) {
    return this._subscription.model.subscription.findMany({
      where: { cancelAt: { lt: before }, deletedAt: null, isLifetime: false },
      include: { organization: { select: { id: true, paymentId: true, paymentProvider: true } } },
      orderBy: { cancelAt: 'asc' },
      take: limit,
    });
  }

  applyTier(
    organizationId: string,
    tier: 'STARTER' | 'PRO' | 'TEAM' | 'AGENCY',
    totalChannels: number
  ) {
    return this._subscription.model.subscription.updateMany({
      where: { organizationId, deletedAt: null },
      data: { subscriptionTier: tier, totalChannels },
    });
  }

  // Plain single-credit insert (no $transaction) — for metering an operation that has
  // ALREADY succeeded, where wrapping the work in an interactive transaction would risk a
  // timeout rollback. Idempotency is the caller's responsibility.
  recordCredit(organizationId: string, type: string) {
    return this._credits.model.credits.create({
      data: { organizationId, credits: 1, type },
    });
  }

  updateAddonQuantities(
    organizationId: string,
    quantities: Partial<Record<AddonExtraColumn, number>>
  ) {
    return this._subscription.model.subscription.updateMany({
      where: { organizationId, deletedAt: null },
      data: { ...quantities },
    });
  }

  setLimitOverrides(
    organizationId: string,
    overrides: Record<string, number>
  ) {
    return this._subscription.model.subscription.updateMany({
      where: { organizationId, deletedAt: null },
      data: { limitOverrides: overrides },
    });
  }
}
