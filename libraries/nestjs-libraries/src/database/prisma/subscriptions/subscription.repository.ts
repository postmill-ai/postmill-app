import { Injectable } from '@nestjs/common';
import {
  PrismaRepository,
  PrismaTransaction,
  PrismaService,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
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

  deleteSubscriptionByCustomerId(customerId: string) {
    return this._subscription.model.subscription.deleteMany({
      where: {
        organization: {
          paymentId: customerId,
        },
      },
    });
  }

  updateCustomerId(organizationId: string, customerId: string) {
    return this._organization.model.organization.update({
      where: {
        id: organizationId,
      },
      data: {
        paymentId: customerId,
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

  async getSubscriptionByCustomerId(customerId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organization: {
          paymentId: customerId,
        },
      },
    });
  }

  async getOrganizationByCustomerId(customerId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        paymentId: customerId,
      },
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
    org?: { id: string }
  ) {
    const findOrg =
      org || (await this.getOrganizationByCustomerId(customerId))!;

    if (!findOrg) {
      return;
    }

    await this._subscription.model.subscription.upsert({
      where: {
        organizationId: findOrg.id,
        ...(!code
          ? {
              organization: {
                paymentId: customerId,
              },
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

  setCustomerId(orgId: string, customerId: string) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        paymentId: customerId,
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
    quantities: { extraStorageGb: number; extraVideoExports: number }
  ) {
    return this._subscription.model.subscription.updateMany({
      where: { organizationId, deletedAt: null },
      data: {
        extraStorageGb: quantities.extraStorageGb,
        extraVideoExports: quantities.extraVideoExports,
      },
    });
  }
}
