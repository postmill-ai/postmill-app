import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import {
  appendFileSync,
  chmodSync,
  createReadStream,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { EncryptionService } from '@postmill-ai/nestjs-libraries/encryption/encryption.service';
import { AuditService } from '@postmill-ai/nestjs-libraries/database/prisma/audit/audit.service';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import { rewriteDocFileRefs, type FileRefRemap } from '@postmill-ai/nestjs-libraries/media/designer-doc/doc-file-refs';
import { inngest, isInngestEnabled } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { OrgPortabilityRepository } from './org-portability.repository';
import { OrgImportRepository, type OrgImportTransaction } from './org-import.repository';
import {
  extractOrgArchive,
  readOrgArchiveManifest,
  readOrgDomainRows,
  validateOrgArchiveWithKey,
  type OrgArchiveExtraction,
} from './org-import-archive';
import {
  decryptOrgSecretRefs,
  unwrapOrgArchiveKey,
  verifyOrgManifestMac,
} from './org-portability.crypto';
import {
  ORG_PORTABILITY_IMPORT_EVENT,
  ORG_PORTABILITY_REGENERATED_TOKEN_FIELDS,
  ORG_PORTABILITY_SECRET_FIELDS,
  orgPortabilityMaxArchiveBytes,
} from './org-portability.types';
import {
  lowerFirst,
  orgPortabilityImportOrder,
  orgPortabilityModelNames,
} from './org-portability.domains';

const CHUNK_BYTES = 8 * 1024 * 1024;
const INSERT_BATCH_SIZE = 500;
const FILE_ID_KEYS = new Set(['fileId', 'originalFileId', 'maskFileId', 'introFileId', 'outroFileId']);
const USER_FIELDS = new Set(['userId', 'createdById', 'ownerId', 'approvedById', 'assignedToId', 'resolvedById']);
const PROVIDER_CONFIGS = new Set([
  'StorageProviderConfig',
  'OrgProviderConfiguration',
  'AIOrgProviderConfig',
  'MediaProviderConfig',
  'OrgShortLinkConfig',
  'OrgVpnConfig',
  'CommsProviderConfig',
  'ContentPackConfig',
]);
const sha256File = async (filePath: string): Promise<string> => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
};
const safeError = (error: unknown): string =>
  ((error as Error)?.message || 'Organization import failed')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/data:\S+/gi, '[data]')
    .replace(/v2:\S+/gi, '[encrypted]')
    .replace(/\s+/g, ' ')
    .slice(0, 300);

interface AssetStage {
  sha256: string;
  path: string;
  mime: string;
  size: string;
}

interface MemberInvite {
  email: string;
  roleId: string;
}

interface ImportMaps {
  organizationId: string;
  defaultLocalProviderId: string | null;
  ids: Record<string, Map<string, string | null>>;
  roles: Map<string, string>;
  systemRoles: Map<string, string>;
  permissions: Map<string, string>;
  users: Map<string, string>;
  files: Map<string, FileRefRemap>;
  paths: Map<string, string | null>;
  videoFileIds: string[];
  ownerId: string;
  ownerEmail: string;
}

@Injectable()
export class OrgImportService {
  private readonly _logger = new Logger(OrgImportService.name);

  constructor(
    private readonly _portability: OrgPortabilityRepository,
    private readonly _repository: OrgImportRepository,
    private readonly _storage: StorageService,
    private readonly _encryption: EncryptionService,
    private readonly _designerDoc: DesignerDocService,
    private readonly _organizations: OrganizationService,
    private readonly _audit: AuditService,
  ) {}

  private _publicJob(job: any) {
    if (!job) return null;
    const { keyWrap: _keyWrap, stagedAssets: _stagedAssets, ...progress } = job.progress || {};
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      progress,
      archiveSha256: job.archiveSha256,
      expiresAt: job.expiresAt,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  private _spoolRoot(): string {
    return path.resolve(process.env.ORG_PORTABILITY_SPOOL_DIR || path.join(tmpdir(), 'postmill-org-archives'));
  }

  private async _assertOwner(orgId: string, ownerId: string): Promise<void> {
    if (!(await this._portability.isOwner(orgId, ownerId))) {
      throw new BadRequestException('Only an organization owner can import an organization.');
    }
  }

  private async _assertDestination(orgId: string): Promise<void> {
    const destination = await this._repository.destination(orgId);
    if (!destination.organization || destination.organization.setupCompletedAt) {
      throw new BadRequestException('Import is available only while organization setup is incomplete.');
    }
    if (destination.nonEmptyDomains.length) {
      throw new BadRequestException('Import requires an empty destination organization.');
    }
  }

  private async _ownedJob(orgId: string, ownerId: string, jobId: string) {
    const job = await this._portability.getOwnedJob(orgId, ownerId, jobId);
    if (!job || job.kind !== 'import') throw new NotFoundException('Organization import not found.');
    return job;
  }

  async createUpload(orgId: string, ownerId: string) {
    await this._assertOwner(orgId, ownerId);
    await this._assertDestination(orgId);
    const root = this._spoolRoot();
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const spoolPath = path.join(root, `${id}.zip`);
    writeFileSync(spoolPath, new Uint8Array(), { flag: 'wx', mode: 0o600 });
    const job = await this._repository.createUploadJob(orgId, ownerId, spoolPath);
    await this._audit.record({
      orgId,
      userId: ownerId,
      action: 'org.import.upload-started',
      resource: 'OrgPortabilityJob',
      resourceId: job.id,
    });
    return this._publicJob(job);
  }

  private async _withUploadLock<T>(jobId: string, work: () => Promise<T>): Promise<T> {
    const key = `org-portability:upload:${jobId}`;
    const token = randomUUID();
    const acquired = await ioRedis.set(key, token, 'PX', 30_000, 'NX');
    if (acquired !== 'OK') throw new BadRequestException('Another import chunk is being uploaded. Retry this chunk.');
    try {
      return await work();
    } finally {
      await ioRedis.eval(
        `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
        1,
        key,
        token,
      );
    }
  }

  async appendChunk(orgId: string, ownerId: string, jobId: string, offset: number, data: string) {
    await this._assertOwner(orgId, ownerId);
    const job = await this._ownedJob(orgId, ownerId, jobId);
    if (job.status !== 'uploading' || !job.spoolPath) {
      throw new NotFoundException('Organization import upload not found.');
    }
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > CHUNK_BYTES || !Number.isSafeInteger(offset) || offset < 0) {
      throw new BadRequestException('Invalid import chunk.');
    }
    return this._withUploadLock(jobId, async () => {
      if (statSync(job.spoolPath).size !== offset) {
        throw new BadRequestException('Import chunk offset does not match the uploaded bytes.');
      }
      if (BigInt(offset) + BigInt(bytes.length) > orgPortabilityMaxArchiveBytes()) {
        throw new BadRequestException('Archive exceeds the import size limit.');
      }
      appendFileSync(job.spoolPath, bytes, { mode: 0o600 });
      chmodSync(job.spoolPath, 0o600);
      const uploadedBytes = offset + bytes.length;
      await this._repository.updateProgress(jobId, { uploadedBytes });
      return { uploadedBytes };
    });
  }

  async getJob(orgId: string, ownerId: string, jobId: string) {
    await this._assertOwner(orgId, ownerId);
    return this._publicJob(await this._ownedJob(orgId, ownerId, jobId));
  }

  async validateUpload(orgId: string, ownerId: string, jobId: string, passphrase: string) {
    await this._assertOwner(orgId, ownerId);
    await this._assertDestination(orgId);
    if (!isInngestEnabled()) {
      throw new ServiceUnavailableException('Organization import requires Inngest background processing.');
    }
    const job = await this._ownedJob(orgId, ownerId, jobId);
    if (['validating', 'ready', 'pending', 'processing', 'completed'].includes(job.status)) {
      return this._publicJob(job);
    }
    if (job.status !== 'uploading' || !job.spoolPath) {
      throw new NotFoundException('Organization import upload not found.');
    }
    const manifest = readOrgArchiveManifest(job.spoolPath);
    let archiveKey: Buffer | undefined;
    try {
      archiveKey = unwrapOrgArchiveKey(manifest.crypto, passphrase);
    } catch {
      throw new BadRequestException('Archive passphrase is incorrect or the archive is damaged.');
    }
    try {
      const keyWrap = { kdf: manifest.crypto.kdf, wrappedKey: manifest.crypto.wrappedKey };
      const claimed = await this._repository.startValidation(
        jobId,
        this._encryption.encrypt(archiveKey.toString('base64')),
        {
          ...(job.progress as any),
          keyWrap,
          uploadedBytes: statSync(job.spoolPath).size,
        },
      );
      if (claimed.count !== 1) return this._publicJob(await this._repository.getJob(jobId));
    } finally {
      archiveKey?.fill(0);
    }
    try {
      await inngest.send({
        name: ORG_PORTABILITY_IMPORT_EVENT,
        data: { jobId, organizationId: orgId },
        id: `org-portability-validation-${jobId}-${randomUUID()}`,
      });
    } catch (error) {
      await this._repository.resetValidationJob(jobId);
      throw error;
    }
    await this._audit.record({
      orgId,
      userId: ownerId,
      action: 'org.import.validation-requested',
      resource: 'OrgPortabilityJob',
      resourceId: jobId,
    });
    return this._publicJob(await this._repository.getJob(jobId));
  }

  async commitImport(orgId: string, ownerId: string, jobId: string, passphrase: string) {
    await this._assertOwner(orgId, ownerId);
    await this._assertDestination(orgId);
    if (!isInngestEnabled()) {
      throw new ServiceUnavailableException('Organization import requires Inngest background processing.');
    }
    const job = await this._ownedJob(orgId, ownerId, jobId);
    if (['pending', 'processing', 'completed'].includes(job.status)) return this._publicJob(job);
    if (job.status !== 'ready' || !job.spoolPath || !job.archiveSha256 || !job.archiveKeyCiphertext) {
      throw new BadRequestException('Wait for background archive validation before starting import.');
    }
    const keyWrap = (job.progress as any)?.keyWrap;
    if (!keyWrap) throw new BadRequestException('Archive key metadata is missing. Validate the upload again.');
    let suppliedKey: Buffer | undefined;
    let storedKey: Buffer | undefined;
    try {
      suppliedKey = unwrapOrgArchiveKey(keyWrap, passphrase);
      storedKey = Buffer.from(this._encryption.decrypt(job.archiveKeyCiphertext), 'base64');
      if (suppliedKey.length !== storedKey.length || !timingSafeEqual(suppliedKey, storedKey)) {
        throw new BadRequestException('Archive passphrase is incorrect.');
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Archive passphrase is incorrect.');
    } finally {
      suppliedKey?.fill(0);
      storedKey?.fill(0);
    }
    const claimed = await this._repository.prepareCommit(jobId, job.progress || {});
    if (claimed.count !== 1) return this._publicJob(await this._repository.getJob(jobId));
    try {
      await inngest.send({
        name: ORG_PORTABILITY_IMPORT_EVENT,
        data: { jobId, organizationId: orgId },
        id: `org-portability-import-${jobId}`,
      });
    } catch (error) {
      await this._repository.resetPendingJob(jobId);
      throw error;
    }
    await this._audit.record({
      orgId,
      userId: ownerId,
      action: 'org.import.requested',
      resource: 'OrgPortabilityJob',
      resourceId: jobId,
    });
    return this._publicJob(await this._repository.getJob(jobId));
  }

  async processImport(jobId: string): Promise<void> {
    const validating = await this._repository.claimValidationJob(jobId);
    if (validating.count) {
      await this._processValidation(jobId);
      return;
    }
    let claimed = await this._repository.claimPendingJob(jobId);
    if (!claimed.count) claimed = await this._repository.claimProcessingJob(jobId);
    if (!claimed.count) return;
    const job = await this._repository.getJob(jobId);
    if (!job?.archiveKeyCiphertext || !job.spoolPath || !job.archiveSha256) return;

    let archiveKey: Buffer | undefined;
    let extraction: OrgArchiveExtraction | undefined;
    const stagedPaths: string[] = [];
    let committed = false;
    try {
      if ((await sha256File(job.spoolPath)) !== job.archiveSha256) {
        throw new BadRequestException('Archive checksum changed before background import.');
      }
      await this._assertDestination(job.organizationId);
      await this._cleanupStagedPaths(job.organizationId, (job.progress as any)?.stagedAssets || []);
      archiveKey = Buffer.from(this._encryption.decrypt(job.archiveKeyCiphertext), 'base64');
      extraction = await extractOrgArchive(job.spoolPath, path.dirname(job.spoolPath));
      if (!verifyOrgManifestMac(extraction.manifest, archiveKey)) {
        throw new BadRequestException('Archive integrity verification failed.');
      }
      const secretRefs = decryptOrgSecretRefs(extraction.manifest.crypto.secrets, archiveKey);
      archiveKey.fill(0);
      archiveKey = undefined;
      const stages = await this._stageAssets(jobId, extraction, job.organizationId, stagedPaths, job.progress || {});
      const secrets = new Map(secretRefs.map((secret) => [`${secret.model}:${secret.id}:${secret.field}`, secret.value]));
      const result = await this._repository.transaction(async (tx) => {
        const maps = await this._initialMaps(tx, job.organizationId, job.ownerId, extraction!, stages);
        await this._updateOrganization(tx, job.organizationId, extraction!);
        await this._importCustomRoles(tx, extraction!, maps);
        const invites = await this._mapMembers(extraction!, maps);
        for (const model of orgPortabilityImportOrder()) {
          await this._importModel(tx, model, extraction!, maps, secrets);
        }
        await this._importRelations(tx, extraction!, maps);
        await this._repository.updateOrganization(tx, job.organizationId, { setupCompletedAt: new Date() });
        await this._repository.completeJobInTransaction(tx, jobId, {
          counts: (job.progress as any)?.counts || {},
          source: extraction!.manifest.source,
          createdAt: extraction!.manifest.createdAt,
          missingAssets: extraction!.manifest.counts.missingAssets || 0,
          completedAt: new Date().toISOString(),
        });
        return { invites, videoFileIds: maps.videoFileIds, ownerEmail: maps.ownerEmail };
      });
      committed = true;
      rmSync(job.spoolPath, { force: true });
      await this._audit.record({
        orgId: job.organizationId,
        userId: job.ownerId,
        action: 'org.import.completed',
        resource: 'OrgPortabilityJob',
        resourceId: jobId,
        metadata: { counts: (job.progress as any)?.counts || {} },
      }).catch((error) => this._logger.warn(`Import audit failed for ${jobId}: ${safeError(error)}`));
      await this._sendInvitations(job.organizationId, job.ownerId, result.ownerEmail, result.invites);
      await this._regenerateThumbnails(jobId, job.organizationId, result.videoFileIds);
    } catch (error) {
      if (!committed) {
        await this._cleanupStagedPaths(job.organizationId, stagedPaths);
        rmSync(job.spoolPath, { force: true });
        const message = safeError(error);
        this._logger.warn(`Organization import ${jobId} failed: ${message}`);
        await this._repository.failJob(jobId, message, { archiveSha256: job.archiveSha256 });
      } else {
        this._logger.warn(`Organization import ${jobId} completed with a follow-up error: ${safeError(error)}`);
      }
    } finally {
      archiveKey?.fill(0);
      if (extraction) rmSync(extraction.directory, { recursive: true, force: true });
    }
  }

  private async _processValidation(jobId: string): Promise<void> {
    const job = await this._repository.getJob(jobId);
    if (!job?.archiveKeyCiphertext || !job.spoolPath) return;
    let archiveKey: Buffer | undefined;
    try {
      const archiveSha256 = await sha256File(job.spoolPath);
      archiveKey = Buffer.from(this._encryption.decrypt(job.archiveKeyCiphertext), 'base64');
      const validation = await validateOrgArchiveWithKey(job.spoolPath, archiveKey);
      await this._repository.completeValidation(jobId, archiveSha256, {
        keyWrap: (job.progress as any)?.keyWrap,
        counts: validation.domainCounts,
        source: validation.manifest.source,
        createdAt: validation.manifest.createdAt,
        missingAssets: validation.manifest.counts.missingAssets || 0,
      });
    } catch (error) {
      const message = safeError(error);
      this._logger.warn(`Organization import validation ${jobId} failed: ${message}`);
      if (error instanceof BadRequestException || (error as any)?.code === 'ENOENT') {
        rmSync(job.spoolPath, { force: true });
        await this._repository.failJob(jobId, message, { archiveSha256: job.archiveSha256 });
      } else {
        await this._repository.retryValidationJob(jobId, message, job.progress || {});
      }
    } finally {
      archiveKey?.fill(0);
    }
  }

  private async _cleanupStagedPaths(orgId: string, stagedPaths: string[]): Promise<void> {
    try {
      const adapter = await this._storage.getLocalAdapterForOrg(orgId, false);
      for (const stagedPath of new Set(stagedPaths)) {
        try {
          await adapter.removeFile(stagedPath);
        } catch {
          // Preserve the original import failure.
        }
      }
    } catch {
      // Storage setup can be the original failure; job cleanup still runs.
    }
  }

  private async _stageAssets(
    jobId: string,
    extraction: OrgArchiveExtraction,
    orgId: string,
    stagedPaths: string[],
    progress: Prisma.JsonValue,
  ): Promise<Record<string, AssetStage>> {
    const adapter = await this._storage.getLocalAdapterForOrg(orgId, false);
    const stages: Record<string, AssetStage> = {};
    const byHash = new Map<string, AssetStage>();
    for (const asset of Object.values(extraction.manifest.assets)) {
      if (asset.missing) continue;
      const existing = byHash.get(asset.sha256);
      if (existing) {
        stages[asset.fileId] = existing;
        continue;
      }
      const source = extraction.assetPaths[asset.sha256];
      if (!source || BigInt(statSync(source).size) !== BigInt(asset.size)) {
        throw new BadRequestException('Archive asset is missing.');
      }
      const uploadedPath = await adapter.writeFileStream(source, asset.mime);
      const stage = { sha256: asset.sha256, path: uploadedPath, mime: asset.mime, size: asset.size };
      stagedPaths.push(uploadedPath);
      await this._repository.updateProgress(jobId, {
        ...(progress as any),
        stagedAssets: [...stagedPaths],
      });
      byHash.set(asset.sha256, stage);
      stages[asset.fileId] = stage;
    }
    return stages;
  }

  private async _initialMaps(
    tx: OrgImportTransaction,
    orgId: string,
    ownerId: string,
    extraction: OrgArchiveExtraction,
    assets: Record<string, AssetStage>,
  ): Promise<ImportMaps> {
    const [systemRoles, permissions, owner, localProvider] = await Promise.all([
      this._repository.systemRoles(tx),
      this._repository.permissions(tx),
      this._repository.userById(tx, ownerId),
      this._repository.defaultLocalProvider(tx, orgId),
    ]);
    if (!owner) throw new BadRequestException('Importing owner account not found.');
    const maps: ImportMaps = {
      organizationId: orgId,
      defaultLocalProviderId: localProvider?.id || null,
      ids: Object.fromEntries([...orgPortabilityModelNames(), 'customRoles'].map((model) => [model, new Map<string, string | null>()])),
      roles: new Map(),
      systemRoles: new Map(systemRoles.map((role) => [role.key, role.id])),
      permissions: new Map(permissions.map((permission) => [`${permission.resource}:${permission.action}`, permission.id])),
      users: new Map(),
      files: new Map(),
      paths: new Map(),
      videoFileIds: [],
      ownerId,
      ownerEmail: owner.email.toLowerCase(),
    };
    for (const source of await readOrgDomainRows(extraction, 'customRoles')) {
      const id = randomUUID();
      maps.ids.customRoles.set(source.id, id);
      maps.roles.set(source.id, id);
    }
    for (const model of orgPortabilityModelNames()) {
      for (const source of await readOrgDomainRows(extraction, model)) {
        if (!source.id) throw new BadRequestException(`Archive ${model} row has no id.`);
        if (model === 'StorageProviderConfig' && source.type === 'LOCAL' && maps.defaultLocalProviderId) {
          maps.ids.StorageProviderConfig.set(source.id, maps.defaultLocalProviderId);
          continue;
        }
        if (model === 'File' && extraction.manifest.assets[source.id]?.missing) {
          maps.ids.File.set(source.id, null);
          maps.paths.set(source.path, null);
          continue;
        }
        const id = randomUUID();
        maps.ids[model].set(source.id, id);
        if (model === 'File') {
          const stage = assets[source.id];
          if (!stage) throw new BadRequestException('Archive file bytes are missing.');
          maps.files.set(source.id, { id, path: stage.path });
          maps.paths.set(source.path, stage.path);
          if (source.type === 'video' || stage.mime.startsWith('video/')) maps.videoFileIds.push(id);
        }
      }
    }
    for (const asset of Object.values(extraction.manifest.assets)) {
      if (asset.kind !== 'font') continue;
      if (asset.missing) {
        maps.paths.set(asset.sourcePath!, null);
        continue;
      }
      const stage = assets[asset.fileId];
      if (!stage) throw new BadRequestException('Archive font bytes are missing.');
      maps.paths.set(asset.sourcePath!, stage.path);
    }
    return maps;
  }

  private async _updateOrganization(
    tx: OrgImportTransaction,
    orgId: string,
    extraction: OrgArchiveExtraction,
  ): Promise<void> {
    const [source] = await readOrgDomainRows(extraction, 'organization');
    if (!source) throw new BadRequestException('Archive organization metadata is missing.');
    await this._repository.updateOrganization(tx, orgId, {
      name: source.name,
      description: source.description,
      streakSince: source.streakSince ? new Date(source.streakSince) : null,
      shortlink: source.shortlink,
      activeContentPackIdentifier: source.activeContentPackIdentifier,
      aiBudgetMonthlyCap: source.aiBudgetMonthlyCap,
      aiBudgetDailyCap: source.aiBudgetDailyCap,
      aiBudgetAlertThresholdPct: source.aiBudgetAlertThresholdPct,
    });
  }

  private async _importCustomRoles(
    tx: OrgImportTransaction,
    extraction: OrgArchiveExtraction,
    maps: ImportMaps,
  ): Promise<void> {
    const roles: Record<string, unknown>[] = [];
    const assignments: Record<string, unknown>[] = [];
    for (const source of await readOrgDomainRows(extraction, 'customRoles')) {
      const roleId = maps.roles.get(source.id)!;
      roles.push({
        id: roleId,
        organizationId: maps.organizationId,
        key: source.key,
        name: source.name,
        description: source.description,
        isSystem: false,
        createdAt: source.createdAt ? new Date(source.createdAt) : undefined,
        updatedAt: source.updatedAt ? new Date(source.updatedAt) : undefined,
      });
      for (const assignment of source.permissions || []) {
        const permissionId = maps.permissions.get(`${assignment.permission.resource}:${assignment.permission.action}`);
        if (!permissionId) throw new BadRequestException('Archive role permission is unavailable on this deployment.');
        assignments.push({ roleId, permissionId });
      }
    }
    if (roles.length) await this._repository.createManyModel(tx, 'appRole', roles);
    for (let offset = 0; offset < assignments.length; offset += INSERT_BATCH_SIZE) {
      await this._repository.createManyModel(tx, 'appRolePermission', assignments.slice(offset, offset + INSERT_BATCH_SIZE));
    }
  }

  private _mapJson(value: unknown, maps: ImportMaps): any {
    const rewritten = rewriteDocFileRefs(value, maps.files);
    const walk = (node: any, key = ''): any => {
      if (typeof node === 'string') return maps.paths.has(node) ? maps.paths.get(node) : node;
      if (!node || typeof node !== 'object') return node;
      if (Array.isArray(node)) {
        if (key === 'integrations') return node.map((id) => maps.ids.Integration.get(id) ?? null);
        if (key === 'mentions') return node.map((id) => maps.users.get(id) || maps.ownerId);
        if (key === 'logoFileIds') return node.map((id) => maps.ids.File.get(id) ?? null);
        return node.map((item) => walk(item));
      }
      const result = Object.fromEntries(Object.entries(node).map(([childKey, item]) => {
        if (FILE_ID_KEYS.has(childKey) && typeof item === 'string' && maps.ids.File.has(item)) {
          return [childKey, maps.ids.File.get(item) ?? null];
        }
        return [childKey, walk(item, childKey)];
      }));
      for (const fileKey of FILE_ID_KEYS) {
        const sourceId = node[fileKey];
        if (typeof sourceId !== 'string' || !maps.ids.File.has(sourceId)) continue;
        const mapped = maps.ids.File.get(sourceId) ?? null;
        for (const paired of ['src', 'originalSrc', 'maskSrc', 'url', 'path']) {
          if (paired in node) result[paired] = mapped ? maps.paths.get(node[paired]) ?? node[paired] : null;
        }
      }
      return result;
    };
    return walk(rewritten);
  }

  private _mapRow(
    model: string,
    source: any,
    maps: ImportMaps,
    secrets: Map<string, string>,
  ): any {
    const definition = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === model);
    if (!definition) throw new BadRequestException(`Archive model ${model} is not supported.`);
    const row: Record<string, any> = { id: maps.ids[model].get(source.id) };
    for (const field of definition.fields) {
      if (field.kind !== 'scalar' || field.name === 'id' || source[field.name] === undefined) continue;
      let value = source[field.name];
      if (value !== null && field.type === 'DateTime') value = new Date(value);
      if (value !== null && field.type === 'Json') value = this._mapJson(value, maps);
      if (value !== null && field.type === 'Bytes') value = Buffer.from(value, 'base64');
      if (value !== null && field.type === 'BigInt') value = BigInt(value);
      row[field.name] = value;
    }
    if ('organizationId' in row) row.organizationId = maps.organizationId;
    if ('orgId' in row) row.orgId = maps.organizationId;
    for (const field of ['path', 'thumbnail', 'avatarUrl', 'src', 'maskSrc', 'url', 'originalUrl', 'shortUrl', 'signedUrl', 'picture']) {
      if (typeof row[field] === 'string' && maps.paths.has(row[field])) row[field] = maps.paths.get(row[field]);
    }

    const relatedFields = new Set(definition.fields.flatMap((field) => field.relationFromFields || []));
    for (const relation of definition.fields) {
      if (fieldIsScalarRelation(relation)) {
        for (let index = 0; index < relation.relationFromFields!.length; index++) {
          const field = relation.relationFromFields![index];
          const old = row[field];
          if (old === null || old === undefined || old === '') continue;
          if (relation.type === 'Organization') {
            row[field] = maps.organizationId;
            continue;
          }
          if (relation.type === 'User') {
            row[field] = maps.users.get(old) || maps.ownerId;
            continue;
          }
          const mapped = maps.ids[relation.type]?.get(old);
          if (mapped === undefined) throw new BadRequestException(`Could not remap ${model}.${field}.`);
          if (mapped === null && definition.fields.find((candidate) => candidate.name === field)?.isRequired) {
            throw new BadRequestException(`Required asset for ${model}.${field} is missing.`);
          }
          row[field] = mapped;
        }
      }
    }
    for (const field of USER_FIELDS) {
      if (!relatedFields.has(field) && field in row && row[field]) {
        row[field] = maps.users.get(row[field]) || maps.ownerId;
      }
    }
    if (model === 'ShortLink' && row.postId) row.postId = maps.ids.Post.get(row.postId) ?? null;
    for (const field of ['defaultFolderId', 'storageRootFolderId']) {
      if (field in row && row[field]) row[field] = maps.ids.FileFolder.get(row[field]) ?? null;
    }
    for (const field of ['introFileId', 'outroFileId']) {
      if (field in row && row[field]) row[field] = maps.ids.File.get(row[field]) ?? null;
    }
    if (model === 'CampaignItem') {
      const target = {
        POST: 'Post',
        INTEGRATION: 'Integration',
        ORG_VPN_CONFIG: 'OrgVpnConfig',
        AI_ORG_PROVIDER_CONFIG: 'AIOrgProviderConfig',
        AI_BRAND_PROFILE: 'AIBrandProfile',
        STORAGE_PROVIDER_CONFIG: 'StorageProviderConfig',
        FILE: 'File',
        SETS: 'Sets',
        SIGNATURES: 'Signatures',
      }[row.entityType as string];
      if (target) row.entityId = maps.ids[target]?.get(row.entityId) ?? null;
    }
    if (model === 'FileFolder') row.storageProviderId = null;
    if (model === 'AIPromptTemplate') row.globalKey = null;
    if (model === 'AIBrandProfile' && Array.isArray(row.customFonts)) {
      row.customFonts = row.customFonts.filter((font: any) => typeof font?.path === 'string' && font.path);
    }
    if (model === 'File') {
      row.thumbnail = null;
      row.thumbnailTimestamp = null;
    }

    for (const field of ORG_PORTABILITY_SECRET_FIELDS[model] || []) {
      const value = secrets.get(`${model}:${source.id}:${field}`);
      row[field] = value !== undefined
        ? this._encryption.encrypt(value)
        : definition.fields.find((candidate) => candidate.name === field)?.isRequired ? '' : null;
    }
    for (const field of ORG_PORTABILITY_REGENERATED_TOKEN_FIELDS[model] || []) {
      if (model === 'CommsProviderConfig') row[field] = randomBytes(24).toString('base64url');
      else if (model === 'AnalyticsShare') row[field] = randomBytes(32).toString('hex');
      else row[field] = null;
    }
    if (model === 'Integration') Object.assign(row, { disabled: true, inBetweenSteps: false, refreshNeeded: false });
    if (model === 'AutoPost') row.active = false;
    if (model === 'Plugs') row.activated = false;
    if (model === 'Post' && row.state !== 'PUBLISHED') row.state = 'DRAFT';
    if (model === 'Campaign') row.shareEnabled = false;
    if (model === 'AnalyticsShare') row.enabled = false;
    if (PROVIDER_CONFIGS.has(model)) {
      if ('enabled' in row) row.enabled = false;
      if ('isActive' in row) row.isActive = false;
      if ('mounted' in row) row.mounted = false;
    }
    for (const field of ['doc', 'config', 'brief', 'content', 'metadata', 'extraConfig', 'settings', 'additionalSettings', 'knowledge', 'data', 'inputJson', 'provenance']) {
      if (typeof row[field] === 'string') {
        const text = row[field].trim();
        if (text.startsWith('{') || text.startsWith('[')) {
          try {
            row[field] = JSON.stringify(this._mapJson(JSON.parse(row[field]), maps));
          } catch {
            // Ordinary text is not a JSON carrier.
          }
        }
      }
    }
    return row;
  }

  private _dependencyRows(model: string, rows: any[]): any[] {
    const definition = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === model);
    const selfRelation = definition?.fields.find((field) => field.type === model && field.relationFromFields?.length);
    const parentField = selfRelation?.relationFromFields?.[0];
    if (!parentField) return rows;
    const byId = new Map(rows.map((row) => [row.id, row]));
    const depth = (row: any, seen = new Set<string>()): number => {
      const parent = row[parentField];
      if (!parent || !byId.has(parent) || seen.has(row.id)) return 0;
      seen.add(row.id);
      return 1 + depth(byId.get(parent), seen);
    };
    return [...rows].sort((a, b) => depth(a) - depth(b));
  }

  private async _importModel(
    tx: OrgImportTransaction,
    model: string,
    extraction: OrgArchiveExtraction,
    maps: ImportMaps,
    secrets: Map<string, string>,
  ): Promise<void> {
    const mappedRows: Record<string, unknown>[] = [];
    for (const source of this._dependencyRows(model, await readOrgDomainRows(extraction, model))) {
      if (model === 'File' && extraction.manifest.assets[source.id]?.missing) continue;
      if (model === 'StorageProviderConfig' && source.type === 'LOCAL' && maps.defaultLocalProviderId) continue;
      const row = this._mapRow(model, source, maps, secrets);
      if (model === 'File') {
        const stage = maps.files.get(source.id)!;
        row.path = stage.path;
        row.fileSize = Number(extraction.manifest.assets[source.id].size);
      }
      if (['Design', 'DesignVersion', 'DesignTemplate'].includes(model) && row.doc) {
        row.doc = this._designerDoc.assignIdsAndNormalize(
          this._designerDoc.stripIds(this._mapJson(row.doc, maps)),
        );
      }
      mappedRows.push(row);
    }
    for (let offset = 0; offset < mappedRows.length; offset += INSERT_BATCH_SIZE) {
      await this._repository.createManyModel(tx, lowerFirst(model), mappedRows.slice(offset, offset + INSERT_BATCH_SIZE));
    }
  }

  private async _mapMembers(
    extraction: OrgArchiveExtraction,
    maps: ImportMaps,
  ): Promise<MemberInvite[]> {
    const invites: MemberInvite[] = [];
    for (const membership of await readOrgDomainRows(extraction, 'members')) {
      const email = String(membership.user?.email || '').toLowerCase();
      if (!email) throw new BadRequestException('Archive member has no email.');
      maps.users.set(membership.userId, maps.ownerId);
      if (membership.disabled || email === maps.ownerEmail) continue;
      const customRole = maps.roles.get(membership.roleId);
      const roleKey = membership.roleRef?.key === 'owner' ? 'admin' : membership.roleRef?.key;
      const roleId = customRole || maps.systemRoles.get(roleKey || 'member');
      if (!roleId) throw new BadRequestException('Archive member role is unavailable on this deployment.');
      invites.push({ email, roleId });
    }
    return invites;
  }

  private async _importRelations(
    tx: OrgImportTransaction,
    extraction: OrgArchiveExtraction,
    maps: ImportMaps,
  ): Promise<void> {
    const tagRows = (await readOrgDomainRows(extraction, 'tagsPosts')).map((source) => ({
      postId: maps.ids.Post.get(source.postId),
      tagId: maps.ids.Tags.get(source.tagId),
      createdAt: source.createdAt ? new Date(source.createdAt) : undefined,
      updatedAt: source.updatedAt ? new Date(source.updatedAt) : undefined,
    }));
    for (let offset = 0; offset < tagRows.length; offset += INSERT_BATCH_SIZE) {
      await this._repository.createManyModel(tx, 'tagsPosts', tagRows.slice(offset, offset + INSERT_BATCH_SIZE));
    }
    const commentReads = (await readOrgDomainRows(extraction, 'postCommentRead')).map((source) => ({
      id: randomUUID(),
      postId: maps.ids.Post.get(source.postId),
      userId: maps.users.get(source.userId) || maps.ownerId,
      lastReadAt: new Date(source.lastReadAt),
      lastReadCount: source.lastReadCount,
      updatedAt: source.updatedAt ? new Date(source.updatedAt) : undefined,
    }));
    for (let offset = 0; offset < commentReads.length; offset += INSERT_BATCH_SIZE) {
      await this._repository.createManyModel(tx, 'postCommentRead', commentReads.slice(offset, offset + INSERT_BATCH_SIZE));
    }
    const notificationReads = (await readOrgDomainRows(extraction, 'notificationRead')).map((source) => ({
      id: randomUUID(),
      notificationId: maps.ids.Notifications.get(source.notificationId),
      userId: maps.users.get(source.userId) || maps.ownerId,
      readAt: source.readAt ? new Date(source.readAt) : undefined,
    }));
    for (let offset = 0; offset < notificationReads.length; offset += INSERT_BATCH_SIZE) {
      await this._repository.createManyModel(tx, 'notificationRead', notificationReads.slice(offset, offset + INSERT_BATCH_SIZE));
    }
    const webhooks = new Map<string, string[]>();
    for (const source of await readOrgDomainRows(extraction, 'integrationWebhooks')) {
      const webhookId = maps.ids.Webhooks.get(source.webhookId);
      const integrationId = maps.ids.Integration.get(source.integrationId);
      if (!webhookId || !integrationId) continue;
      webhooks.set(webhookId, [...(webhooks.get(webhookId) || []), integrationId]);
    }
    for (const [webhookId, integrationIds] of webhooks) {
      await this._repository.connectIntegrationWebhooks(tx, webhookId, integrationIds);
    }
  }

  private async _sendInvitations(
    orgId: string,
    ownerId: string,
    ownerEmail: string,
    invites: MemberInvite[],
  ): Promise<void> {
    const actor = { id: ownerId, email: ownerEmail, isSuperAdmin: false } as User;
    for (const invite of invites) {
      try {
        await this._organizations.inviteTeamMember(orgId, actor, {
          email: invite.email,
          roleId: invite.roleId,
          sendEmail: true,
        });
      } catch (error) {
        this._logger.warn(`Imported member invitation failed: ${safeError(error)}`);
      }
    }
  }

  private async _regenerateThumbnails(jobId: string, orgId: string, fileIds: string[]): Promise<void> {
    for (const fileId of fileIds) {
      try {
        await inngest.send({
          name: 'media/video-thumbnail.generate',
          data: { organizationId: orgId, fileId },
          id: `org-portability-thumbnail-${jobId}-${fileId}`,
        });
      } catch (error) {
        this._logger.warn(`Imported video thumbnail scheduling failed for ${jobId}: ${safeError(error)}`);
      }
    }
  }
}

const fieldIsScalarRelation = (
  field: Prisma.DMMF.Field,
): boolean => field.kind === 'object' && !!field.relationFromFields?.length;
