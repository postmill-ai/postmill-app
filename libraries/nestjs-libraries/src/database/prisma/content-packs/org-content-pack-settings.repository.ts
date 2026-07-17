import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class OrgContentPackSettingsRepository {
  constructor(
    private _contentPackConfig: PrismaRepository<'contentPackConfig'>,
    private _organization: PrismaRepository<'organization'>,
  ) {}

  getByOrg(orgId: string) {
    return this._contentPackConfig.model.contentPackConfig.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  getByIdentifier(orgId: string, identifier: string, version = 'v1') {
    return this._contentPackConfig.model.contentPackConfig.findUnique({
      where: { organizationId_identifier_version: { organizationId: orgId, identifier, version } },
    });
  }

  upsert(
    orgId: string,
    identifier: string,
    data: {
      credentials?: string;
      extraConfig?: any;
    },
    version = 'v1',
  ) {
    return this._contentPackConfig.model.contentPackConfig.upsert({
      where: { organizationId_identifier_version: { organizationId: orgId, identifier, version } },
      create: {
        organizationId: orgId,
        identifier,
        version,
        ...data,
      },
      update: data,
    });
  }

  delete(orgId: string, identifier: string, version?: string) {
    // 6.3: don't hardcode 'v1'. When a version is given, delete just that row;
    // otherwise remove the config across all pinned versions of the identifier
    // (a delete should not silently leave a v2 row behind).
    return this._contentPackConfig.model.contentPackConfig.deleteMany({
      where: { organizationId: orgId, identifier, ...(version ? { version } : {}) },
    });
  }

  getActivePointer(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: { id: orgId },
      select: { activeContentPackIdentifier: true },
    });
  }

  setActivePointer(orgId: string, identifier: string | null) {
    return this._organization.model.organization.update({
      where: { id: orgId },
      data: { activeContentPackIdentifier: identifier },
    });
  }
}
