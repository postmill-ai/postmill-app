import { Injectable } from '@nestjs/common';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class ApiKeysRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: { organizationId: string; userId: string; name: string; hashedKey: string; prefix: string; expiresAt?: Date | null }) {
    return this.prisma.apiKey.create({ data });
  }

  async listForUserOrg(userId: string, orgId: string) {
    return this.prisma.apiKey.findMany({
      where: { userId, organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveByHash(hash: string) {
    return this.prisma.apiKey.findFirst({
      where: {
        hashedKey: hash,
        revokedAt: null,
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] },
        ],
      },
      include: {
        organization: {
          include: {
            subscription: {
              select: {
                subscriptionTier: true,
                totalChannels: true,
                isLifetime: true,
              },
            },
          },
        },
        user: {
          include: {
            organizations: {
              include: {
                roleRef: true,
              },
            },
          },
        },
      },
    });
  }

  async revoke(id: string, userId: string, orgId: string) {
    return this.prisma.apiKey.update({
      where: { id, userId, organizationId: orgId },
      data: { revokedAt: new Date() },
    });
  }

  async touchLastUsed(id: string, organizationId: string) {
    // Throttle writes: only update when lastUsedAt is null or older than a minute,
    // so a busy key doesn't write on every request.
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    return this.prisma.apiKey.updateMany({
      where: {
        id,
        organizationId,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: oneMinuteAgo } }],
      },
      data: { lastUsedAt: new Date() },
    });
  }
}
