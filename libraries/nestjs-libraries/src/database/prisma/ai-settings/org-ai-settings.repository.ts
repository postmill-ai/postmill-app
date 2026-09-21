import { PrismaRepository } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class OrgAiSettingsRepository {
  constructor(
    private _aiOrgProviderConfig: PrismaRepository<'aIOrgProviderConfig'>,
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
      budgetMonthlyCap?: number | null;
      budgetDailyCap?: number | null;
      budgetAlertThresholdPct?: number | null;
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
}
