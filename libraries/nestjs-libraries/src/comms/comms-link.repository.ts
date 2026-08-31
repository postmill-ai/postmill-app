import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class CommsLinkRepository {
  constructor(private _prisma: PrismaService) {}

  getById(orgId: string, id: string) {
    return this._prisma.commsUserLink.findFirst({
      where: { id, organizationId: orgId },
    });
  }

  listForOrg(orgId: string) {
    return this._prisma.commsUserLink.findMany({
      where: { organizationId: orgId },
      include: {
        user: { select: { id: true, email: true, profile: { select: { name: true } } } },
        config: { select: { identifier: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  getByExternalUser(configId: string, externalUserId: string) {
    return this._prisma.commsUserLink.findFirst({
      where: { configId, externalUserId, status: 'linked' },
    });
  }

  getByConfigAndUser(configId: string, userId: string) {
    return this._prisma.commsUserLink.findFirst({
      where: { configId, userId },
    });
  }

  // Linked rows for a set of users in an org, joined with their configs — the
  // notification fan-out query.
  getLinkedForUsers(orgId: string, userIds: string[]) {
    return this._prisma.commsUserLink.findMany({
      where: {
        organizationId: orgId,
        userId: { in: userIds },
        status: 'linked',
        config: { enabled: true },
      },
      include: { config: true },
    });
  }

  isOrgMember(orgId: string, userId: string) {
    return this._prisma.userOrganization.findFirst({
      where: { organizationId: orgId, userId, disabled: false },
    });
  }

  create(data: {
    organizationId: string;
    configId: string;
    userId: string;
    connectCode: string;
    connectCodeExpiresAt: Date;
    agentChatEnabled: boolean;
    categories: Prisma.InputJsonValue;
  }) {
    return this._prisma.commsUserLink.create({ data });
  }

  update(
    orgId: string,
    id: string,
    data: {
      agentChatEnabled?: boolean;
      categories?: Prisma.InputJsonValue;
      connectCode?: string | null;
      connectCodeExpiresAt?: Date | null;
      status?: string;
    },
  ) {
    return this._prisma.commsUserLink.updateMany({
      where: { id, organizationId: orgId },
      data,
    });
  }

  // Atomic claim: only a still-pending, unexpired row with this exact code
  // flips to linked. count 0 = invalid/expired/already claimed.
  claim(
    configId: string,
    connectCode: string,
    data: {
      externalUserId: string;
      externalDisplayName?: string;
      externalChannelId?: string;
    },
  ) {
    return this._prisma.commsUserLink.updateMany({
      where: {
        configId,
        connectCode,
        status: 'pending',
        connectCodeExpiresAt: { gt: new Date() },
      },
      data: {
        ...data,
        status: 'linked',
        linkedAt: new Date(),
        connectCode: null,
        connectCodeExpiresAt: null,
      },
    });
  }

  getByCode(configId: string, connectCode: string) {
    return this._prisma.commsUserLink.findFirst({
      where: { configId, connectCode },
    });
  }

  setExternalChannelId(id: string, externalChannelId: string) {
    return this._prisma.commsUserLink.updateMany({
      where: { id },
      data: { externalChannelId },
    });
  }

  delete(orgId: string, id: string) {
    return this._prisma.commsUserLink.deleteMany({
      where: { id, organizationId: orgId },
    });
  }
}
