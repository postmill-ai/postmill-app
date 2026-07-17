import { PrismaRepository, PrismaTransaction } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class OrgAiSettingsRepository {
  constructor(
    private _aiOrgProviderConfig: PrismaRepository<'aIOrgProviderConfig'>,
    private _aiSystemSettings: PrismaRepository<'aISystemSettings'>,
    private _transaction: PrismaTransaction,
  ) {}

  getByOrg(orgId: string) {
    return this._aiOrgProviderConfig.model.aIOrgProviderConfig.findMany({
      where: { organizationId: orgId },
    });
  }

  getByIdentifier(orgId: string, identifier: string, version = 'v1') {
    return this._aiOrgProviderConfig.model.aIOrgProviderConfig.findUnique({
      where: { organizationId_identifier_version: { organizationId: orgId, identifier, version } },
    });
  }

  // 1.2: version-AGNOSTIC read. `getByIdentifier` is a findUnique that defaults
  // to version 'v1', so a config pinned to v2 returns null and _getPinnedVersion
  // wrongly falls through to latestActive. Enabled rows first (a disabled
  // rollback row must not shadow the enabled pin), then newest. Mirrors
  // OrgShortLinkSettingsRepository.getByIdentifier (findFirst, no version).
  findAnyByIdentifier(orgId: string, identifier: string) {
    return this._aiOrgProviderConfig.model.aIOrgProviderConfig.findFirst({
      where: { organizationId: orgId, identifier },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
    });
  }

  getActive(orgId: string) {
    return this._aiOrgProviderConfig.model.aIOrgProviderConfig.findFirst({
      where: { organizationId: orgId, isActive: true },
    });
  }

  upsert(
    orgId: string,
    identifier: string,
    data: {
      enabled?: boolean;
      isActive?: boolean;
      credentials?: string;
      defaultModel?: string;
      reasoningModel?: string;
      extraConfig?: string;
    },
    version = 'v1',
  ) {
    return this._aiOrgProviderConfig.model.aIOrgProviderConfig.upsert({
      where: { organizationId_identifier_version: { organizationId: orgId, identifier, version } },
      create: { organizationId: orgId, identifier, version, ...data },
      update: data,
    });
  }

  delete(orgId: string, identifier: string, version = 'v1') {
    return this._aiOrgProviderConfig.model.aIOrgProviderConfig.delete({
      where: { organizationId_identifier_version: { organizationId: orgId, identifier, version } },
    });
  }

  async setActive(orgId: string, identifier: string, version = 'v1') {
    await this._aiOrgProviderConfig.model.aIOrgProviderConfig.updateMany({
      where: { organizationId: orgId, isActive: true },
      data: { isActive: false },
    });
    return this._aiOrgProviderConfig.model.aIOrgProviderConfig.update({
      where: { organizationId_identifier_version: { organizationId: orgId, identifier, version } },
      data: { isActive: true, enabled: true },
    });
  }

  // 0.3: budget caps are per-org, stored under the singleton's
  // `budgetSettings.perOrgCaps[orgId]`. Return ONLY this org's slice — never the
  // whole blob (which would leak `perOrgCaps` = other tenants' org ids + caps).
  // The stored slice uses BudgetService's per-org keys (`monthly`/`daily`);
  // translate back to the client/DTO contract (`monthlyCap`/`dailyCap`) on read.
  async getBudget(orgId: string) {
    const settings = await this._aiSystemSettings.model.aISystemSettings.findUnique({
      where: { id: 'singleton' },
      select: { budgetSettings: true },
    });
    if (settings?.budgetSettings) {
      try {
        const parsed = JSON.parse(settings.budgetSettings);
        const slice = parsed?.perOrgCaps?.[orgId];
        return slice ? this.#budgetSliceToDto(slice) : null;
      } catch { /* fall through */ }
    }
    return null;
  }

  // 0.3: merge the update into this org's slice only, preserving other orgs'
  // caps. 3.10: guard the JSON.parse so a corrupt/legacy blob doesn't 500 every
  // subsequent update (mirror the read path — fall back to `{}`).
  // CRITICAL: `BudgetService.checkBudget` enforces `perOrgCaps[org].monthly` /
  // `.daily` (the `perOrgCaps: Record<string,{monthly?,daily?}>` type), while the
  // client/DTO sends `monthlyCap`/`dailyCap`. Translate to the enforced keys here
  // or the org cap is stored but never enforced.
  async upsertBudget(orgId: string, data: Record<string, any>) {
    // 3.7: the singleton's budgetSettings is now an explicitly MULTI-TENANT blob
    // (perOrgCaps keyed by org). A plain read-modify-write races: two orgs saving
    // concurrently (or a super-admin whole-blob write) silently drop one org's
    // perOrgCaps entry. Serialize the read-modify-write with a row lock inside one
    // interactive transaction. (budgetSettings is a TEXT column, so a JSONB-merge
    // update isn't available — a FOR UPDATE lock is the portable path.)
    return this._transaction.model.$transaction(async (tx) => {
      // Lock the singleton row. No-op when the row doesn't exist yet — two
      // CONCURRENT first-ever writes could then still race (neither locks a
      // nonexistent row; the upsert loser's slice is dropped). Accepted:
      // requires two orgs' very first budget saves in the same instant on a
      // deployment that has never written budgetSettings.
      await tx.$executeRaw`SELECT id FROM "AISystemSettings" WHERE id = 'singleton' FOR UPDATE`;
      const settings = await tx.aISystemSettings.findUnique({
        where: { id: 'singleton' },
      });
      let existing: Record<string, any> = {};
      if (settings?.budgetSettings) {
        try {
          existing = JSON.parse(settings.budgetSettings);
        } catch {
          existing = {};
        }
      }
      const perOrgCaps = { ...(existing.perOrgCaps ?? {}) };
      perOrgCaps[orgId] = {
        ...(perOrgCaps[orgId] ?? {}),
        ...this.#dtoToBudgetSlice(data),
      };
      const budgetSettings = JSON.stringify({ ...existing, perOrgCaps });
      return tx.aISystemSettings.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', budgetSettings },
        update: { budgetSettings },
      });
    });
  }

  // DTO (`monthlyCap`/`dailyCap`) → the per-org slice keys BudgetService enforces
  // (`monthly`/`daily`). `alertThresholdPct` passes through (enforced for alerts).
  // 5.5 (review F1): `enabled` is deliberately DROPPED — the slice is org-writable
  // but a super-admin can impose a cap into the same slice, so persisting an
  // org-sent `enabled:false` would hand tenants a self-exemption switch.
  #dtoToBudgetSlice(data: Record<string, any>): Record<string, any> {
    const { monthlyCap, dailyCap, enabled: _enabled, ...rest } = data ?? {};
    const slice: Record<string, any> = { ...rest };
    if (monthlyCap !== undefined) slice.monthly = monthlyCap;
    if (dailyCap !== undefined) slice.daily = dailyCap;
    return slice;
  }

  // Stored slice (`monthly`/`daily`) → the client/DTO contract
  // (`monthlyCap`/`dailyCap`) so GET round-trips what PUT accepts.
  #budgetSliceToDto(slice: Record<string, any>): Record<string, any> {
    const { monthly, daily, ...rest } = slice ?? {};
    const dto: Record<string, any> = { ...rest };
    if (monthly !== undefined) dto.monthlyCap = monthly;
    if (daily !== undefined) dto.dailyCap = daily;
    return dto;
  }
}
