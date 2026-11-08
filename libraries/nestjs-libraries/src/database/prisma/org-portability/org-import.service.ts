import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
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
import { NotificationService } from '@postmill-ai/nestjs-libraries/database/prisma/notifications/notification.service';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import { rewriteDocFileRefs, type FileRefRemap } from '@postmill-ai/nestjs-libraries/media/designer-doc/doc-file-refs';
import { AuthService } from '@postmill-ai/helpers/auth/auth.service';
import { inngest, isInngestEnabled } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { OrgPortabilityRepository } from './org-portability.repository';
import { OrgImportRepository, type OrgImportTransaction } from './org-import.repository';
import {
  extractOrgArchive,
  readOrgDomainRows,
  validateOrgArchive,
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
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character]!));

interface AssetStage {
  sha256: string;
  path: string;
  mime: string;
  size: string;
}

interface ImportMaps {
  organizationId: string;
  ids: Record<string, Map<string, string | null>>;
  roles: Map<string, string>;
  systemRoles: Map<string, string>;
  permissions: Map<string, string>;
  users: Map<string, string>;
  files: Map<string, FileRefRemap>;
  paths: Map<string, string | null>;
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
    private readonly _notifications: NotificationService,
    private readonly _audit: AuditService,
  ) {}

  private _publicJob(job: any) {
    if (!job) return null;
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      progress: job.progress,
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
    const job = await this._ownedJob(orgId, ownerId, jobId);
    if (job.status !== 'uploading' || !job.spoolPath) {
      throw new NotFoundException('Organization import upload not found.');
    }
    const archiveSha256 = await sha256File(job.spoolPath);
    const validation = await validateOrgArchive(job.spoolPath, passphrase);
    const progress = {
      uploadedBytes: statSync(job.spoolPath).size,
      counts: validation.domainCounts,
      archiveSha256,
    };
    const updated = await this._repository.markValidated(jobId, archiveSha256, progress);
    if (updated.count !== 1) throw new BadRequestException('Import upload state changed. Retry validation.');
    return {
      counts: validation.domainCounts,
      source: validation.manifest.source,
      createdAt: validation.manifest.createdAt,
      missingAssets: validation.manifest.counts.missingAssets || 0,
    };
  }

  async commitImport(orgId: string, ownerId: string, jobId: string, passphrase: string) {
    await this._assertOwner(orgId, ownerId);
    await this._assertDestination(orgId);
    if (!isInngestEnabled()) {
      throw new ServiceUnavailableException('Organization import requires Inngest background processing.');
    }
    const job = await this._ownedJob(orgId, ownerId, jobId);
    if (['pending', 'processing', 'completed'].includes(job.status)) return this._publicJob(job);
    if (job.status !== 'uploading' || !job.spoolPath || !job.archiveSha256) {
      throw new BadRequestException('Validate the uploaded archive before starting import.');
    }
    if ((await sha256File(job.spoolPath)) !== job.archiveSha256) {
      throw new BadRequestException('Archive checksum changed after validation. Upload it again.');
    }
    const validation = await validateOrgArchive(job.spoolPath, passphrase);
    let archiveKey: Buffer | undefined;
    try {
      archiveKey = unwrapOrgArchiveKey(validation.manifest.crypto, passphrase);
      const ciphertext = this._encryption.encrypt(archiveKey.toString('base64'));
      const claimed = await this._repository.prepareCommit(jobId, ciphertext, {
        counts: validation.domainCounts,
        archiveSha256: job.archiveSha256,
      });
      if (claimed.count !== 1) {
        return this._publicJob(await this._repository.getJob(jobId));
      }
    } finally {
      archiveKey?.fill(0);
    }
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
    let claimed = await this._repository.claimPendingJob(jobId);
    if (!claimed.count) claimed = await this._repository.claimProcessingJob(jobId);
    if (!claimed.count) return;
    const job = await this._repository.getJob(jobId);
    if (!job?.archiveKeyCiphertext || !job.spoolPath || !job.archiveSha256) return;

    let archiveKey: Buffer | undefined;
    let extraction: OrgArchiveExtraction | undefined;
    const stagedPaths: string[] = [];
    let committed = false;
    let organizationName = 'your organization';
    try {
      if ((await sha256File(job.spoolPath)) !== job.archiveSha256) {
        throw new BadRequestException('Archive checksum changed before background import.');
      }
      await this._assertDestination(job.organizationId);
      archiveKey = Buffer.from(this._encryption.decrypt(job.archiveKeyCiphertext), 'base64');
      extraction = await extractOrgArchive(job.spoolPath, path.dirname(job.spoolPath));
      if (!verifyOrgManifestMac(extraction.manifest, archiveKey)) {
        throw new BadRequestException('Archive integrity verification failed.');
      }
      const secretRefs = decryptOrgSecretRefs(extraction.manifest.crypto.secrets, archiveKey);
      archiveKey.fill(0);
      archiveKey = undefined;
      organizationName = extraction.manifest.source.name || organizationName;
      const stages = await this._stageAssets(extraction, job.organizationId, stagedPaths);
      const secrets = new Map(secretRefs.map((secret) => [`${secret.model}:${secret.id}:${secret.field}`, secret.value]));
      const invited = await this._repository.transaction(async (tx) => {
        const maps = await this._initialMaps(tx, job.organizationId, job.ownerId, extraction!, stages);
        await this._updateOrganization(tx, job.organizationId, extraction!);
        await this._importCustomRoles(tx, extraction!, maps);
        const invitedUsers = await this._importMembers(tx, job.organizationId, maps, extraction!);
        for (const model of orgPortabilityImportOrder()) {
          await this._importModel(tx, model, extraction!, maps, secrets);
        }
        await this._importRelations(tx, extraction!, maps);
        await this._restoreProfilePictures(tx, maps, invitedUsers.profilePictures);
        await this._repository.updateOrganization(tx, job.organizationId, { setupCompletedAt: new Date() });
        const progress = {
          counts: this._publicJob(job).progress?.counts || {},
          missingAssets: extraction!.manifest.counts.missingAssets || 0,
          completedAt: new Date().toISOString(),
        };
        await this._repository.completeJobInTransaction(tx, jobId, progress);
        return invitedUsers.invited;
      });
      committed = true;
      rmSync(job.spoolPath, { force: true });
      await this._audit.record({
        orgId: job.organizationId,
        userId: job.ownerId,
        action: 'org.import.completed',
        resource: 'OrgPortabilityJob',
        resourceId: jobId,
        metadata: { counts: this._publicJob(job).progress?.counts || {} },
      }).catch((error) => this._logger.warn(`Import audit failed for ${jobId}: ${safeError(error)}`));
      await this._sendInvitations(organizationName, invited);
    } catch (error) {
      if (!committed) {
        try {
          const adapter = await this._storage.getLocalAdapterForOrg(job.organizationId, false);
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

  private async _stageAssets(
    extraction: OrgArchiveExtraction,
    orgId: string,
    stagedPaths: string[],
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
      const uploaded = await adapter.uploadFile({
        path: source,
        size: Number(asset.size),
        originalname: asset.sha256,
        mimetype: asset.mime,
      } as any);
      const stage = { sha256: asset.sha256, path: uploaded.path, mime: asset.mime, size: asset.size };
      stagedPaths.push(uploaded.path);
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
    const [systemRoles, permissions, owner] = await Promise.all([
      this._repository.systemRoles(tx),
      this._repository.permissions(tx),
      this._repository.userById(tx, ownerId),
    ]);
    if (!owner) throw new BadRequestException('Importing owner account not found.');
    const maps: ImportMaps = {
      organizationId: orgId,
      ids: Object.fromEntries([...orgPortabilityModelNames(), 'customRoles'].map((model) => [model, new Map<string, string | null>()])),
      roles: new Map(),
      systemRoles: new Map(systemRoles.map((role) => [role.key, role.id])),
      permissions: new Map(permissions.map((permission) => [`${permission.resource}:${permission.action}`, permission.id])),
      users: new Map(),
      files: new Map(),
      paths: new Map(),
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
        }
      }
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
    for (const source of await readOrgDomainRows(extraction, 'customRoles')) {
      const roleId = maps.roles.get(source.id)!;
      await this._repository.createModel(tx, 'appRole', {
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
        await this._repository.createModel(tx, 'appRolePermission', { roleId, permissionId });
      }
    }
  }

  private _mapJson(value: unknown, maps: ImportMaps): any {
    const rewritten = rewriteDocFileRefs(value, maps.files);
    const walk = (node: any, key = ''): any => {
      if (typeof node === 'string') return maps.paths.has(node) ? maps.paths.get(node) : node;
      if (!node || typeof node !== 'object') return node;
      if (Array.isArray(node)) {
        if (key === 'integrations') return node.map((id) => maps.ids.Integration.get(id) ?? null);
        if (key === 'mentions') return node.map((id) => maps.users.get(id) || null);
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
            const mapped = maps.users.get(old);
            if (!mapped && definition.fields.find((candidate) => candidate.name === field)?.isRequired) {
              throw new BadRequestException(`Could not remap ${model}.${field}.`);
            }
            row[field] = mapped || null;
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
        row[field] = maps.users.get(row[field]) || null;
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
    const rows = await readOrgDomainRows(extraction, model);
    for (const source of this._dependencyRows(model, rows)) {
      if (model === 'File' && extraction.manifest.assets[source.id]?.missing) continue;
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
      await this._repository.createModel(tx, lowerFirst(model), row);
    }
  }

  private async _importMembers(
    tx: OrgImportTransaction,
    orgId: string,
    maps: ImportMaps,
    extraction: OrgArchiveExtraction,
  ): Promise<{
    invited: { id: string; email: string }[];
    profilePictures: Map<string, string>;
  }> {
    const invited: { id: string; email: string }[] = [];
    const profilePictures = new Map<string, string>();
    for (const membership of await readOrgDomainRows(extraction, 'members')) {
      const email = String(membership.user?.email || '').toLowerCase();
      if (!email) throw new BadRequestException('Archive member has no email.');
      let userId = email === maps.ownerEmail ? maps.ownerId : undefined;
      if (!userId) userId = (await this._repository.userByEmail(tx, email))?.id;
      if (!userId) {
        const profile = membership.user.profile || {};
        const created = await this._repository.createUser(tx, {
          email,
          providerName: 'LOCAL',
          password: null,
          activated: false,
          profile: {
            create: {
              name: profile.name,
              lastName: profile.lastName,
              bio: profile.bio,
              avatarUrl: maps.paths.has(profile.avatarUrl) ? maps.paths.get(profile.avatarUrl) : profile.avatarUrl,
              timezone: profile.timezone,
              preferredLanguage: profile.preferredLanguage,
            },
          },
          ...(membership.user.notificationPreference ? {
            notificationPreference: {
              create: {
                masters: membership.user.notificationPreference.masters,
                categories: membership.user.notificationPreference.categories,
                digestFrequency: membership.user.notificationPreference.digestFrequency,
              },
            },
          } : {}),
        });
        userId = created.id;
        invited.push({ id: created.id, email });
        if (profile.pictureId) profilePictures.set(userId, profile.pictureId);
      }
      maps.users.set(membership.userId, userId);
      if (userId === maps.ownerId) continue;
      const customRole = maps.roles.get(membership.roleId);
      const roleKey = membership.roleRef?.key === 'owner' ? 'admin' : membership.roleRef?.key;
      const roleId = customRole || maps.systemRoles.get(roleKey || 'member');
      if (!roleId) throw new BadRequestException('Archive member role is unavailable on this deployment.');
      await this._repository.createModel(tx, 'userOrganization', {
        id: randomUUID(),
        userId,
        organizationId: orgId,
        roleId,
        disabled: membership.disabled,
        createdAt: membership.createdAt ? new Date(membership.createdAt) : undefined,
      });
    }
    return { invited, profilePictures };
  }

  private async _restoreProfilePictures(
    tx: OrgImportTransaction,
    maps: ImportMaps,
    profilePictures: Map<string, string>,
  ): Promise<void> {
    for (const [userId, sourceFileId] of profilePictures) {
      const pictureId = maps.ids.File.get(sourceFileId) ?? null;
      await this._repository.updateProfilePicture(tx, userId, pictureId);
    }
  }

  private async _importRelations(
    tx: OrgImportTransaction,
    extraction: OrgArchiveExtraction,
    maps: ImportMaps,
  ): Promise<void> {
    for (const source of await readOrgDomainRows(extraction, 'tagsPosts')) {
      await this._repository.createModel(tx, 'tagsPosts', {
        postId: maps.ids.Post.get(source.postId),
        tagId: maps.ids.Tags.get(source.tagId),
        createdAt: source.createdAt ? new Date(source.createdAt) : undefined,
        updatedAt: source.updatedAt ? new Date(source.updatedAt) : undefined,
      });
    }
    for (const source of await readOrgDomainRows(extraction, 'postCommentRead')) {
      await this._repository.createModel(tx, 'postCommentRead', {
        id: randomUUID(),
        postId: maps.ids.Post.get(source.postId),
        userId: maps.users.get(source.userId),
        lastReadAt: new Date(source.lastReadAt),
        lastReadCount: source.lastReadCount,
        updatedAt: source.updatedAt ? new Date(source.updatedAt) : undefined,
      });
    }
    for (const source of await readOrgDomainRows(extraction, 'notificationRead')) {
      await this._repository.createModel(tx, 'notificationRead', {
        id: randomUUID(),
        notificationId: maps.ids.Notifications.get(source.notificationId),
        userId: maps.users.get(source.userId),
        readAt: source.readAt ? new Date(source.readAt) : undefined,
      });
    }
    for (const source of await readOrgDomainRows(extraction, 'integrationWebhooks')) {
      const webhookId = maps.ids.Webhooks.get(source.webhookId);
      const integrationId = maps.ids.Integration.get(source.integrationId);
      if (webhookId && integrationId) {
        await this._repository.connectIntegrationWebhook(tx, webhookId, integrationId);
      }
    }
  }

  private async _sendInvitations(
    organizationName: string,
    invited: { id: string; email: string }[],
  ): Promise<void> {
    for (const invite of invited) {
      try {
        const token = AuthService.signJWT({ id: invite.id, displayName: invite.email });
        await this._notifications.sendEmail(
          invite.email,
          'You are invited to a Postmill organization',
          `Click <a href="${process.env.FRONTEND_URL}/auth/activate/${token}">here</a> to activate your account and join ${escapeHtml(organizationName)}.`,
        );
      } catch (error) {
        this._logger.warn(`Imported member invitation failed: ${safeError(error)}`);
      }
    }
  }
}

const fieldIsScalarRelation = (
  field: Prisma.DMMF.Field,
): boolean => field.kind === 'object' && !!field.relationFromFields?.length;
