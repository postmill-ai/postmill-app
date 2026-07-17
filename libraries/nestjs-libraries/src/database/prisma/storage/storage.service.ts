import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma, StorageProviderType } from '@prisma/client';
import { StorageRepository } from './storage.repository';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import { EncryptionService } from '@gitroom/nestjs-libraries/encryption/encryption.service';
import { IStorageAdapter } from '@gitroom/nestjs-libraries/upload/upload.interface';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { accountFingerprint } from '@gitroom/nestjs-libraries/utils/account-fingerprint';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { FileRepository } from '@gitroom/nestjs-libraries/database/prisma/file/file.repository';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

type StorageConfigRow = {
  id: string;
  organizationId: string;
  type: StorageProviderType;
  version: string | null;
  name: string;
  credentials: string | null;
  region: string | null;
  bucket: string | null;
  endpoint: string | null;
  publicUrl: string | null;
  mounted: boolean;
  quotaBytes: bigint | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class StorageService {
  private readonly _logger = new Logger(StorageService.name);

  constructor(
    private _storageRepository: StorageRepository,
    private _auditService: AuditService,
    private _encryptionService: EncryptionService,
    private _resolution: ProviderResolutionService,
    // layering: sanctioned leaf-read — reading the subscription through
    // SubscriptionService would close a DI cycle (IntegrationService → StorageService →
    // SubscriptionService → IntegrationService, the last edge already forwardRef'd), which
    // crashes Nest at boot. The repository is a pure leaf with no back-edge, so read it directly.
    private _subscriptionRepository: SubscriptionRepository,
    private _fileRepository: FileRepository,
  ) {}

  // Strip the (encrypted) credential blob from anything returned to a client (#54).
  #sanitize<T extends { credentials?: string | null }>(config: T) {
    if (!config) return config;
    const { credentials, ...rest } = config as any;
    return rest;
  }

  // Recursively coerce BigInt values to Number so service results are safe for
  // JSON serialization without leaking the bigint type into controllers.
  #stripBigInts(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return Number(obj);
    if (Array.isArray(obj)) return obj.map((v) => this.#stripBigInts(v));
    if (typeof obj === 'object') {
      const stripped: any = {};
      for (const [k, v] of Object.entries(obj)) {
        stripped[k] = this.#stripBigInts(v);
      }
      return stripped;
    }
    return obj;
  }

  async #audit(
    action: string,
    orgId: string,
    config: { id?: string; type?: StorageProviderType; name?: string },
    userId?: string
  ) {
    // Persist to DB: no secrets in details (#59, DB-backed audit)
    await this._auditService.create({
      organizationId: orgId,
      userId,
      action: `storage.${action}`,
      entity: 'storage_provider',
      entityId: config.id,
      entityName: config.name,
      details: config.type ? JSON.stringify({ type: config.type }) : undefined,
    });
    // Also log for immediate visibility
    this._logger.log(
      `storage.${action} org=${orgId} user=${userId || 'n/a'} ` +
        `provider=${config.id || 'n/a'} type=${config.type || 'n/a'}`
    );
  }

  async #getOrgScopedConfig(id: string, orgId: string): Promise<StorageConfigRow> {
    const config = await this._storageRepository.findById(orgId, id);
    if (!config || config.organizationId !== orgId) {
      throw new Error('Storage config not found');
    }
    return config as StorageConfigRow;
  }

  #buildAdapter(config: StorageConfigRow): IStorageAdapter {
    const decrypted = config.credentials
      ? (JSON.parse(this._encryptionService.decrypt(config.credentials)) as Record<string, string>)
      : {};
    return this._resolution.resolveStorage(
      this.#storageTypeToKernelId(config.type),
      {
        version: config.version ?? 'v1',
        credentials: decrypted,
        orgId: config.organizationId,
        extras: {
          bucket: config.bucket,
          region: config.region,
          endpoint: config.endpoint,
          publicUrl: config.publicUrl,
        },
      }
    );
  }

  #storageTypeToKernelId(type: StorageProviderType): string {
    // Preserve underscores so the kernel providerId matches the manifest
    // (e.g. `cloudflare_r2`, `backblaze_b2`, `s3_compatible`).
    return type.toLowerCase();
  }

  async getProviderConfigs(orgId: string) {
    const configs = await this._storageRepository.findByOrg(orgId);
    const results = configs.map((c) => this.#sanitize(c));

    if (!configs.some((c) => c.type === StorageProviderType.LOCAL)) {
      results.unshift({
        id: '__virtual_local__',
        organizationId: orgId,
        type: StorageProviderType.LOCAL,
        name: 'Local Storage',
        region: null,
        bucket: null,
        endpoint: null,
        publicUrl: null,
        mounted: false,
        quotaBytes: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      });
    }

    return results;
  }

  getMountedConfigs(orgId: string) {
    return this._storageRepository.findMountedByOrg(orgId);
  }

  async createConfig(
    orgId: string,
    data: {
      type: StorageProviderType;
      name: string;
      credentials?: Record<string, string>;
      region?: string;
      bucket?: string;
      endpoint?: string;
      publicUrl?: string;
      quotaBytes?: bigint;
      version?: string;
    },
    userId?: string
  ) {
    const encrypted = data.credentials
      ? this._encryptionService.encrypt(JSON.stringify(data.credentials))
      : undefined;

    const fp = this.#computeFingerprint(data.type, data.credentials);
    if (fp) {
      const existing = await this._storageRepository.findByFingerprint(orgId, fp);
      if (existing) {
        throw new HttpException(
          'A storage provider with these credentials is already configured for this organization',
          409
        );
      }
    }

    // Route the pinned version through the lifecycle gate (1.4): a supplied
    // version is validated (deprecated/retired/unknown rejected), and an absent
    // version resolves to latest-active.
    const version = this._resolution.resolveWriteVersion(
      'storage',
      this.#storageTypeToKernelId(data.type),
      data.version
    );

    const created = await this._storageRepository.create({
      organizationId: orgId,
      type: data.type,
      name: data.name,
      credentials: encrypted,
      region: data.region,
      bucket: data.bucket,
      endpoint: data.endpoint,
      publicUrl: data.publicUrl,
      quotaBytes: data.quotaBytes,
      accountFingerprint: fp,
      version,
    });

    await this.#audit('create', orgId, created, userId);
    return this.#sanitize(created);
  }

  /**
   * Create a storage config, test the connection, and roll back on failure.
   * Returns a DTO-ready (BigInt-stripped, credential-sanitized) shape.
   */
  async createAndTestConfig(
    orgId: string,
    data: {
      type: StorageProviderType;
      name: string;
      credentials?: Record<string, string>;
      region?: string;
      bucket?: string;
      endpoint?: string;
      publicUrl?: string;
      quotaBytes?: bigint;
      version?: string;
    },
    userId?: string
  ) {
    const created = await this.createConfig(orgId, data, userId);

    const testResult = await this.testConnection(created.id, orgId);
    if (!testResult.ok) {
      await this.deleteConfig(created.id, orgId);
      throw new HttpException(
        `Connection test failed: ${testResult.error}`,
        400
      );
    }

    return this.#stripBigInts(created);
  }

  #computeFingerprint(
    type: StorageProviderType,
    credentials?: Record<string, string>
  ): string | undefined {
    if (!credentials) return undefined;
    // Backblaze B2 keys its credentials on keyId; every other S3-compatible
    // provider (S3, R2, IDrive, Wasabi, DO Spaces, Hetzner, Storj, Scaleway,
    // Vultr, Linode, generic) keys on accessKeyId.
    if (type === 'BACKBLAZE_B2') {
      return credentials.keyId
        ? accountFingerprint(type, credentials.keyId)
        : undefined;
    }
    return credentials.accessKeyId
      ? accountFingerprint(type, credentials.accessKeyId)
      : undefined;
  }

  async updateConfig(
    id: string,
    orgId: string,
    data: {
      name?: string;
      credentials?: Record<string, string>;
      region?: string;
      bucket?: string;
      endpoint?: string;
      publicUrl?: string;
      quotaBytes?: bigint;
      version?: string;
    },
    userId?: string
  ) {
    const config = await this.#getOrgScopedConfig(id, orgId);

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.credentials !== undefined) {
      updateData.credentials = this._encryptionService.encrypt(
        JSON.stringify(data.credentials)
      );
      // 3.5: recompute the account fingerprint on credential rotation. Only
      // createConfig computed it, so a rotated credential kept the stale
      // fingerprint — blocking re-adding the old account and failing to dedupe
      // the new one. Uses the stored row's type (updateConfig can't change type).
      updateData.accountFingerprint = this.#computeFingerprint(
        config.type,
        data.credentials
      );
      // 3.6(a): rotating to another config's credentials collides on the
      // @@unique([organizationId, accountFingerprint]) index. Pre-check
      // (excluding this row) and map to the same friendly 409 createConfig
      // returns, instead of a raw P2002 → 500.
      if (updateData.accountFingerprint) {
        const clash = await this._storageRepository.findByFingerprint(
          orgId,
          updateData.accountFingerprint
        );
        if (clash && clash.id !== id) {
          throw new HttpException(
            'A storage provider with these credentials is already configured for this organization',
            409
          );
        }
      }
    }
    if (data.region !== undefined) updateData.region = data.region;
    if (data.bucket !== undefined) updateData.bucket = data.bucket;
    if (data.endpoint !== undefined) updateData.endpoint = data.endpoint;
    if (data.publicUrl !== undefined) updateData.publicUrl = data.publicUrl;
    if (data.quotaBytes !== undefined) updateData.quotaBytes = data.quotaBytes;
    if (data.version !== undefined) {
      // 3.6(b): route the version through the lifecycle gate. This is an
      // in-place update, so pass the row's existing version as `currentVersion`
      // — a deprecated-pinned config can still be updated in place (only a write
      // that would newly pin a deprecated/retired/preview version is rejected).
      updateData.version = this._resolution.resolveWriteVersion(
        'storage',
        this.#storageTypeToKernelId(config.type),
        data.version,
        config.version ? { currentVersion: config.version } : undefined
      );
    }

    let updated;
    try {
      updated = await this._storageRepository.update(orgId, id, updateData);
    } catch (err) {
      // Belt-and-suspenders for a TOCTOU race on the fingerprint pre-check.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new HttpException(
          'A storage provider with these credentials is already configured for this organization',
          409
        );
      }
      throw err;
    }
    // 6.5: await the audit write so the row is not dropped on process exit.
    await this.#audit('update', orgId, updated, userId);
    return this.#stripBigInts(this.#sanitize(updated));
  }

  async ensureLocalProvider(orgId: string) {
    const existing = await this._storageRepository.findByOrg(orgId);
    if (existing.some((c) => c.type === StorageProviderType.LOCAL)) return;

    await this._storageRepository.create({
      organizationId: orgId,
      type: StorageProviderType.LOCAL,
      name: 'Local Storage',
    });
  }

  async deleteConfig(id: string, orgId: string, userId?: string) {
    const config = await this.#getOrgScopedConfig(id, orgId);
    if (config.type === StorageProviderType.LOCAL) {
      throw new Error('Cannot delete the local storage provider.');
    }
    if (config.mounted) {
      throw new Error('Cannot delete a mounted storage provider. Unmount first.');
    }
    const deleted = await this._storageRepository.delete(orgId, id);
    this.#audit('delete', orgId, config, userId);
    return deleted;
  }

  async testConnection(
    id: string,
    orgId: string
  ): Promise<{ ok: boolean; error?: string }> {
    const config = await this.#getOrgScopedConfig(id, orgId);
    const result = await this.#buildAdapter(config).testConnection();
    // Track health (#62)
    await this._storageRepository.updateHealthCheck(orgId, id, result.ok, result.error);
    return result;
  }

  async getAdapter(id: string, orgId: string): Promise<IStorageAdapter> {
    const config = await this.#getOrgScopedConfig(id, orgId);
    return this.#buildAdapter(config);
  }

  // Force the org's LOCAL adapter — used for avatars and app-internal writes (v3.8.2).
  async getLocalAdapterForOrg(orgId: string, createIfMissing = false): Promise<IStorageAdapter> {
    const configs = await this._storageRepository.findByOrg(orgId);
    const local = configs.find(
      (c) => c.type === StorageProviderType.LOCAL
    ) as StorageConfigRow | undefined;

    if (local) {
      return this.#buildAdapter(local);
    }

    if (createIfMissing) {
      await this.ensureLocalProvider(orgId);
      const updated = await this._storageRepository.findByOrg(orgId);
      const created = updated.find(
        (c) => c.type === StorageProviderType.LOCAL
      ) as StorageConfigRow;
      return this.#buildAdapter(created);
    }

    // No persisted LOCAL row: resolve a virtual LOCAL adapter straight from the
    // kernel (replaces the removed StorageAdapterFactory.createLocal helper).
    return this.#buildAdapter({
      id: '__virtual_local__',
      organizationId: orgId,
      type: StorageProviderType.LOCAL,
      version: 'v1',
      name: 'Local Storage',
      credentials: null,
      region: null,
      bucket: null,
      endpoint: null,
      publicUrl: null,
      mounted: false,
      quotaBytes: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
  }

  // Upload routing (#56): oldest mounted → local/first.
  async getAdapterForOrg(orgId: string): Promise<IStorageAdapter | null> {
    const mounted = (await this._storageRepository.findMountedByOrg(orgId))[0];
    if (mounted) {
      return this.#buildAdapter(mounted as StorageConfigRow);
    }

    const configs = await this._storageRepository.findByOrg(orgId);
    if (configs.length > 0) {
      const local = configs.find((c) => c.type === StorageProviderType.LOCAL);
      return this.#buildAdapter((local || configs[0]) as StorageConfigRow);
    }

    return null;
  }

  // Enforce per-org local storage quota before a local write (#57).
  async assertWithinQuota(orgId: string, incomingBytes: number) {
    // Self-host deployments are fully unlocked.
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return;
    }

    const subscription =
      await this._subscriptionRepository.getSubscriptionByOrganizationId(orgId);
    const tier = subscription?.subscriptionTier || 'STARTER';
    const plan = pricing[tier] ?? pricing['STARTER'];

    // F2: a mounted BYO bucket waives the hosted storage meter only when the
    // plan entitles the org to BYO storage — otherwise a STARTER/PRO org could
    // mount its own bucket and stop being metered at all.
    const mounted = await this.getMountedConfigs(orgId);
    if (
      plan.byo_storage &&
      mounted.some((c) => c.type !== StorageProviderType.LOCAL)
    ) {
      return;
    }

    const capBytes =
      (plan.storage_gb + (subscription?.extraStorageGb ?? 0)) *
      1024 *
      1024 *
      1024;
    const used = await this._fileRepository.getStorageBytes(orgId);

    if (used + incomingBytes > capBytes) {
      throw new HttpException(
        'Hosted storage limit reached. Buy a storage add-on or upgrade your plan.',
        402
      );
    }
  }

  // Destination-aware quota check. For LOCAL, uses the existing local quota.
  // For cloud adapters: if config.quotaBytes is set, compare usage against it;
  // otherwise skip (cloud billing is provider-side).
  async assertWithinProviderQuota(
    adapter: IStorageAdapter,
    orgId: string,
    incomingBytes: number,
    configId?: string | null
  ) {
    if (adapter.type === StorageProviderType.LOCAL) {
      return this.assertWithinQuota(orgId, incomingBytes);
    }

    let config: StorageConfigRow | undefined;
    if (configId) {
      const byId = await this._storageRepository.findById(orgId, configId);
      if (byId) {
        config = byId as StorageConfigRow;
      }
    }

    // Quota is always resolved by the stable config id. Callers that do not
    // have a config id (e.g. legacy paths) skip the per-provider quota check.

    if (!config || !config.quotaBytes) return;

    let usage: bigint | null = null;
    try {
      usage = await adapter.getUsageBytes();
    } catch {
      usage = null;
    }
    if (usage === null) return;

    if (usage + BigInt(Math.max(0, Math.floor(incomingBytes))) > config.quotaBytes) {
      throw new HttpException(
        'Storage quota exceeded for this provider. Free up space or increase your quota.',
        413
      );
    }
  }

  async getMigrationPreview(
    sourceId: string,
    orgId: string
  ): Promise<{ count: number; totalBytes: number }> {
    const source = await this.#getOrgScopedConfig(sourceId, orgId);
    const { count, totalBytes } = await this._storageRepository.countSourceMedia(
      orgId,
      source
    );
    return { count, totalBytes: Number(totalBytes) };
  }

  // Batched, verify-before-delete cross-provider migration (#48–#52).
  async migrate(
    sourceId: string,
    targetId: string,
    orgId: string,
    cursor?: string,
    limit = 25
  ): Promise<{
    migrated: number;
    failed: number;
    errors: string[];
    nextCursor?: string;
    done: boolean;
  }> {
    if (sourceId === targetId) {
      throw new Error('Source and target providers must be different.');
    }

    const source = await this.#getOrgScopedConfig(sourceId, orgId);
    const target = await this.#getOrgScopedConfig(targetId, orgId);

    const sourceAdapter = this.#buildAdapter(source);
    const targetAdapter = this.#buildAdapter(target);

    // Where migrated files land in the folder tree (#52).
    let targetFolderId: string | null = null;
    if (target.type !== StorageProviderType.LOCAL) {
      const existing = await this._storageRepository.findMountFolder(
        orgId,
        targetId
      );
      targetFolderId =
        existing?.id ||
        (await this._storageRepository.createMountFolder(
          orgId,
          targetId,
          target.name
        )).id;
    }

    const page = await this._storageRepository.findSourceMediaPage(
      orgId,
      source,
      cursor,
      limit
    );

    let migrated = 0;
    let failed = 0;
    const errors: string[] = [];
    let lastId: string | undefined;

    for (const media of page) {
      lastId = media.id;
      try {
        const buffer = await sourceAdapter.readFile(media.path);
        const newPath = await targetAdapter.writeBuffer(buffer, media.type);

        // Verify the target object is complete before destroying the source (#51).
        const written = await targetAdapter.readFile(newPath);
        if (written.length !== buffer.length) {
          throw new Error('Target verification failed (size mismatch)');
        }

        await this._storageRepository.updateMediaLocation(
          orgId,
          media.id,
          newPath,
          targetFolderId
        );
        await sourceAdapter.removeFile(media.path);
        migrated++;
      } catch (err: any) {
        failed++;
        errors.push(`${media.name || media.id}: ${err.message}`);
      }
    }

    const done = page.length < limit;
    // 6.5: await the audit write so the row is not dropped on process exit.
    await this.#audit('migrate', orgId, source);
    return {
      migrated,
      failed,
      errors,
      nextCursor: done ? undefined : lastId,
      done,
    };
  }

  async mount(id: string, orgId: string) {
    const config = await this.#getOrgScopedConfig(id, orgId);

    await this._storageRepository.update(orgId, id, { mounted: true });

    // Reuse the existing root folder if this provider was mounted before (#55).
    const existing = await this._storageRepository.findMountFolder(orgId, id);
    if (!existing) {
      const folderName = config.name || config.type.toLowerCase();
      await this._storageRepository.createMountFolder(orgId, id, folderName);
    }

    const updated = await this.#getOrgScopedConfig(id, orgId);
    this.#audit('mount', orgId, updated);
    return this.#stripBigInts(this.#sanitize(updated));
  }

  async unmount(id: string, orgId: string) {
    const config = await this.#getOrgScopedConfig(id, orgId);
    if (config.type === StorageProviderType.LOCAL) {
      throw new Error('Cannot unmount the local storage provider.');
    }

    // Delete the auto-created root folder when empty, else detach it (#55).
    await this._storageRepository.removeOrDetachMountFolders(orgId, id);

    const updated = await this._storageRepository.update(orgId, id, { mounted: false });
    this.#audit('unmount', orgId, updated);
    return this.#stripBigInts(this.#sanitize(updated));
  }

  async getUsage(orgId: string): Promise<{
    totalBytes: bigint;
    quotaBytes: bigint;
    providers: Array<{ id: string; name: string; usageBytes: bigint | null }>;
  }> {
    const configs = await this._storageRepository.findByOrg(orgId);
    let totalBytes = BigInt(0);
    const providerUsage: Array<{
      id: string;
      name: string;
      usageBytes: bigint | null;
    }> = [];

    for (const config of configs) {
      let usage: bigint | null = null;
      try {
        usage = await this.#buildAdapter(config as StorageConfigRow).getUsageBytes();
      } catch {
        usage = null;
      }
      providerUsage.push({ id: config.id, name: config.name, usageBytes: usage });
      if (usage !== null) {
        totalBytes += usage;
      }
    }

    const quotaBytes = await this._storageRepository.getOrgQuota(orgId);

    return {
      totalBytes,
      quotaBytes,
      providers: providerUsage,
    };
  }

  async setOrgQuota(orgId: string, quotaBytes: bigint): Promise<void> {
    await this._storageRepository.setOrgQuota(orgId, quotaBytes);
  }

  async getQuotaStatus(orgId: string): Promise<{
    usedBytes: bigint;
    quotaBytes: bigint;
    percentUsed: number;
    warning: boolean;
  }> {
    const usedBytes = await this._storageRepository.getStorageUsedByOrg(orgId);
    const quotaBytes = await this._storageRepository.getOrgQuota(orgId);
    const percentUsed =
      quotaBytes > BigInt(0)
        ? Number((usedBytes * BigInt(100)) / quotaBytes)
        : 0;
    return {
      usedBytes,
      quotaBytes,
      percentUsed,
      warning: percentUsed >= 80,
    };
  }

  async getUsageBreakdown(orgId: string): Promise<{
    byFolder: Array<{ folderId: string; folderName: string; totalBytes: bigint }>;
    byProvider: Array<{ providerId: string; providerName: string; totalBytes: bigint }>;
  }> {
    const byFolder = await this._storageRepository.getUsageByFolder(orgId);
    const byProvider = await this._storageRepository.getUsageByProvider(orgId);
    return { byFolder, byProvider };
  }

  // DTO-ready variants that strip BigInt values before crossing the HTTP boundary.
  async getUsageDto(orgId: string) {
    const usage = await this.getUsage(orgId);
    return {
      totalBytes: Number(usage.totalBytes),
      quotaBytes: Number(usage.quotaBytes),
      providers: usage.providers.map((p) => ({
        ...p,
        usageBytes: p.usageBytes !== null ? Number(p.usageBytes) : null,
      })),
    };
  }

  async getQuotaStatusDto(orgId: string) {
    const status = await this.getQuotaStatus(orgId);
    return {
      usedBytes: Number(status.usedBytes),
      quotaBytes: Number(status.quotaBytes),
      percentUsed: status.percentUsed,
      warning: status.warning,
    };
  }

  async getUsageBreakdownDto(orgId: string) {
    const breakdown = await this.getUsageBreakdown(orgId);
    return {
      byFolder: breakdown.byFolder.map((f) => ({
        ...f,
        totalBytes: Number(f.totalBytes),
      })),
      byProvider: breakdown.byProvider.map((p) => ({
        ...p,
        totalBytes: Number(p.totalBytes),
      })),
    };
  }

  /**
   * Return the set of public URL prefixes that storage objects for this org may
   * have. Used by /files/save-media and /files/bulk/save to validate that a
   * client-supplied path actually belongs to the org's storage.
   */
  async getOrgStoragePublicPrefixes(orgId: string): Promise<string[]> {
    const prefixes: string[] = [];
    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    if (frontendUrl) {
      prefixes.push(`${frontendUrl}/uploads/`);
    }

    const configs = await this._storageRepository.findByOrg(orgId);
    for (const config of configs) {
      if (config.publicUrl) {
        prefixes.push(config.publicUrl.replace(/\/$/, '') + '/');
      } else if (
        config.bucket &&
        config.region &&
        (config.type === StorageProviderType.S3 ||
          config.type === StorageProviderType.S3_COMPATIBLE)
      ) {
        // Default S3 virtual-hosted URL when no custom publicUrl/CDN is set.
        // Only do this for true S3-compatible provider types; R2/Wasabi/B2/etc.
        // have their own endpoint shapes and should rely on publicUrl.
        prefixes.push(
          `https://${config.bucket}.s3.${config.region}.amazonaws.com/`
        );
      }
    }

    return [...new Set(prefixes)];
  }

  // Resolve the storage adapter for a given folder by walking the parentId
  // chain up to a mount-root folder carrying storageProviderId. No folder
  // or null folder → org LOCAL fallback. Never returns null.
  async resolveAdapterForFolder(
    folderId: string | null | undefined,
    orgId: string
  ): Promise<IStorageAdapter> {
    const { adapter } = await this.resolveAdapterForFolderWithConfigId(folderId, orgId);
    return adapter;
  }

  /**
   * Same as `resolveAdapterForFolder`, but also returns the resolved config id
   * so callers can do stable quota/identity lookups without relying on class
   * identity.
   */
  async resolveAdapterForFolderWithConfigId(
    folderId: string | null | undefined,
    orgId: string
  ): Promise<{ adapter: IStorageAdapter; configId: string | null }> {
    if (!folderId) {
      return { adapter: await this.getLocalAdapterForOrg(orgId, true), configId: null };
    }

    const seen = new Set<string>();
    let currentId: string | null = folderId;

    while (currentId) {
      if (seen.has(currentId)) {
        throw new Error('Cyclic parentId chain detected in folder tree');
      }
      seen.add(currentId);

      const folder = await this._storageRepository.findFolderWithProvider(currentId, orgId);
      if (!folder) break;
      if (folder.organizationId !== orgId) {
        throw new HttpException('Folder not found', 404);
      }

      if (folder.storageProviderId) {
        const config = await this._storageRepository.findById(
          orgId,
          folder.storageProviderId
        );
        if (config) {
          return {
            adapter: this.#buildAdapter(config as StorageConfigRow),
            configId: config.id,
          };
        }
        break;
      }

      currentId = folder.parentId;
    }

    return { adapter: await this.getLocalAdapterForOrg(orgId, true), configId: null };
  }

  // Legacy — delegates to the ancestor-aware resolver. Kept for backward compat
  // during the Part 1 rename transition; remove after all callers are migrated.
  async getAdapterForFolder(folderId: string, orgId: string): Promise<IStorageAdapter | null> {
    return this.resolveAdapterForFolder(folderId, orgId);
  }

  async setDefaultFolderForProvider(
    providerId: string,
    folderId: string | null,
    orgId: string,
    userId?: string
  ) {
    const config = await this._storageRepository.findById(orgId, providerId);
    if (!config) {
      throw new HttpException('Provider not found', 404);
    }

    // Validate cross-org / missing folder before persisting. `findFolder` is
    // org-scoped and returns null for a missing or foreign folder; mirror the
    // controller's 400-on-not-found behaviour.
    if (folderId) {
      const folder = await this._storageRepository.findFolder(folderId, orgId);
      if (!folder) {
        throw new HttpException('folderId does not belong to this organization', 400);
      }
    }

    const updated = await this._storageRepository.setDefaultFolder(providerId, folderId, orgId);
    await this.#audit('set-default-folder', orgId, config, userId);
    return this.#stripBigInts(this.#sanitize(updated));
  }
}
