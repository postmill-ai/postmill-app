import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class CommsConfigRepository {
  constructor(private _prisma: PrismaService) {}

  getByOrg(orgId: string) {
    return this._prisma.commsProviderConfig.findMany({
      where: { organizationId: orgId },
    });
  }

  getById(configId: string) {
    return this._prisma.commsProviderConfig.findFirst({ where: { id: configId } });
  }

  getByIdentifier(orgId: string, identifier: string) {
    return this._prisma.commsProviderConfig.findFirst({
      where: { organizationId: orgId, identifier },
    });
  }

  // Webhook routing lookup — the token is the sole addressing secret, so the
  // identifier must match too (uniform 404 upstream on any mismatch).
  getByWebhookToken(identifier: string, webhookToken: string) {
    return this._prisma.commsProviderConfig.findFirst({
      where: { webhookToken, identifier },
    });
  }

  getEnabledByIdentifier(identifier: string) {
    return this._prisma.commsProviderConfig.findMany({
      where: { identifier, enabled: true },
    });
  }

  async upsert(
    orgId: string,
    identifier: string,
    data: {
      credentials?: string;
      extraConfig?: Prisma.InputJsonValue;
      enabled?: boolean;
      webhookToken?: string;
    },
    version = 'v1',
  ) {
    const existing = await this.getByIdentifier(orgId, identifier);
    if (existing) {
      // webhookToken is minted once at create time and never rotated in place.
      const { webhookToken: _ignored, ...update } = data;
      const { count } = await this._prisma.commsProviderConfig.updateMany({
        where: { id: existing.id, organizationId: orgId },
        data: update,
      });
      if (count === 0) return null;
      return this.getByIdentifier(orgId, identifier);
    }
    return this._prisma.commsProviderConfig.create({
      data: {
        organizationId: orgId,
        identifier,
        version,
        webhookToken: data.webhookToken!,
        credentials: data.credentials,
        extraConfig: data.extraConfig,
        enabled: data.enabled,
      },
    });
  }

  updateSyncCursor(configId: string, syncCursor: string) {
    return this._prisma.commsProviderConfig.updateMany({
      where: { id: configId },
      data: { syncCursor },
    });
  }

  delete(orgId: string, identifier: string) {
    return this._prisma.commsProviderConfig.deleteMany({
      where: { organizationId: orgId, identifier },
    });
  }
}
