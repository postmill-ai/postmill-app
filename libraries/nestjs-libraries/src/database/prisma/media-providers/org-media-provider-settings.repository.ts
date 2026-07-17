import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class OrgMediaProviderSettingsRepository {
  constructor(
    private _mediaProviderConfig: PrismaRepository<'mediaProviderConfig'>,
  ) {}

  getByOrg(orgId: string) {
    return this._mediaProviderConfig.model.mediaProviderConfig.findMany({
      where: { organizationId: orgId },
    });
  }

  getByIdentifier(orgId: string, identifier: string, version = 'v1') {
    return this._mediaProviderConfig.model.mediaProviderConfig.findUnique({
      where: { organizationId_identifier_version: { organizationId: orgId, identifier, version } },
    });
  }

  // 1.2: version-AGNOSTIC read so _getPinnedVersion finds a v2-pinned row instead
  // of findUnique defaulting to v1 and returning null. Enabled rows first (an org
  // holding an enabled v1 + a disabled v2 rollback row must resolve the enabled
  // one), then newest.
  findAnyByIdentifier(orgId: string, identifier: string) {
    return this._mediaProviderConfig.model.mediaProviderConfig.findFirst({
      where: { organizationId: orgId, identifier },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /** Identifiers enabled in at least one org — for the platform-admin overview. */
  async getEnabledIdentifiers(): Promise<string[]> {
    const rows = await this._mediaProviderConfig.model.mediaProviderConfig.findMany({
      where: { enabled: true },
      select: { identifier: true },
      distinct: ['identifier'],
    });
    return rows.map((r) => r.identifier);
  }

  upsert(
    orgId: string,
    identifier: string,
    data: {
      enabled?: boolean;
      credentials?: string;
      storageProviderId?: string;
      storageRootFolderId?: string;
      accountFingerprint?: string;
      extraConfig?: string;
      version?: string;
    },
    version = 'v1',
  ) {
    return this._mediaProviderConfig.model.mediaProviderConfig.upsert({
      where: { organizationId_identifier_version: { organizationId: orgId, identifier, version } },
      create: { organizationId: orgId, identifier, version, ...data },
      update: data,
    });
  }

  /**
   * Mark one provider as the org's Primary (call-time default). Clears the
   * previous Primary's `isActive` only — never touches other rows' `enabled`
   * (enable-many + one Primary, plan §1.4). Mirrors the AI repo pattern.
   */
  async setActive(orgId: string, identifier: string, version = 'v1') {
    await this._mediaProviderConfig.model.mediaProviderConfig.updateMany({
      where: { organizationId: orgId, isActive: true },
      data: { isActive: false },
    });
    return this._mediaProviderConfig.model.mediaProviderConfig.update({
      where: { organizationId_identifier_version: { organizationId: orgId, identifier, version } },
      data: { isActive: true, enabled: true },
    });
  }

  delete(orgId: string, identifier: string, version = 'v1') {
    return this._mediaProviderConfig.model.mediaProviderConfig.delete({
      where: { organizationId_identifier_version: { organizationId: orgId, identifier, version } },
    });
  }
}
