import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { PrismaService } from '../prisma.service';
import { createTestDatabase, getTestPrisma } from '../../../testing/test-db';
import { EncryptionService } from '../../../encryption/encryption.service';
import { OrgPortabilityRepository } from './org-portability.repository';
import { OrgPortabilityService } from './org-portability.service';
import { OrgImportRepository } from './org-import.repository';
import { OrgImportService } from './org-import.service';
import { createOrgArchiveKey, wrapOrgArchiveKey } from './org-portability.crypto';

vi.mock('@postmill-ai/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { send: vi.fn(async () => undefined) },
  isInngestEnabled: () => true,
}));
vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: vi.fn(async () => 'OK'),
    eval: vi.fn(async () => 1),
  },
}));

const passphrase = 'cross deployment passphrase';
const localAdapter = (root: string, missingPath?: string) => ({
  readFileStream: async (filePath: string) => {
    if (filePath === missingPath) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return createReadStream(filePath);
  },
  uploadFile: async (file: { path: string }) => {
    const destination = path.join(root, `${randomUUID()}.asset`);
    writeFileSync(destination, readFileSync(file.path), { mode: 0o600 });
    return { path: destination };
  },
  removeFile: async (filePath: string) => rmSync(filePath, { force: true }),
});

const seedIdentity = async (prisma: any, prefix: string) => {
  const ownerRole = await prisma.appRole.create({
    data: { key: 'owner', name: 'Owner', isSystem: true },
  });
  const adminRole = await prisma.appRole.create({
    data: { key: 'admin', name: 'Admin', isSystem: true },
  });
  const memberRole = await prisma.appRole.create({
    data: { key: 'member', name: 'Member', isSystem: true },
  });
  const permission = await prisma.permission.create({
    data: { resource: 'posts', action: 'manage' },
  });
  return { ownerRole, adminRole, memberRole, permission, prefix };
};

const createUser = (prisma: any, email: string, name: string) => prisma.user.create({
  data: {
    email,
    providerName: 'LOCAL',
    activated: true,
    profile: { create: { name, timezone: 'UTC', preferredLanguage: 'en' } },
    notificationPreference: { create: {} },
  },
});

describe('organization portability across two deployments', () => {
  it('exports and imports with new IDs, storage paths, role IDs and encryption keys', async () => {
    const sourceDb = await createTestDatabase('_org_source');
    const destinationDb = await createTestDatabase('_org_destination');
    const source = getTestPrisma(sourceDb.url);
    const destination = getTestPrisma(destinationDb.url);
    const root = mkdtempSync(path.join(tmpdir(), 'org-portability-int-'));
    const sourceStorage = path.join(root, 'source');
    const destinationStorage = path.join(root, 'destination');
    const spool = path.join(root, 'spool');
    for (const directory of [sourceStorage, destinationStorage, spool]) mkdirSync(directory, { recursive: true, mode: 0o700 });
    const previous = { ...process.env };
    process.env.ORG_PORTABILITY_SPOOL_DIR = spool;
    process.env.ENCRYPTION_KEY = 'source-encryption-key-with-at-least-32-bytes';
    process.env.JWT_SECRET = 'source-jwt-secret';
    const encryption = new EncryptionService();
    const audit = { record: vi.fn(async () => undefined) };
    const notifications = { sendEmail: vi.fn(async () => undefined) };
    const designerDoc = { stripIds: (doc: any) => doc, assignIdsAndNormalize: (doc: any) => doc };
    let sourceAsset = '';
    try {
      const sourceIdentity = await seedIdentity(source, 'source');
      await seedIdentity(destination, 'destination');
      const sourceOwner = await createUser(source, 'owner@example.test', 'Source Owner');
      const sourceMember = await createUser(source, 'member@example.test', 'Source Member');
      const destinationOwner = await createUser(destination, 'destination@example.test', 'Destination Owner');
      const sourceOrg = await source.organization.create({
        data: { name: 'Source Organization', setupCompletedAt: new Date() },
      });
      const destinationOrg = await destination.organization.create({
        data: { name: 'Empty Destination', setupCompletedAt: null },
      });
      const customRole = await source.appRole.create({
        data: {
          organizationId: sourceOrg.id,
          key: 'designer',
          name: 'Designer',
          isSystem: false,
          permissions: { create: { permissionId: sourceIdentity.permission.id } },
        },
      });
      await source.userOrganization.createMany({
        data: [
          { userId: sourceOwner.id, organizationId: sourceOrg.id, roleId: sourceIdentity.ownerRole.id },
          { userId: sourceMember.id, organizationId: sourceOrg.id, roleId: customRole.id },
        ],
      });
      await destination.userOrganization.create({
        data: { userId: destinationOwner.id, organizationId: destinationOrg.id, roleId: (await destination.appRole.findFirst({ where: { key: 'owner' } })).id },
      });

      const provider = await source.orgProviderConfiguration.create({
        data: {
          organizationId: sourceOrg.id,
          identifier: 'instagram',
          name: 'Source Instagram',
          enabled: true,
          clientId: encryption.encrypt('client-id'),
          clientSecret: encryption.encrypt('client-secret'),
          additionalConfig: encryption.encrypt('{"signingSecret":"secret"}'),
        },
      });
      const integration = await source.integration.create({
        data: {
          organizationId: sourceOrg.id,
          providerConfigId: provider.id,
          internalId: 'instagram-internal',
          name: 'Instagram',
          providerIdentifier: 'instagram',
          type: 'channel',
          token: encryption.encrypt('access-token'),
          refreshToken: encryption.encrypt('refresh-token'),
          customInstanceDetails: encryption.encrypt('{"instance":"private"}'),
          disabled: false,
        },
      });
      await source.webhooks.create({
        data: {
          organizationId: sourceOrg.id,
          name: 'Publishing webhook',
          url: 'https://hooks.example.test/postmill',
          integrations: { connect: { id: integration.id } },
        },
      });
      const folder = await source.fileFolder.create({
        data: { organizationId: sourceOrg.id, name: 'Assets' },
      });
      sourceAsset = path.join(sourceStorage, 'present.png');
      const missingAsset = path.join(sourceStorage, 'missing.png');
      writeFileSync(sourceAsset, 'portable image bytes', { mode: 0o600 });
      const presentFile = await source.file.create({
        data: {
          organizationId: sourceOrg.id,
          folderId: folder.id,
          name: 'present.png',
          path: sourceAsset,
          fileSize: 20,
          metadata: { mime: 'image/png' },
        },
      });
      const missingFile = await source.file.create({
        data: {
          organizationId: sourceOrg.id,
          folderId: folder.id,
          name: 'missing.png',
          path: missingAsset,
          fileSize: 10,
          metadata: { mime: 'image/png' },
        },
      });
      await source.design.create({
        data: {
          organizationId: sourceOrg.id,
          createdById: sourceOwner.id,
          previewFileId: missingFile.id,
          name: 'Portable design',
          doc: {
            outputs: [{
              id: 'output-1',
              children: [
                { id: 'present', fileId: presentFile.id, src: sourceAsset },
                { id: 'missing', fileId: missingFile.id, src: missingAsset },
              ],
            }],
          },
        },
      });
      await source.userProfile.update({
        where: { userId: sourceMember.id },
        data: { pictureId: missingFile.id, avatarUrl: missingAsset },
      });

      const sourceRepository = new OrgPortabilityRepository(source as unknown as PrismaService);
      const sourceAdapter = localAdapter(sourceStorage, missingAsset);
      const exporter = new OrgPortabilityService(
        sourceRepository,
        { resolveAdapterForFolder: async () => sourceAdapter } as any,
        encryption,
        audit as any,
      );
      const archiveKey = createOrgArchiveKey();
      const exportJob = await sourceRepository.createExportJob(
        sourceOrg.id,
        sourceOwner.id,
        encryption.encrypt(archiveKey.toString('base64')),
        wrapOrgArchiveKey(archiveKey, passphrase) as any,
      );
      archiveKey.fill(0);
      await exporter.processExport(exportJob.id);
      const completedExport = await sourceRepository.getJob(exportJob.id);
      expect(completedExport.status).toBe('completed');
      const archive = readFileSync(completedExport.spoolPath);
      expect(archive.toString('utf8')).not.toContain('access-token');
      expect(archive.toString('utf8')).not.toContain('client-secret');

      process.env.ENCRYPTION_KEY = 'destination-encryption-key-with-32-bytes';
      process.env.JWT_SECRET = 'destination-jwt-secret';
      const destinationRepository = new OrgImportRepository(destination as unknown as PrismaService);
      const portabilityRepository = new OrgPortabilityRepository(destination as unknown as PrismaService);
      const destinationAdapter = localAdapter(destinationStorage);
      const importer = new OrgImportService(
        portabilityRepository,
        destinationRepository,
        { getLocalAdapterForOrg: async () => destinationAdapter } as any,
        encryption,
        designerDoc as any,
        notifications as any,
        audit as any,
      );
      const upload = await importer.createUpload(destinationOrg.id, destinationOwner.id);
      await importer.appendChunk(destinationOrg.id, destinationOwner.id, upload.id, 0, archive.toString('base64'));
      const validated = await importer.validateUpload(destinationOrg.id, destinationOwner.id, upload.id, passphrase);
      expect(validated.missingAssets).toBe(1);
      await importer.commitImport(destinationOrg.id, destinationOwner.id, upload.id, passphrase);
      const pendingJob = await destinationRepository.getJob(upload.id);
      expect(pendingJob.status).toBe('pending');
      expect(pendingJob.archiveKeyCiphertext).toMatch(/^v2:/);
      expect(JSON.stringify(pendingJob)).not.toContain(passphrase);
      await importer.processImport(upload.id);

      const importedOrg = await destination.organization.findUnique({ where: { id: destinationOrg.id } });
      expect(importedOrg.name).toBe('Source Organization');
      expect(importedOrg.setupCompletedAt).not.toBeNull();
      expect(await destination.userOrganization.count({ where: { organizationId: destinationOrg.id } })).toBe(3);
      const importedSourceOwner = await destination.user.findFirst({ where: { email: 'owner@example.test' } });
      const ownerMembership = await destination.userOrganization.findFirst({
        where: { organizationId: destinationOrg.id, userId: importedSourceOwner.id },
        include: { roleRef: true },
      });
      expect(ownerMembership.roleRef.key).toBe('admin');
      const importedMember = await destination.user.findFirst({
        where: { email: 'member@example.test' },
        include: { profile: true },
      });
      expect(importedMember.profile.pictureId).toBeNull();
      expect(importedMember.profile.avatarUrl).toBeNull();
      const importedCustomRole = await destination.appRole.findFirst({
        where: { organizationId: destinationOrg.id, key: 'designer' },
        include: { permissions: true },
      });
      expect(importedCustomRole.permissions).toHaveLength(1);
      expect(importedCustomRole.permissions[0].permissionId).not.toBe(sourceIdentity.permission.id);

      const importedIntegration = await destination.integration.findFirst({ where: { organizationId: destinationOrg.id } });
      expect(importedIntegration.disabled).toBe(true);
      expect(encryption.decrypt(importedIntegration.token)).toBe('access-token');
      expect(encryption.decrypt(importedIntegration.refreshToken)).toBe('refresh-token');
      expect(encryption.decrypt(importedIntegration.customInstanceDetails)).toBe('{"instance":"private"}');
      const importedProvider = await destination.orgProviderConfiguration.findFirst({ where: { organizationId: destinationOrg.id } });
      expect(importedProvider.enabled).toBe(false);
      expect(encryption.decrypt(importedProvider.clientId)).toBe('client-id');
      expect(encryption.decrypt(importedProvider.clientSecret)).toBe('client-secret');
      expect(encryption.decrypt(importedProvider.additionalConfig)).toContain('signingSecret');
      const importedWebhook = await destination.webhooks.findFirst({
        where: { organizationId: destinationOrg.id },
        include: { integrations: true },
      });
      expect(importedWebhook.integrations.map((row: any) => row.id)).toEqual([importedIntegration.id]);

      expect(await destination.file.count({ where: { organizationId: destinationOrg.id } })).toBe(1);
      const importedFile = await destination.file.findFirst({ where: { organizationId: destinationOrg.id } });
      expect(importedFile.path.startsWith(destinationStorage)).toBe(true);
      expect(readFileSync(importedFile.path, 'utf8')).toBe('portable image bytes');
      const importedDesign = await destination.design.findFirst({ where: { organizationId: destinationOrg.id } });
      expect(importedDesign.previewFileId).toBeNull();
      expect(importedDesign.doc.outputs[0].children[0]).toMatchObject({ fileId: importedFile.id, src: importedFile.path });
      expect(importedDesign.doc.outputs[0].children[1]).toMatchObject({ fileId: null, src: null });
      const importedJob = await destinationRepository.getJob(upload.id);
      expect(importedJob.status).toBe('completed');
      expect(importedJob.archiveKeyCiphertext).toBeNull();
      expect(importedJob.spoolPath).toBeNull();
      expect(notifications.sendEmail).toHaveBeenCalledTimes(2);

      await importer.processImport(upload.id);
      expect(await destination.integration.count({ where: { organizationId: destinationOrg.id } })).toBe(1);
      expect(await destination.userOrganization.count({ where: { organizationId: destinationOrg.id } })).toBe(3);

      const rollbackOrg = await destination.organization.create({
        data: { name: 'Rollback Destination', setupCompletedAt: null },
      });
      await destination.userOrganization.create({
        data: {
          userId: destinationOwner.id,
          organizationId: rollbackOrg.id,
          roleId: (await destination.appRole.findFirst({ where: { key: 'owner' } })).id,
        },
      });
      const originalCreateModel = destinationRepository.createModel.bind(destinationRepository);
      const createModel = vi.spyOn(destinationRepository, 'createModel').mockImplementation(async (tx, model, data) => {
        if (model === 'integration') throw new Error('forced import rollback');
        return originalCreateModel(tx, model, data);
      });
      const rollbackUpload = await importer.createUpload(rollbackOrg.id, destinationOwner.id);
      await importer.appendChunk(rollbackOrg.id, destinationOwner.id, rollbackUpload.id, 0, archive.toString('base64'));
      await importer.validateUpload(rollbackOrg.id, destinationOwner.id, rollbackUpload.id, passphrase);
      await importer.commitImport(rollbackOrg.id, destinationOwner.id, rollbackUpload.id, passphrase);
      await importer.processImport(rollbackUpload.id);
      createModel.mockRestore();

      expect((await destinationRepository.getJob(rollbackUpload.id)).status).toBe('failed');
      expect((await destination.organization.findUnique({ where: { id: rollbackOrg.id } })).setupCompletedAt).toBeNull();
      expect(await destination.integration.count({ where: { organizationId: rollbackOrg.id } })).toBe(0);
      expect(await destination.file.count({ where: { organizationId: rollbackOrg.id } })).toBe(0);
      expect(await destination.userOrganization.count({ where: { organizationId: rollbackOrg.id } })).toBe(1);

      const nonEmptyOrg = await destination.organization.create({
        data: { name: 'Non-empty Destination', setupCompletedAt: null },
      });
      await destination.userOrganization.create({
        data: {
          userId: destinationOwner.id,
          organizationId: nonEmptyOrg.id,
          roleId: (await destination.appRole.findFirst({ where: { key: 'owner' } })).id,
        },
      });
      await destination.file.create({
        data: { organizationId: nonEmptyOrg.id, name: 'existing', path: 'existing-file' },
      });
      await expect(importer.createUpload(nonEmptyOrg.id, destinationOwner.id))
        .rejects.toThrow('empty destination');
    } finally {
      process.env = previous;
      await source.$disconnect();
      await destination.$disconnect();
      await sourceDb.drop();
      await destinationDb.drop();
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);
});
