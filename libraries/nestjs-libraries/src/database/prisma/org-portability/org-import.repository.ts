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

  startValidation(id: string, archiveKeyCiphertext: string, progress: Prisma.InputJsonValue) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, kind: 'import', status: 'uploading' },
      data: { status: 'validating', archiveKeyCiphertext, progress, error: null },
    });
  }

  completeValidation(id: string, archiveSha256: string, progress: Prisma.InputJsonValue) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, kind: 'import', status: 'validating' },
      data: { status: 'ready', archiveSha256, progress, error: null },
    });
  }

  prepareCommit(id: string, progress: Prisma.InputJsonValue) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, kind: 'import', status: 'ready', archiveSha256: { not: null } },
      data: { status: 'pending', progress, error: null },
    });
  }

  claimValidationJob(id: string) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, kind: 'import', status: 'validating', archiveKeyCiphertext: { not: null } },
      data: { error: null },
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

  resetValidationJob(id: string) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, kind: 'import', status: 'validating' },
      data: { status: 'uploading', archiveKeyCiphertext: null },
    });
  }

  retryValidationJob(id: string, error: string, progress: Prisma.InputJsonValue) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, kind: 'import', status: 'validating' },
      data: {
        status: 'uploading',
        error,
        archiveKeyCiphertext: null,
        archiveSha256: null,
        progress,
      },
    });
  }

  resetPendingJob(id: string) {
    return this._prisma.orgPortabilityJob.updateMany({
      where: { id, kind: 'import', status: 'pending' },
      data: { status: 'ready' },
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
      where: { id, status: { in: ['uploading', 'validating', 'ready', 'pending', 'processing'] } },
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
    const storageProviders = await this._prisma.storageProviderConfig.findMany({
      where: { organizationId },
      select: { id: true, type: true },
    });
    const hasOnlySignupStorage = storageProviders.length === 1 && storageProviders[0].type === 'LOCAL';
    const nonEmptyDomains: string[] = [];
    for (const model of orgPortabilityModelNames()) {
      if (model === 'StorageProviderConfig' && hasOnlySignupStorage) continue;
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
    return this._prisma.$transaction(work, { timeout: 1_800_000, maxWait: 15_000 });
  }

  userById(tx: OrgImportTransaction, id: string) {
    return tx.user.findUnique({ where: { id }, select: { id: true, email: true } });
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

  updateOrganization(tx: OrgImportTransaction, id: string, data: Prisma.OrganizationUpdateInput) {
    return tx.organization.update({ where: { id }, data });
  }

  createManyModel(tx: OrgImportTransaction, model: string, data: Record<string, unknown>[]) {
    return (tx as any)[model].createMany({ data });
  }

  defaultLocalProvider(tx: OrgImportTransaction, organizationId: string) {
    return tx.storageProviderConfig.findFirst({
      where: { organizationId, type: 'LOCAL' },
      select: { id: true },
    });
  }

  connectIntegrationWebhooks(tx: OrgImportTransaction, webhookId: string, integrationIds: string[]) {
    return tx.webhooks.update({
      where: { id: webhookId },
      data: { integrations: { connect: integrationIds.map((id) => ({ id })) } },
    });
  }
}
