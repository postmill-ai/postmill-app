import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Provider } from '@prisma/client';

@Injectable()
export class AuthProviderRepository {
  constructor(
    private _authProviderConfig: PrismaRepository<'authProviderConfig'>
  ) {}

  list() {
    return this._authProviderConfig.model.authProviderConfig.findMany({
      orderBy: { provider: 'asc' },
    });
  }

  findByProvider(provider: Provider, version = 'v1') {
    return this._authProviderConfig.model.authProviderConfig.findUnique({
      where: { provider_version: { provider, version } },
    });
  }

  upsert(provider: Provider, data: {
    enabled?: boolean;
    clientId?: string;
    clientSecret?: string;
    authUrl?: string;
    tokenUrl?: string;
    userInfoUrl?: string;
    scopes?: string;
    displayName?: string;
  }, version = 'v1') {
    return this._authProviderConfig.model.authProviderConfig.upsert({
      where: { provider_version: { provider, version } },
      create: { provider, version, ...data },
      update: data,
    });
  }

  delete(provider: Provider, version = 'v1') {
    return this._authProviderConfig.model.authProviderConfig.delete({
      where: { provider_version: { provider, version } },
    });
  }
}
