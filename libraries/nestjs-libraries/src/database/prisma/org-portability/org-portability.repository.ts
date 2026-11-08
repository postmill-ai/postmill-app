import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import {
  ORG_PORTABILITY_BATCH_SIZE,
  ORG_PORTABILITY_JOB_TTL_HOURS,
} from './org-portability.types';

@Injectable()
export class OrgPortabilityRepository {
  constructor(private readonly _prisma: PrismaService) {}

  async isOwner(organizationId: string, ownerId: string): Promise<boolean> {
    const count = await this._prisma.userOrganization.count({
      where: {
        organizationId,
        userId: ownerId,
        disabled: false,
        roleRef: { key: 'owner', isSystem: true },
      },
    });
    return count === 1;
  }

  createExportJob(
    organizationId: string,
    ownerId: string,
    archiveKeyCiphertext: string,
    keyWrap: Prisma.InputJsonValue,
  ) {
    return this._prisma.orgPortabilityJob.create({
      data: {
        organizationId,
        ownerId,
        kind: 'export',
        progress: { keyWrap },
        archiveKeyCiphertext,
        expiresAt: new Date(Date.now() + ORG_PORTABILITY_JOB_TTL_HOURS * 3_600_000),
      },
    });
  }

  getJob(id: string) {
    return this._prisma.orgPortabilityJob.findUnique({ where: { id } });
  }

  getOwnedJob(organizationId: string, ownerId: string, id: string) {
    return this._prisma.orgPortabilityJob.findFirst({
      where: { id, organizationId, ownerId },
    });
  }

  listOwnedJobs(organizationId: string, ownerId: string) {
    return this._prisma.orgPortabilityJob.findMany({
      where: { organizationId, ownerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  claimExportJob(id: string) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: {
        id,
        kind: 'export',
        OR: [
          { status: 'pending' },
          { status: 'processing', updatedAt: { lt: new Date(Date.now() - 3_600_000) } },
        ],
      },
      data: { status: 'processing', error: null },
    });
  }

  completeExportJob(id: string, data: { spoolPath: string; archiveSha256: string; progress: Prisma.InputJsonValue }) {
    return this._prisma.orgPortabilityJob.update({
      where: { id },
      data: {
        status: 'completed',
        spoolPath: data.spoolPath,
        archiveSha256: data.archiveSha256,
        archiveKeyCiphertext: null,
        progress: data.progress,
        error: null,
      },
    });
  }

  failExportJob(id: string, error: string) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, status: { in: ['pending', 'processing'] } },
      data: { status: 'failed', error, archiveKeyCiphertext: null },
    });
  }

  async expireJobs(now: Date) {
    const jobs = await this._prisma.orgPortabilityJob.findMany({
      where: {
        expiresAt: { lt: now },
        status: { in: ['uploading', 'validating', 'ready', 'pending', 'processing', 'completed', 'failed'] },
      },
    });
    if (!jobs.length) return [];
    await this._prisma.orgPortabilityJob.updateMany({
      where: { id: { in: jobs.map((job) => job.id) } },
      data: { status: 'expired', archiveKeyCiphertext: null },
    });
    return jobs;
  }

  organization(orgId: string) {
    return this._prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        description: true,
        streakSince: true,
        shortlink: true,
        activeContentPackIdentifier: true,
        aiBudgetMonthlyCap: true,
        aiBudgetDailyCap: true,
        aiBudgetAlertThresholdPct: true,
      },
    });
  }

  members(orgId: string) {
    return this._prisma.userOrganization.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        userId: true,
        roleId: true,
        disabled: true,
        createdAt: true,
        roleRef: { select: { key: true } },
        user: {
          select: {
            id: true,
            email: true,
            providerName: true,
            profile: {
              select: {
                name: true,
                lastName: true,
                bio: true,
                avatarUrl: true,
                pictureId: true,
                timezone: true,
                preferredLanguage: true,
              },
            },
            notificationPreference: {
              select: { masters: true, categories: true, digestFrequency: true },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  customRoles(orgId: string) {
    return this._prisma.appRole.findMany({
      where: { organizationId: orgId, isSystem: false },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isSystem: true,
        createdAt: true,
        updatedAt: true,
        permissions: {
          select: { permission: { select: { resource: true, action: true } } },
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  async modelBatch(model: string, orgId: string, cursor?: string) {
    const delegate = (this._prisma as any)[model];
    const where = {
      tags: { orgId },
      watchedAccountMetric: { watchedAccount: { organizationId: orgId } },
      campaignNoteReaction: { note: { organizationId: orgId } },
    }[model] || { organizationId: orgId };
    return delegate.findMany({
      where,
      orderBy: { id: 'asc' },
      take: ORG_PORTABILITY_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
  }

  async integrationWebhookPairs(orgId: string) {
    const webhooks = await this._prisma.webhooks.findMany({
      where: { organizationId: orgId },
      select: { id: true, integrations: { select: { id: true }, orderBy: { id: 'asc' } } },
      orderBy: { id: 'asc' },
    });
    return webhooks.flatMap((webhook) => webhook.integrations.map((integration) => ({
      webhookId: webhook.id,
      integrationId: integration.id,
    })));
  }

  async relatedBatch(model: string, orgId: string, cursor?: string) {
    if (model === 'tagsPosts' || model === 'appRolePermission') {
      const first = model === 'tagsPosts' ? 'postId' : 'roleId';
      const second = model === 'tagsPosts' ? 'tagId' : 'permissionId';
      const relation = model === 'tagsPosts' ? { tag: { orgId } } : { role: { organizationId: orgId } };
      return (this._prisma as any)[model].findMany({
        where: relation,
        orderBy: [{ [first]: 'asc' }, { [second]: 'asc' }],
        take: ORG_PORTABILITY_BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { [`${first}_${second}`]: JSON.parse(cursor) } } : {}),
      });
    }
    const relation = {
      postCommentRead: { post: { organizationId: orgId } },
      notificationRead: { notification: { organizationId: orgId } },
    }[model];
    if (!relation) throw new Error(`Unsupported portability relation ${model}`);
    return (this._prisma as any)[model].findMany({
      where: relation,
      orderBy: { id: 'asc' },
      take: ORG_PORTABILITY_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
  }

  files(orgId: string) {
    return this._prisma.file.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { id: 'asc' },
    });
  }
}
