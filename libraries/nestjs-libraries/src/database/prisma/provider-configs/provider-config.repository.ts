import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ProviderConfigRepository {
  constructor(
    private _providerConfig: PrismaRepository<'providerConfiguration'>
  ) {}

  getAll() {
    return this._providerConfig.model.providerConfiguration.findMany({
      orderBy: { name: 'asc' },
    });
  }

  getByIdentifier(identifier: string, version = 'v1') {
    return this._providerConfig.model.providerConfiguration.findUnique({
      where: { identifier_version: { identifier, version } },
    });
  }

  getEnabled() {
    return this._providerConfig.model.providerConfiguration.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
    });
  }

  upsert(
    identifier: string,
    data: {
      name: string;
      enabled: boolean;
      clientId?: string;
      clientSecret?: string;
      redirectUri?: string;
      scopes?: string;
      additionalConfig?: string;
      setupInstructions?: string;
    },
    version = 'v1',
  ) {
    return this._providerConfig.model.providerConfiguration.upsert({
      where: { identifier_version: { identifier, version } },
      create: {
        identifier,
        version,
        ...data,
      },
      update: data,
    });
  }

  delete(identifier: string, version = 'v1') {
    return this._providerConfig.model.providerConfiguration.delete({
      where: { identifier_version: { identifier, version } },
    });
  }

  setEnabled(identifier: string, enabled: boolean, version = 'v1') {
    return this._providerConfig.model.providerConfiguration.update({
      where: { identifier_version: { identifier, version } },
      data: { enabled },
    });
  }
}
