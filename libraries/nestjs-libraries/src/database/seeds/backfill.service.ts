import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { MigrationLedgerRepository } from '@postmill-ai/nestjs-libraries/database/prisma/migration-ledger/migration-ledger.repository';
import { DefaultsSeedService } from '@postmill-ai/nestjs-libraries/ai/defaults/defaults-seed.service';
import { AuthService } from '@postmill-ai/helpers/auth/auth.service';
import { decryptLegacyCbc } from '@postmill-ai/nestjs-libraries/database/seeds/legacy-cbc.crypto';
import { stat } from 'node:fs/promises';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';

function deriveFingerprint(data: (string | null | undefined)[]): string {
  const hash = createHash('sha1');
  for (const part of data) {
    if (part) hash.update(part);
  }
  return hash.digest('hex').substring(0, 16);
}

@Injectable()
export class BackfillService {
  private readonly _logger = new Logger(BackfillService.name);

  constructor(
    private prisma: PrismaService,
    private _ledger: MigrationLedgerRepository,
    private _defaultsSeed?: DefaultsSeedService,
  ) {}

  async backfill() {
    // Each step runs in its OWN transaction. Backfill steps are phase-dependent and
    // idempotent — a column/table a step touches may not exist yet (pre-expand) or
    // anymore (post-contract). Postgres aborts the ENTIRE transaction on any errored
    // statement, so a single shared $transaction let one expected failure (e.g. a
    // column that is not present yet in the current deploy phase) cascade 25P02 into
    // every later step — silently skipping the RBAC role backfill and the rest.
    // Per-step isolation keeps an expected/edge failure in one from poisoning the others.
    // Reconciliation scans (oneTime = false, default): they re-scan `where: { …: null }`
    // every boot because new rows with null values can be created later (e.g. a new
    // membership with roleId: null). Marking them "applied" would permanently break self-heal.
    await this._runStep('user-organization roles', (tx) =>
      this.backfillUserOrganizationRoles(tx),
    );
    await this._runStep('AI brand profiles', (tx) =>
      this.backfillAIBrandProfiles(tx),
    );
    await this._runStep('storage provider fingerprints', (tx) =>
      this.backfillStorageProviderFingerprints(tx),
    );
    await this._runStep('short-link configs', (tx) =>
      this.backfillShortLinkConfigs(tx),
    );

    // One-time data migrations (oneTime = true): ledger-gated so they run once.
    // RAG media providers self-disables by stripping its blob, but ledger-gate it too so a
    // re-add of the blob doesn't silently re-run the migration.
    await this._runStep(
      'RAG media providers',
      (tx) => this.migrateRagSettingsMediaProviders(tx),
      true,
    );
    await this._runStep(
      'AI/media default models',
      () => this.backfillDefaultModels(),
      true,
    );
    await this._runStep(
      'file metadata JSON object',
      (tx) => this.backfillFileMetadataJson(tx),
      true,
    );
    await this._runStep(
      'file size zero rows',
      (tx) => this.backfillFileSize(tx),
      true,
    );
    // v1.0.0 cut-over guard: must be the LAST one-time step so every other
    // migration has run before values are rewritten to their final format.
    await this._runStep(
      'legacy secret re-encryption',
      (tx) => this.reencryptLegacySecrets(tx),
      true,
    );
  }

  // v1.0.0 cut-over guard: AuthService.fixedDecryption is GCM-only now — any
  // value still stored as legacy AES-CBC (or as a plaintext pass-through, for
  // the columns whose old read path passed non-v2: values through raw) becomes
  // unreadable. Rewrite every encrypted column to `v2:` GCM once, per row, only
  // where the value does not already start with 'v2:'. Prod was audited clean
  // (zero non-v2: values); this protects other/self-hosted deployments.
  // Ledger-gated one-time: post-cut-over writes are always v2:, so a re-run
  // would find nothing. Delete this step (and legacy-cbc.crypto.ts) once every
  // supported deployment has booted v1.0.0.
  private async reencryptLegacySecrets(tx: Prisma.TransactionClient) {
    // [tx delegate, column, plaintextFallback]
    // plaintextFallback: a value that fails CBC decryption is legacy PLAINTEXT
    // (the old read path passed it through raw) — encrypt it as-is. For every
    // other column an undecryptable value is logged and left untouched.
    const targets: Array<[string, string, boolean]> = [
      ['integration', 'token', true],
      ['integration', 'refreshToken', true],
      ['integration', 'customInstanceDetails', false],
      ['orgProviderConfiguration', 'clientId', false],
      ['orgProviderConfiguration', 'clientSecret', false],
      // Whole-blob: a non-decryptable value is legacy plaintext JSON.
      ['orgProviderConfiguration', 'additionalConfig', true],
      ['aIOrgProviderConfig', 'credentials', false],
      ['aISystemSettings', 'secretSettings', false],
      ['storageProviderConfig', 'credentials', false],
      ['orgShortLinkConfig', 'credentials', false],
      ['orgShortLinkConfig', 'extraConfig', false],
      ['mediaProviderConfig', 'credentials', false],
      ['contentPackConfig', 'credentials', false],
      ['orgVpnConfig', 'credentials', false],
      ['authProviderConfig', 'clientId', false],
      ['authProviderConfig', 'clientSecret', false],
      // Stripe lifetime-deal codes (CodesService / StripeService.lifetimeDeal).
      ['usedCodes', 'code', false],
    ];

    for (const [model, column, plaintextFallback] of targets) {
      await this._reencryptColumn(tx, model, column, plaintextFallback);
    }
  }

  private async _reencryptColumn(
    tx: Prisma.TransactionClient,
    model: string,
    column: string,
    plaintextFallback: boolean,
  ) {
    const delegate = (tx as any)[model];
    const rows: Array<{ id: string; [key: string]: unknown }> =
      await delegate.findMany({
        where: {
          AND: [
            { [column]: { not: null } },
            { [column]: { not: '' } },
            { [column]: { not: { startsWith: 'v2:' } } },
          ],
        },
        select: { id: true, [column]: true },
      });

    let rewritten = 0;
    let undecryptable = 0;
    for (const row of rows) {
      const value = row[column];
      if (typeof value !== 'string' || !value) continue;
      let plaintext: string | null = null;
      try {
        plaintext = decryptLegacyCbc(value);
      } catch {
        if (plaintextFallback) {
          plaintext = value;
        }
      }
      if (plaintext == null) {
        undecryptable++;
        this._logger.warn(
          `legacy secret re-encryption: ${model}.${column} row ${row.id} is not ` +
            `CBC-decryptable — left untouched (manual fix required)`,
        );
        continue;
      }
      await delegate.update({
        where: { id: row.id },
        data: { [column]: AuthService.fixedEncryption(plaintext) },
      });
      rewritten++;
    }

    this._logger.log(
      `legacy secret re-encryption: ${model}.${column} — ${rewritten} rewritten, ` +
        `${undecryptable} undecryptable (${rows.length} non-v2: rows scanned)`,
    );
  }

  private async _runStep(
    label: string,
    fn: (tx: Prisma.TransactionClient) => Promise<void>,
    oneTime = false,
  ): Promise<void> {
    const key = `backfill:${label}`;
    if (oneTime) {
      let applied = false;
      try {
        applied = await this._ledger.wasApplied(key);
      } catch {
        // MigrationLedger table may not exist yet — treat as "not applied, proceed".
        // Never let a missing ledger table silently skip a backfill.
        applied = false;
      }
      if (applied) return;
    }
    try {
      await this.prisma.$transaction(fn);
      // Only mark applied AFTER the transaction succeeds — a step that throws on a
      // not-yet-present column must retry on the next boot.
      if (oneTime) {
        try {
          await this._ledger.markApplied(key);
        } catch {
          // Ledger write failure must not fail the boot; the step simply re-runs next time.
        }
      }
    } catch (e) {
      this._logger.warn(
        `Backfill step "${label}" skipped: ${
          (e as Error).message.split('\n')[0]
        }`,
      );
    }
  }

  private async backfillUserOrganizationRoles(tx: Prisma.TransactionClient) {
    const appRoles = await tx.appRole.findMany({
      where: { organizationId: null, isSystem: true },
    });
    const appRoleByKey = new Map<string, string>(appRoles.map((r: { key: string; id: string }) => [r.key, r.id]));

    const ownerRoleId = appRoleByKey.get('owner');
    const memberRoleId = appRoleByKey.get('member');
    if (!ownerRoleId || !memberRoleId) return;

    const orgIds = (
      await tx.userOrganization.groupBy({
        by: ['organizationId'],
        where: { roleId: null },
      })
    ).map((r: { organizationId: string }) => r.organizationId);

    for (const orgId of orgIds) {
      const memberships = await tx.userOrganization.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'asc' },
      });

      const earliestId = memberships[0]?.id;

      for (const m of memberships) {
        if (m.roleId) continue;

        const roleId = m.id === earliestId ? ownerRoleId : memberRoleId;
        await tx.userOrganization.update({
          where: { id: m.id },
          data: { roleId },
        });
      }
    }
  }

  private async backfillAIBrandProfiles(tx: Prisma.TransactionClient) {
    await tx.aIBrandProfile.updateMany({
      where: { name: null },
      data: { name: 'Default', isDefault: true },
    });
  }

  private async backfillStorageProviderFingerprints(tx: Prisma.TransactionClient) {
    const configs = await tx.storageProviderConfig.findMany({
      where: { accountFingerprint: null },
    });

    for (const config of configs) {
      const fp = deriveFingerprint([
        config.type,
        config.region,
        config.bucket,
        config.endpoint,
        config.credentials,
      ]);

      await tx.storageProviderConfig.update({
        where: { id: config.id },
        data: { accountFingerprint: fp },
      });
    }
  }

  private async backfillShortLinkConfigs(tx: Prisma.TransactionClient) {
    const configs = await tx.orgShortLinkConfig.findMany({
      where: { OR: [{ name: null }, { accountFingerprint: null }] },
    });

    for (const config of configs) {
      const updates: { name?: string; accountFingerprint?: string } = {};

      if (config.name === null) {
        updates.name = config.identifier;
      }

      if (config.accountFingerprint === null) {
        updates.accountFingerprint = deriveFingerprint([
          config.identifier,
          config.credentials,
        ]);
      }

      if (Object.keys(updates).length > 0) {
        await tx.orgShortLinkConfig.update({
          where: { id: config.id },
          data: updates,
        });
      }
    }
  }

  private async backfillDefaultModels() {
    if (!this._defaultsSeed) {
      this._logger.warn('DefaultsSeedService not available; skipping default-model backfill');
      return;
    }
    const orgs = await this.prisma.organization.findMany({
      select: { id: true },
    });
    for (const org of orgs) {
      try {
        await this._defaultsSeed.seedUnset(org.id);
      } catch (err) {
        this._logger.warn(
          `Default-model backfill failed for org ${org.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async migrateRagSettingsMediaProviders(tx: Prisma.TransactionClient) {
    const aiSettings = await tx.aISystemSettings.findFirst();

    if (!aiSettings?.ragSettings) return;

    let ragData: Record<string, unknown>;
    let mediaProviders: Record<string, { enabled?: boolean; operations?: string[]; c2paAvailable?: boolean }>;
    try {
      ragData = JSON.parse(aiSettings.ragSettings);
      mediaProviders = ragData?.mediaProviders as typeof mediaProviders;
    } catch {
      return;
    }

    if (!mediaProviders || typeof mediaProviders !== 'object' || Object.keys(mediaProviders).length === 0) return;

    const orgs = await tx.aIOrgProviderConfig.findMany({
      select: { organizationId: true },
      distinct: ['organizationId'],
    });

    for (const org of orgs) {
      for (const [identifier, mp] of Object.entries(mediaProviders)) {
        if (!mp || typeof mp !== 'object') continue;

        const extraConfig = JSON.stringify({
          operations: mp.operations ?? [],
          c2paAvailable: mp.c2paAvailable ?? false,
        });

        await tx.mediaProviderConfig.upsert({
          where: {
            organizationId_identifier_version: {
              organizationId: org.organizationId,
              identifier,
              version: 'v1',
            },
          },
          update: {
            enabled: mp.enabled ?? false,
            extraConfig,
          },
          create: {
            organizationId: org.organizationId,
            identifier,
            version: 'v1',
            enabled: mp.enabled ?? false,
            extraConfig,
          },
        });
      }
    }

    // Step 7: the blob is fully migrated to MediaProviderConfig rows — strip
    // it from ragSettings so nothing can read stale media-provider state.
    const { mediaProviders: _migrated, ...remainingRag } = ragData;
    await tx.aISystemSettings.update({
      where: { id: aiSettings.id },
      data: { ragSettings: JSON.stringify(remainingRag) },
    });
  }

  /**
   * Backfill File rows whose `metadata` column was stored as a JSON string
   * literal (legacy double-encoding) and rewrite them as JSON objects.
   */
  private async backfillFileMetadataJson(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; metadata: unknown }>
    >(
      Prisma.sql`
        SELECT id, metadata
        FROM "File"
        WHERE metadata IS NOT NULL
          AND jsonb_typeof(metadata::jsonb) = 'string'
      `,
    );

    for (const row of rows) {
      const raw = row.metadata;
      let parsed: Record<string, unknown> | null = null;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          this._logger.warn(`Could not parse metadata for file ${row.id}`);
          continue;
        }
      } else if (typeof raw === 'object' && raw !== null) {
        parsed = raw as Record<string, unknown>;
      }

      if (parsed) {
        await tx.file.update({
          where: { id: row.id },
          data: { metadata: parsed as Prisma.InputJsonValue },
        });
      }
    }
  }

  /**
   * Backfill File rows with fileSize = 0. For local absolute paths, stat the
   * file. For cloud (https://) paths, issue a HEAD request to read the
   * Content-Length. Skips rows where the size cannot be determined.
   */
  private async backfillFileSize(tx: Prisma.TransactionClient) {
    const rows = await tx.file.findMany({
      where: { fileSize: 0, deletedAt: null },
      select: { id: true, path: true, metadata: true },
    });

    for (const row of rows) {
      let size = 0;
      try {
        if (row.path.startsWith('/')) {
          const s = await stat(row.path);
          size = s.size;
        } else if (row.path.startsWith('http://') || row.path.startsWith('https://')) {
          const res = await safeFetch(row.path, { method: 'HEAD' });
          const len = res.headers.get('content-length');
          if (len) size = parseInt(len, 10);
        }
      } catch (err) {
        this._logger.warn(
          `Could not resolve size for file ${row.id}: ${(err as Error).message}`,
        );
        continue;
      }

      if (size > 0) {
        const metadata =
          typeof row.metadata === 'object' && row.metadata !== null
            ? { ...(row.metadata as Record<string, unknown>), fileSize: size }
            : { fileSize: size };
        await tx.file.update({
          where: { id: row.id },
          data: { fileSize: size, metadata: metadata as Prisma.InputJsonValue },
        });
      }
    }
  }
}
