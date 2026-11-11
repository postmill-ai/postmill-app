import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import {
  createReadStream,
  createWriteStream,
  readFileSync,
  rmSync,
  statSync,
} from 'fs';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import path from 'path';
import { tmpdir } from 'os';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { EncryptionService } from '@postmill-ai/nestjs-libraries/encryption/encryption.service';
import { AuditService } from '@postmill-ai/nestjs-libraries/database/prisma/audit/audit.service';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { inngest, isInngestEnabled } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { OrgPortabilityRepository } from './org-portability.repository';
import { ensureOrgSpoolDir, OrgArchiveWriter } from './org-portability.archive';
import {
  lowerFirst,
  orgPortabilityModelNames,
  ORG_PORTABILITY_RELATION_DOMAINS,
} from './org-portability.domains';
import {
  createOrgArchiveKey,
  encryptOrgSecretRefs,
  orgManifestMac,
  wrapOrgArchiveKey,
} from './org-portability.crypto';
import {
  ORG_EXPORT_SCHEMA,
  ORG_PORTABILITY_BATCH_SIZE,
  ORG_PORTABILITY_MAX_DOMAIN_BYTES,
  ORG_PORTABILITY_EXPORT_EVENT,
  orgPortabilityMaxArchiveBytes,
  orgPortabilityMaxAssetBytes,
  ORG_PORTABILITY_REGENERATED_TOKEN_FIELDS,
  ORG_PORTABILITY_SECRET_FIELDS,
  type OrgPortabilityAssetManifest,
  type OrgPortabilityManifest,
  type OrgPortabilitySecretRef,
} from './org-portability.types';

const DOWNLOAD_TTL_SECONDS = 300;
const downloadKey = (token: string) => `org-portability:download:${token}`;
const asArray = async function* <T>(rows: T[]): AsyncGenerator<T> {
  for (const row of rows) yield row;
};
const sha256File = async (filePath: string): Promise<string> => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
};
const isMissingObjectError = (error: unknown): boolean => {
  const cause = error as {
    code?: string;
    name?: string;
    statusCode?: number | string;
    $metadata?: { httpStatusCode?: number };
    message?: string;
  };
  return cause?.code === 'ENOENT'
    || cause?.code === 'NoSuchKey'
    || cause?.code === 'NotFound'
    || cause?.name === 'NoSuchKey'
    || cause?.name === 'NotFound'
    || Number(cause?.statusCode ?? cause?.$metadata?.httpStatusCode) === 404
    || /\bHTTP 404\b/.test(cause?.message || '');
};
const sanitizedError = (error: unknown): string =>
  ((error as Error)?.message || 'Organization export failed')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/data:\S+/gi, '[data]')
    .replace(/v2:\S+/gi, '[encrypted]')
    .replace(/\s+/g, ' ')
    .slice(0, 300);

@Injectable()
export class OrgPortabilityService {
  private readonly _logger = new Logger(OrgPortabilityService.name);

  constructor(
    private readonly _repository: OrgPortabilityRepository,
    private readonly _storageService: StorageService,
    private readonly _encryption: EncryptionService,
    private readonly _audit: AuditService,
  ) {}

  private async _assertOwner(orgId: string, ownerId: string): Promise<void> {
    if (!(await this._repository.isOwner(orgId, ownerId))) {
      throw new ForbiddenException('Only an organization owner can use organization portability.');
    }
  }

  private _publicJob(job: any) {
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

  async createExport(orgId: string, ownerId: string, passphrase: string) {
    await this._assertOwner(orgId, ownerId);
    if (passphrase.length < 12 || passphrase.length > 256) {
      throw new BadRequestException('Use an export passphrase between 12 and 256 characters.');
    }
    const archiveKey = createOrgArchiveKey();
    try {
      const keyWrap = wrapOrgArchiveKey(archiveKey, passphrase);
      const job = await this._repository.createExportJob(
        orgId,
        ownerId,
        this._encryption.encrypt(archiveKey.toString('base64')),
        keyWrap as Prisma.InputJsonValue,
      );
      if (isInngestEnabled()) {
        await inngest.send({
          name: ORG_PORTABILITY_EXPORT_EVENT,
          data: { jobId: job.id },
          id: `org-portability-export-${job.id}`,
        });
      } else {
        await this.processExport(job.id);
      }
      await this._audit.record({
        orgId,
        userId: ownerId,
        action: 'org.export.requested',
        resource: 'OrgPortabilityJob',
        resourceId: job.id,
      });
      return this._publicJob(await this._repository.getOwnedJob(orgId, ownerId, job.id));
    } finally {
      archiveKey.fill(0);
    }
  }

  async listJobs(orgId: string, ownerId: string) {
    await this._assertOwner(orgId, ownerId);
    return (await this._repository.listOwnedJobs(orgId, ownerId)).map((job) => this._publicJob(job));
  }

  async getJob(orgId: string, ownerId: string, jobId: string) {
    await this._assertOwner(orgId, ownerId);
    const job = await this._repository.getOwnedJob(orgId, ownerId, jobId);
    if (!job) throw new NotFoundException('Organization export not found.');
    return this._publicJob(job);
  }

  async issueDownload(orgId: string, ownerId: string, jobId: string) {
    await this._assertOwner(orgId, ownerId);
    const job = await this._repository.getOwnedJob(orgId, ownerId, jobId);
    if (!job || job.status !== 'completed' || !job.spoolPath || job.expiresAt <= new Date()) {
      throw new NotFoundException('Organization export is not available for download.');
    }
    const token = randomBytes(32).toString('base64url');
    await ioRedis.set(
      downloadKey(token),
      JSON.stringify({ jobId, organizationId: orgId, ownerId }),
      'EX',
      DOWNLOAD_TTL_SECONDS,
      'NX',
    );
    await this._audit.record({
      orgId,
      userId: ownerId,
      action: 'org.export.download-issued',
      resource: 'OrgPortabilityJob',
      resourceId: jobId,
    });
    return {
      url: `/org-portability/download/${token}`,
      expiresAt: new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000),
    };
  }

  async consumeDownload(token: string) {
    const raw = await ioRedis.getdel(downloadKey(token));
    if (!raw) throw new NotFoundException('Download link expired or already used.');
    const grant = JSON.parse(raw) as { jobId: string; organizationId: string; ownerId: string };
    const job = await this._repository.getOwnedJob(grant.organizationId, grant.ownerId, grant.jobId);
    if (!job || job.status !== 'completed' || !job.spoolPath || job.expiresAt <= new Date()) {
      throw new NotFoundException('Organization export is not available for download.');
    }
    return job;
  }

  async purgeExpired(): Promise<number> {
    const jobs = await this._repository.expireJobs(new Date());
    for (const job of jobs) {
      if (job.spoolPath) rmSync(job.spoolPath, { force: true });
    }
    return jobs.length;
  }

  private _cleanValue(value: any): any {
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return value.toString('base64');
    if (Array.isArray(value)) return value.map((item) => this._cleanValue(item));
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' && /^(?:path|thumbnail|avatarUrl|src|maskSrc|url|originalUrl|shortUrl|signedUrl)$/.test(key)) {
        out[key] = this._stripUrlQuery(item);
      } else {
        out[key] = this._cleanValue(item);
      }
    }
    return out;
  }

  private _stripUrlQuery(value: string): string {
    if (!/^https?:\/\//i.test(value)) return value;
    try {
      const url = new URL(value);
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      return value.split('?')[0].split('#')[0];
    }
  }

  private _cleanRow(model: string, row: any, secrets: OrgPortabilitySecretRef[]) {
    const clean = { ...row };
    for (const field of ORG_PORTABILITY_SECRET_FIELDS[model] || []) {
      const stored = clean[field];
      if (typeof stored !== 'string' || !stored) {
        clean[field] = null;
        continue;
      }
      let value: string;
      try {
        value = stored.startsWith('v2:') ? this._encryption.decrypt(stored) : stored;
      } catch {
        throw new Error(`Could not decrypt ${model}.${field} for organization export`);
      }
      secrets.push({ model, id: row.id, field, value });
      clean[field] = null;
    }
    for (const field of ORG_PORTABILITY_REGENERATED_TOKEN_FIELDS[model] || []) {
      clean[field] = null;
    }
    return this._cleanValue(clean);
  }

  private async *_modelRows(model: string, orgId: string, secrets: OrgPortabilitySecretRef[]) {
    const delegate = lowerFirst(model);
    let cursor: string | undefined;
    for (;;) {
      const rows = await this._repository.modelBatch(delegate, orgId, cursor);
      for (const row of rows) yield this._cleanRow(model, row, secrets);
      if (rows.length < ORG_PORTABILITY_BATCH_SIZE) return;
      cursor = rows[rows.length - 1].id;
    }
  }

  private _relatedCursor(model: string, row: any): string {
    if (model === 'tagsPosts') return JSON.stringify({ postId: row.postId, tagId: row.tagId });
    if (model === 'appRolePermission') return JSON.stringify({ roleId: row.roleId, permissionId: row.permissionId });
    return row.id;
  }

  private async *_relatedRows(model: string, orgId: string) {
    let cursor: string | undefined;
    for (;;) {
      const rows = await this._repository.relatedBatch(model, orgId, cursor);
      for (const row of rows) yield this._cleanValue(row);
      if (rows.length < ORG_PORTABILITY_BATCH_SIZE) return;
      cursor = this._relatedCursor(model, rows[rows.length - 1]);
    }
  }

  private async _writeDomain(
    writer: OrgArchiveWriter,
    counts: Record<string, number>,
    domainHashes: Record<string, string>,
    name: string,
    rows: AsyncIterable<unknown>,
  ): Promise<void> {
    let count = 0;
    let bytes = 0;
    const hash = createHash('sha256');
    await writer.addNdjson(`domains/${name}.ndjson`, (async function* () {
      for await (const row of rows) {
        count++;
        yield row;
      }
    })(), (chunk) => {
      bytes += chunk.length;
      if (bytes > ORG_PORTABILITY_MAX_DOMAIN_BYTES) {
        throw new Error(`Organization export domain ${name} exceeds the 64 MiB import limit`);
      }
      hash.update(chunk);
    });
    counts[name] = count;
    domainHashes[name] = hash.digest('hex');
  }

  private _appVersion(): string {
    try {
      return readFileSync(path.resolve(process.cwd(), 'version.txt'), 'utf8').trim();
    } catch {
      return 'unknown';
    }
  }

  private async _writeAsset(
    writer: OrgArchiveWriter,
    assets: Record<string, OrgPortabilityAssetManifest>,
    counts: Record<string, number>,
    writtenAssets: Set<string>,
    existingAssetBytes: bigint,
    assetTemp: string,
    input: {
      id: string;
      sourcePath: string;
      declaredSize?: bigint;
      mime: string;
      kind: 'file' | 'font';
      adapter: { readFileStream(filePath: string): Promise<NodeJS.ReadableStream> };
    },
  ): Promise<bigint> {
    if (input.declaredSize !== undefined && input.declaredSize > orgPortabilityMaxAssetBytes()) {
      throw new Error(`Asset ${input.id} exceeds the per-asset export limit`);
    }
    const hash = createHash('sha256');
    let size = 0n;
    try {
      try {
        const source = await input.adapter.readFileStream(input.sourcePath);
        rmSync(assetTemp, { force: true });
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            size += BigInt(chunk.length);
            if (size > orgPortabilityMaxAssetBytes()) {
              callback(new Error(`Asset ${input.id} exceeds the per-asset export limit`));
              return;
            }
            hash.update(chunk);
            callback(null, chunk);
          },
        });
        await pipeline(source, limiter, createWriteStream(assetTemp, { flags: 'wx', mode: 0o600 }));
      } catch (error) {
        if (!isMissingObjectError(error)) throw error;
        assets[input.id] = {
          fileId: input.id,
          sha256: '',
          size: (input.declaredSize || 0n).toString(),
          mime: input.mime,
          kind: input.kind,
          ...(input.kind === 'font' ? { sourcePath: this._stripUrlQuery(input.sourcePath) } : {}),
          missing: true,
        };
        counts.missingAssets = (counts.missingAssets || 0) + 1;
        return 0n;
      }
      const sha256 = hash.digest('hex');
      assets[input.id] = {
        fileId: input.id,
        sha256,
        size: size.toString(),
        mime: input.mime,
        kind: input.kind,
        ...(input.kind === 'font' ? { sourcePath: this._stripUrlQuery(input.sourcePath) } : {}),
      };
      if (writtenAssets.has(sha256)) return 0n;
      if (existingAssetBytes + size > orgPortabilityMaxArchiveBytes()) {
        throw new Error('Organization export exceeds the archive size limit');
      }
      await writer.addAsset(`assets/${sha256}`, createReadStream(assetTemp), () => undefined);
      writtenAssets.add(sha256);
      return size;
    } finally {
      rmSync(assetTemp, { force: true });
    }
  }

  async processExport(jobId: string): Promise<void> {
    const claimed = await this._repository.claimExportJob(jobId);
    if (claimed.count !== 1) return;
    const job = await this._repository.getJob(jobId);
    if (!job?.archiveKeyCiphertext) return;
    const spoolRoot = path.resolve(process.env.ORG_PORTABILITY_SPOOL_DIR || path.join(tmpdir(), 'postmill-org-archives'));
    const spoolPath = path.join(spoolRoot, `${job.id}.zip`);
    const assetTemp = path.join(spoolRoot, `${job.id}.asset`);
    let archiveKey: Buffer | undefined;
    let writer: OrgArchiveWriter | undefined;
    try {
      archiveKey = Buffer.from(this._encryption.decrypt(job.archiveKeyCiphertext), 'base64');
      ensureOrgSpoolDir(spoolRoot);
      rmSync(spoolPath, { force: true });
      rmSync(assetTemp, { force: true });
      writer = await OrgArchiveWriter.create(spoolPath);
      const counts: Record<string, number> = {};
      const domainHashes: Record<string, string> = {};
      const secrets: OrgPortabilitySecretRef[] = [];
      const organization = await this._repository.organization(job.organizationId);
      if (!organization) throw new Error('Organization not found during export');
      await this._writeDomain(writer, counts, domainHashes, 'organization', asArray([this._cleanValue(organization)]));
      await this._writeDomain(writer, counts, domainHashes, 'members', asArray(await this._repository.members(job.organizationId)));
      await this._writeDomain(writer, counts, domainHashes, 'customRoles', asArray(await this._repository.customRoles(job.organizationId)));

      for (const model of orgPortabilityModelNames()) {
        await this._writeDomain(writer, counts, domainHashes, model, this._modelRows(model, job.organizationId, secrets));
      }
      for (const relation of ORG_PORTABILITY_RELATION_DOMAINS) {
        const rows = relation === 'integrationWebhooks'
          ? asArray(await this._repository.integrationWebhookPairs(job.organizationId))
          : this._relatedRows(relation, job.organizationId);
        await this._writeDomain(writer, counts, domainHashes, relation, rows);
      }

      const assets: Record<string, OrgPortabilityAssetManifest> = {};
      const writtenAssets = new Set<string>();
      let uniqueAssetBytes = 0n;
      for (const file of await this._repository.files(job.organizationId)) {
        const metadata = file.metadata && typeof file.metadata === 'object' && !Array.isArray(file.metadata)
          ? file.metadata as Record<string, unknown>
          : {};
        uniqueAssetBytes += await this._writeAsset(writer, assets, counts, writtenAssets, uniqueAssetBytes, assetTemp, {
          id: file.id,
          sourcePath: file.path,
          declaredSize: BigInt(file.fileSize),
          mime: String(metadata.mime || metadata.mimeType || file.type || 'application/octet-stream'),
          kind: 'file',
          adapter: await this._storageService.resolveAdapterForFolder(file.folderId, job.organizationId),
        });
      }
      const fontAdapter = await this._storageService.getLocalAdapterForOrg(job.organizationId, true);
      for (const brand of await this._repository.brandFonts(job.organizationId)) {
        const fonts = Array.isArray(brand.customFonts) ? brand.customFonts : [];
        for (const [index, value] of fonts.entries()) {
          if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as any).path !== 'string' || !(value as any).path) {
            continue;
          }
          const sourcePath = (value as any).path as string;
          const extension = this._stripUrlQuery(sourcePath).toLowerCase().match(/\.(ttf|otf|woff2)$/)?.[1];
          if (!extension) continue;
          uniqueAssetBytes += await this._writeAsset(writer, assets, counts, writtenAssets, uniqueAssetBytes, assetTemp, {
            id: `font:${brand.id}:${index}`,
            sourcePath,
            mime: `font/${extension}`,
            kind: 'font',
            adapter: fontAdapter,
          });
        }
      }
      counts.assets = writtenAssets.size;
      if (Object.keys(domainHashes).length + writtenAssets.size + 1 > 65_000) {
        throw new Error('Organization export exceeds the 65,000-entry archive limit');
      }

      const keyWrap = (job.progress as any)?.keyWrap;
      if (!keyWrap) throw new Error('Organization export key metadata is missing');
      const core: Omit<OrgPortabilityManifest, 'integrity'> = {
        schema: ORG_EXPORT_SCHEMA,
        appVersion: this._appVersion(),
        createdAt: new Date().toISOString(),
        source: { organizationId: organization.id, name: organization.name },
        counts,
        domains: domainHashes,
        assets,
        crypto: {
          ...keyWrap,
          secrets: encryptOrgSecretRefs(secrets, archiveKey),
        },
      };
      await writer.addJson('manifest.json', {
        ...core,
        integrity: { algorithm: 'hmac-sha256', mac: orgManifestMac(core, archiveKey) },
      });
      await writer.finish();
      if (BigInt(statSync(spoolPath).size) > orgPortabilityMaxArchiveBytes()) {
        throw new Error('Organization export exceeds the archive size limit');
      }
      const archiveSha256 = await sha256File(spoolPath);
      await this._repository.completeExportJob(job.id, {
        spoolPath,
        archiveSha256,
        progress: { counts, uniqueAssetBytes: uniqueAssetBytes.toString(), archiveBytes: statSync(spoolPath).size },
      });
      await this._audit.record({
        orgId: job.organizationId,
        userId: job.ownerId,
        action: 'org.export.completed',
        resource: 'OrgPortabilityJob',
        resourceId: job.id,
        metadata: { counts, archiveSha256 },
      });
    } catch (error) {
      writer?.abort();
      rmSync(spoolPath, { force: true });
      const message = sanitizedError(error);
      this._logger.warn(`Organization export ${jobId} failed: ${message}`);
      await this._repository.failExportJob(jobId, message);
    } finally {
      archiveKey?.fill(0);
      rmSync(assetTemp, { force: true });
    }
  }
}
