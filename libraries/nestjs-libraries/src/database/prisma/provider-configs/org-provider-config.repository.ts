import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

type ConfigData = {
  name?: string;
  enabled?: boolean;
  clientId?: string | null;
  clientSecret?: string | null;
  redirectUri?: string | null;
  scopes?: string | null;
  additionalConfig?: string | null;
  setupNotes?: string | null;
  vpnSelection?: string | null;
  version?: string;
};

@Injectable()
export class OrgProviderConfigRepository {
  constructor(
    private _orgProviderConfig: PrismaRepository<'orgProviderConfiguration'>
  ) {}

  getByOrg(orgId: string) {
    return this._orgProviderConfig.model.orgProviderConfiguration.findMany({
      where: { organizationId: orgId },
      orderBy: [{ identifier: 'asc' }, { name: 'asc' }],
    });
  }

  getById(orgId: string, id: string) {
    return this._orgProviderConfig.model.orgProviderConfiguration.findFirst({
      where: { id, organizationId: orgId },
    });
  }

  // Fallback resolution by provider type for legacy integrations that aren't bound
  // to a specific config: prefer an enabled config, then the most recently updated.
  getByIdentifier(orgId: string, identifier: string) {
    return this._orgProviderConfig.model.orgProviderConfiguration.findFirst({
      where: { organizationId: orgId, identifier },
      orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  getEnabledByOrg(orgId: string) {
    return this._orgProviderConfig.model.orgProviderConfiguration.findMany({
      where: { organizationId: orgId, enabled: true },
      orderBy: { name: 'asc' },
    });
  }

  create(
    orgId: string,
    data: ConfigData & { identifier: string; name: string; version?: string }
  ) {
    return this._orgProviderConfig.model.orgProviderConfiguration.create({
      data: {
        organizationId: orgId,
        identifier: data.identifier,
        name: data.name,
        version: data.version ?? 'v1',
        enabled: data.enabled ?? false,
        clientId: data.clientId ?? null,
        clientSecret: data.clientSecret ?? null,
        redirectUri: data.redirectUri ?? null,
        scopes: data.scopes ?? null,
        additionalConfig: data.additionalConfig ?? null,
        setupNotes: data.setupNotes ?? null,
        vpnSelection: data.vpnSelection ?? null,
      },
    });
  }

  updateById(orgId: string, id: string, data: ConfigData) {
    return this._orgProviderConfig.model.orgProviderConfiguration.update({
      where: { id, organizationId: orgId },
      data,
    });
  }

  setEnabledById(orgId: string, id: string, enabled: boolean) {
    return this._orgProviderConfig.model.orgProviderConfiguration.update({
      where: { id, organizationId: orgId },
      data: { enabled },
    });
  }

  deleteById(orgId: string, id: string) {
    return this._orgProviderConfig.model.orgProviderConfiguration.delete({
      where: { id, organizationId: orgId },
    });
  }
}
