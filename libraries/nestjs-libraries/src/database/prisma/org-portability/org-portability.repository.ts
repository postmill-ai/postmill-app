import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import {
  ORG_PORTABILITY_BATCH_SIZE,
  ORG_PORTABILITY_JOB_TTL_HOURS,
} from './org-portability.types';

const ORG_PORTABILITY_IDLE_STATUSES = ['ready', 'completed', 'failed'];
const ORG_PORTABILITY_ACTIVE_STATUSES = ['uploading', 'validating', 'pending', 'processing'];

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

  // Conditional on the worker still holding the claim: a job expired or failed meanwhile
  // reports count 0 and the caller must discard its archive.
  completeExportJob(id: string, data: { spoolPath: string; archiveSha256: string; progress: Prisma.InputJsonValue }) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, kind: 'export', status: 'processing' },
      data: {
        status: 'completed',
        spoolPath: data.spoolPath,
        archiveSha256: data.archiveSha256,
        archiveKeyCiphertext: null,
        progress: data.progress,
        error: null,
        expiresAt: new Date(Date.now() + ORG_PORTABILITY_JOB_TTL_HOURS * 3_600_000),
      },
    });
  }

  failExportJob(id: string, error: string) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, status: { in: ['pending', 'processing'] } },
      data: { status: 'failed', error, archiveKeyCiphertext: null },
    });
  }

  // A job in an active status keeps its spool and key past `expiresAt` while its worker or
  // uploader is still touching it; only once it has also been idle for a full TTL is it
  // treated as orphaned and expired. Each row is re-checked in its own guarded update so a
  // job that moves (e.g. ready -> pending) between the read and the write is left alone; the
  // update also pins the spoolPath that was read, so the caller only removes the file the row
  // held at the moment it became `expired`. Every completion is itself conditional on an
  // active status, so a row can never be both expired here and completed by a worker.
  async expireJobs(now: Date) {
    const staleBefore = new Date(now.getTime() - ORG_PORTABILITY_JOB_TTL_HOURS * 3_600_000);
    const where: Prisma.OrgPortabilityJobWhereInput = {
      expiresAt: { lt: now },
      OR: [
        { status: { in: ORG_PORTABILITY_IDLE_STATUSES } },
        { status: { in: ORG_PORTABILITY_ACTIVE_STATUSES }, updatedAt: { lt: staleBefore } },
      ],
    };
    const jobs = await this._prisma.orgPortabilityJob.findMany({ where });
    const expired = [];
    for (const job of jobs) {
      const result = await this._prisma.orgPortabilityJob.updateMany({
        where: { ...where, id: job.id, spoolPath: job.spoolPath },
        data: { status: 'expired', archiveKeyCiphertext: null },
      });
      if (result.count === 1) expired.push(job);
    }
    return expired;
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

  brandFonts(orgId: string) {
    return this._prisma.aIBrandProfile.findMany({
      where: { organizationId: orgId },
      select: { id: true, customFonts: true },
      orderBy: { id: 'asc' },
    });
  }
}
