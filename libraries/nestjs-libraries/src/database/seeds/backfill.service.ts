import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { MigrationLedgerRepository } from '@gitroom/nestjs-libraries/database/prisma/migration-ledger/migration-ledger.repository';
import { DefaultsSeedService } from '@gitroom/nestjs-libraries/ai/defaults/defaults-seed.service';
import { stat } from 'node:fs/promises';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';

// Pre-drop User rows still carry the profile columns that moved to UserProfile;
// the current Prisma client no longer types them, so model the legacy shape here.
type LegacyUserRow = {
  id: string;
  name?: string | null;
  lastName?: string | null;
  bio?: string | null;
  pictureId?: string | null;
  sendSuccessEmails?: boolean;
  sendFailureEmails?: boolean;
  sendStreakEmails?: boolean;
};

// UserProfile email opt-out column -> Notifications V2 category key.
const EMAIL_PREF_COLUMN_TO_CATEGORY: Array<
  [keyof ProfileEmailFlags, string]
> = [
  ['sendSuccessEmails', 'post_published'],
  ['sendFailureEmails', 'post_failed'],
  ['sendStreakEmails', 'streak'],
];

type ProfileEmailFlags = {
  userId: string;
  sendSuccessEmails: boolean;
  sendFailureEmails: boolean;
  sendStreakEmails: boolean;
};

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
    // statement, so a single shared $transaction let one expected failure (e.g. the
    // deprecated UserProfile.send*Emails columns not yet present) cascade 25P02 into
    // every later step — silently skipping the RBAC role backfill and the rest.
    // Per-step isolation keeps an expected/edge failure in one from poisoning the others.
    // Reconciliation scans (oneTime = false, default): they re-scan `where: { …: null }`
    // every boot because new rows with null values can be created later (e.g. a new
    // membership with roleId: null). Marking them "applied" would permanently break self-heal.
    await this._runStep('user profiles', (tx) => this.backfillUserProfiles(tx));
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
    // - notification email prefs reads soon-to-be-dropped UserProfile.send*Emails columns.
    // - RAG media providers self-disables by stripping its blob, but ledger-gate it too so a
    //   re-add of the blob doesn't silently re-run the migration.
    await this._runStep(
      'notification email prefs',
      (tx) => this.backfillNotificationEmailPrefs(tx),
      true,
    );
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
      'budget global-cap cleanup',
      (tx) => this.cleanupLeakedGlobalBudgetCaps(tx),
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
  }

  // PROVIDER_REMEDIATION_02 §0.4: pre-fix org budget writes leaked their org-slice
  // keys (monthlyCap / dailyCap / alertThresholdPct) to the TOP LEVEL of the
  // AISystemSettings.budgetSettings singleton, where BudgetService.checkBudget
  // enforces them as a PLATFORM-GLOBAL cap. Once platform spend passed a leaked
  // value, EVERY tenant 429'd ("Global … cap exceeded") on all four AI surfaces,
  // and the org that set it could no longer see/clear it (getBudget returns only
  // its own perOrgCaps slice). Strip those top-level keys ONCE, preserving
  // perOrgCaps and every other key. Ledger-gated one-time (a super-admin may later
  // set an *intentional* global cap via the whole-blob governance route — this
  // never re-runs to clobber that). Idempotent within the run.
  private async cleanupLeakedGlobalBudgetCaps(tx: Prisma.TransactionClient) {
    // Take the same row lock upsertBudget uses — during a rolling deploy a live
    // replica's budget write racing this read-modify-write would otherwise be
    // clobbered with the stale blob.
    await tx.$executeRaw`SELECT id FROM "AISystemSettings" WHERE id = 'singleton' FOR UPDATE`;
    const settings = await tx.aISystemSettings.findUnique({
      where: { id: 'singleton' },
      select: { budgetSettings: true },
    });
    if (!settings?.budgetSettings) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(settings.budgetSettings);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;

    const hasLeaked =
      'monthlyCap' in parsed ||
      'dailyCap' in parsed ||
      'alertThresholdPct' in parsed;
    if (!hasLeaked) return;

    const {
      monthlyCap,
      dailyCap,
      alertThresholdPct,
      ...cleaned
    } = parsed as Record<string, unknown>;
    // The stripped keys are INDISTINGUISHABLE from an intentional super-admin
    // global cap set via the governance whole-blob route — so never destroy them
    // silently: log the removed values and park them under a backup key
    // (BudgetService reads only its known keys, so the extra key is inert) for an
    // operator to restore via the governance route if the cap was intentional.
    const stripped = {
      ...(monthlyCap !== undefined ? { monthlyCap } : {}),
      ...(dailyCap !== undefined ? { dailyCap } : {}),
      ...(alertThresholdPct !== undefined ? { alertThresholdPct } : {}),
    };
    this._logger.warn(
      `Budget cleanup: stripped top-level global caps from AISystemSettings.budgetSettings ` +
        `(kept under _strippedLegacyGlobalCaps for operator review): ${JSON.stringify(stripped)}`,
    );
    await tx.aISystemSettings.update({
      where: { id: 'singleton' },
      data: {
        budgetSettings: JSON.stringify({
          ...cleaned,
          _strippedLegacyGlobalCaps: stripped,
        }),
      },
    });
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

  private async backfillUserProfiles(tx: Prisma.TransactionClient) {
    try {
      const users: LegacyUserRow[] = await tx.user.findMany({
        where: { profile: null },
      });

      for (const user of users) {
        await tx.userProfile.create({
          data: {
            userId: user.id,
            name: user.name,
            lastName: user.lastName,
            bio: user.bio,
            pictureId: user.pictureId,
            timezone: null,
            sendSuccessEmails: user.sendSuccessEmails,
            sendFailureEmails: user.sendFailureEmails,
            sendStreakEmails: user.sendStreakEmails,
          },
        });
      }
    } catch {
      // Profile fields on User may already be dropped after the destructive push —
      // this backfill is only needed pre-drop.
    }
  }

  // Notifications V2 expand-contract: copy any email opt-OUT still stored on the
  // (deprecated) UserProfile.send*Emails columns into NotificationPreference.categories
  // BEFORE those columns are dropped in the follow-up release. Without this, every
  // user who disabled success/failure/streak emails would silently revert to the
  // opt-in defaults (NotificationPreferenceService self-heals missing categories to
  // email:true on read) and start receiving unwanted mail on deploy.
  // Only opt-outs need carrying — opt-ins already match the defaults. Idempotent:
  // never clobbers a value already written under the new key (a post-deploy save wins).
  private async backfillNotificationEmailPrefs(tx: Prisma.TransactionClient) {
    let profiles: ProfileEmailFlags[];
    try {
      profiles = (await tx.userProfile.findMany({
        where: {
          OR: [
            { sendSuccessEmails: false },
            { sendFailureEmails: false },
            { sendStreakEmails: false },
          ],
        },
        select: {
          userId: true,
          sendSuccessEmails: true,
          sendFailureEmails: true,
          sendStreakEmails: true,
        },
      })) as ProfileEmailFlags[];
    } catch {
      // Columns already dropped (post-contract release) — nothing left to carry.
      return;
    }

    for (const profile of profiles) {
      const optOuts: Record<string, { email: boolean }> = {};
      for (const [column, category] of EMAIL_PREF_COLUMN_TO_CATEGORY) {
        if (profile[column] === false) optOuts[category] = { email: false };
      }
      if (Object.keys(optOuts).length === 0) continue;

      const existing = await tx.notificationPreference.findUnique({
        where: { userId: profile.userId },
      });

      if (!existing) {
        await tx.notificationPreference.create({
          data: { userId: profile.userId, categories: optOuts },
        });
        continue;
      }

      const categories = {
        ...((existing.categories as Record<string, any>) ?? {}),
      };
      let dirty = false;
      for (const [category, value] of Object.entries(optOuts)) {
        // Don't overwrite a value the user already set under the new key.
        if (categories[category]?.email === undefined) {
          categories[category] = { ...(categories[category] ?? {}), ...value };
          dirty = true;
        }
      }
      if (dirty) {
        await tx.notificationPreference.update({
          where: { userId: profile.userId },
          data: { categories },
        });
      }
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
