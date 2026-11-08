import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { ORG_PORTABILITY_JOB_TTL_HOURS } from './org-portability.types';
import { lowerFirst, orgPortabilityModelNames } from './org-portability.domains';

export type OrgImportTransaction = Prisma.TransactionClient;

@Injectable()
export class OrgImportRepository {
  constructor(private readonly _prisma: PrismaService) {}

  createUploadJob(organizationId: string, ownerId: string, spoolPath: string) {
    return this._prisma.orgPortabilityJob.create({
      data: {
        organizationId,
        ownerId,
        kind: 'import',
        status: 'uploading',
        spoolPath,
        expiresAt: new Date(Date.now() + ORG_PORTABILITY_JOB_TTL_HOURS * 3_600_000),
      },
    });
  }

  getJob(id: string) {
    return this._prisma.orgPortabilityJob.findUnique({ where: { id } });
  }

  completedImport(organizationId: string, archiveSha256: string) {
    return this._prisma.orgPortabilityJob.findFirst({
      where: { organizationId, archiveSha256, kind: 'import', status: 'completed' },
    });
  }

  markValidated(id: string, archiveSha256: string, progress: Prisma.InputJsonValue) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, kind: 'import', status: 'uploading' },
      data: { archiveSha256, progress, error: null },
    });
  }

  prepareCommit(id: string, archiveKeyCiphertext: string, progress: Prisma.InputJsonValue) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, kind: 'import', status: 'uploading', archiveSha256: { not: null } },
      data: { status: 'pending', archiveKeyCiphertext, progress, error: null },
    });
  }

  claimProcessingJob(id: string) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, kind: 'import', status: 'processing', archiveKeyCiphertext: { not: null } },
      data: { error: null },
    });
  }

  claimPendingJob(id: string) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, kind: 'import', status: 'pending', archiveKeyCiphertext: { not: null } },
      data: { status: 'processing', error: null },
    });
  }

  updateProgress(id: string, progress: Prisma.InputJsonValue) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id },
      data: { progress },
    });
  }

  resetPendingJob(id: string) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, kind: 'import', status: 'pending' },
      data: { status: 'uploading', archiveKeyCiphertext: null },
    });
  }

  completeJobInTransaction(tx: OrgImportTransaction, id: string, progress: Prisma.InputJsonValue) {
    return tx.orgPortabilityJob.update({
      where: { id },
      data: { status: 'completed', progress, spoolPath: null, archiveKeyCiphertext: null, error: null },
    });
  }

  failJob(id: string, error: string, progress?: Prisma.InputJsonValue) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, status: { in: ['uploading', 'pending', 'processing'] } },
      data: {
        status: 'failed',
        error,
        archiveKeyCiphertext: null,
        archiveSha256: null,
        spoolPath: null,
        ...(progress ? { progress } : {}),
      },
    });
  }

  async destination(organizationId: string) {
    const organization = await this._prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, setupCompletedAt: true, localStorageQuotaBytes: true },
    });
    const nonEmptyDomains: string[] = [];
    for (const model of orgPortabilityModelNames()) {
      const delegate = lowerFirst(model);
      const where = {
        tags: { orgId: organizationId },
        watchedAccountMetric: { watchedAccount: { organizationId } },
        campaignNoteReaction: { note: { organizationId } },
      }[delegate] || { organizationId };
      const count = await (this._prisma as any)[delegate].count({ where });
      if (count > 0) nonEmptyDomains.push(model);
    }
    const usage = await this._prisma.file.aggregate({
      where: { organizationId, deletedAt: null },
      _sum: { fileSize: true },
    });
    return { organization, nonEmptyDomains, usedBytes: usage._sum.fileSize || 0 };
  }

  transaction<T>(work: (tx: OrgImportTransaction) => Promise<T>): Promise<T> {
    return this._prisma.$transaction(work, { timeout: 600_000, maxWait: 15_000 });
  }

  userById(tx: OrgImportTransaction, id: string) {
    return tx.user.findUnique({ where: { id }, select: { id: true, email: true } });
  }

  userByEmail(tx: OrgImportTransaction, email: string) {
    return tx.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true, email: true },
    });
  }

  systemRoles(tx: OrgImportTransaction) {
    return tx.appRole.findMany({
      where: { organizationId: null, isSystem: true },
      select: { id: true, key: true },
    });
  }

  permissions(tx: OrgImportTransaction) {
    return tx.permission.findMany({ select: { id: true, resource: true, action: true } });
  }

  createUser(tx: OrgImportTransaction, data: Prisma.UserCreateInput) {
    return tx.user.create({ data, select: { id: true, email: true } });
  }

  updateOrganization(tx: OrgImportTransaction, id: string, data: Prisma.OrganizationUpdateInput) {
    return tx.organization.update({ where: { id }, data });
  }

  createModel(tx: OrgImportTransaction, model: string, data: Record<string, unknown>) {
    return (tx as any)[model].create({ data });
  }

  updateProfilePicture(tx: OrgImportTransaction, userId: string, pictureId: string | null) {
    return tx.userProfile.update({ where: { userId }, data: { pictureId } });
  }

  connectIntegrationWebhook(tx: OrgImportTransaction, webhookId: string, integrationId: string) {
    return tx.webhooks.update({
      where: { id: webhookId },
      data: { integrations: { connect: { id: integrationId } } },
    });
  }
}
