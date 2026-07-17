import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Provider } from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';

@Injectable()
export class UsersRepository {
  constructor(
    private _user: PrismaRepository<'user'>,
    private _session: PrismaRepository<'session'>,
    private _profile: PrismaRepository<'userProfile'>
  ) {}

  async getNamesByIds(ids: string[]): Promise<Map<string, string>> {
    const rows = await this._user.model.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, profile: { select: { name: true } } },
    });
    return new Map(
      rows.map((r) => [r.id, r.profile?.name || r.email || r.id])
    );
  }

  // NOTE: not org-scoped — resolves users by id alone. Only call with ids already
  // obtained from an org-scoped row (e.g. a campaign's createdById). Do not pass
  // client-supplied ids, or it becomes a cross-org profile lookup.
  async getPublicProfilesByIds(
    ids: string[]
  ): Promise<Map<string, { id: string; name: string; email: string; avatarUrl: string | null }>> {
    const rows = await this._user.model.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        email: true,
        profile: {
          select: {
            name: true,
            lastName: true,
            avatarUrl: true,
            picture: { select: { path: true } },
          },
        },
      },
    });
    return new Map(
      rows.map((r) => {
        const fullName = [r.profile?.name, r.profile?.lastName]
          .filter(Boolean)
          .join(' ')
          .trim();
        return [
          r.id,
          {
            id: r.id,
            name: fullName || r.email,
            email: r.email,
            avatarUrl: r.profile?.avatarUrl || r.profile?.picture?.path || null,
          },
        ];
      })
    );
  }

  getImpersonateUser(name: string) {
    return this._user.model.user.findMany({
      where: {
        OR: [
          {
            profile: {
              name: {
                contains: name,
              },
            },
          },
          {
            email: {
              contains: name,
            },
          },
          {
            id: {
              contains: name,
            },
          },
        ],
      },
      select: {
        id: true,
        email: true,
        profile: {
          select: {
            name: true,
          },
        },
      },
      take: 10,
    });
  }

  getUserById(id: string) {
    return this._user.model.user.findFirst({
      where: {
        id,
      },
      include: {
        profile: {
          select: {
            name: true,
            avatarUrl: true,
            timezone: true,
            picture: {
              select: {
                id: true,
                path: true,
              },
            },
          },
        },
      },
    });
  }

  getUserByEmail(email: string) {
    return this._user.model.user.findFirst({
      where: {
        email,
        providerName: Provider.LOCAL,
      },
      include: {
        profile: {
          select: {
            picture: {
              select: {
                id: true,
                path: true,
              },
            },
          },
        },
      },
    });
  }

  activateUser(id: string) {
    return this._user.model.user.update({
      where: {
        id,
      },
      data: {
        activated: true,
      },
    });
  }

  getUserByProvider(providerId: string, provider: Provider) {
    return this._user.model.user.findFirst({
      where: {
        providerId,
        providerName: provider,
      },
    });
  }

  updatePassword(id: string, password: string) {
    return this._user.model.user.update({
      where: {
        id,
        providerName: Provider.LOCAL,
      },
      data: {
        password: AuthService.hashPassword(password),
      },
    });
  }

  async getPersonal(userId: string) {
    const user = await this._user.model.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        profile: {
          select: {
            name: true,
            lastName: true,
            bio: true,
            avatarUrl: true,
            timezone: true,
            pictureId: true,
            picture: {
              select: {
                id: true,
                path: true,
              },
            },
          },
        },
      },
    });

    if (!user) return null;

    return {
      id: user.id,
      name: user.profile?.name || null,
      lastName: user.profile?.lastName || null,
      bio: user.profile?.bio || null,
      avatarUrl: user.profile?.avatarUrl || null,
      timezone: user.profile?.timezone || null,
      picture: user.profile?.picture || null,
    };
  }

  async changePersonal(userId: string, body: UserDetailDto) {
    await this._profile.model.userProfile.upsert({
      where: {
        userId,
      },
      create: {
        user: { connect: { id: userId } },
        name: body.fullname,
        lastName: body.lastName || null,
        bio: body.bio || null,
        timezone: body.timezone || null,
        picture: body.picture
          ? { connect: { id: body.picture.id } }
          : undefined,
      },
      update: {
        name: body.fullname,
        lastName: body.lastName || null,
        bio: body.bio || null,
        timezone: body.timezone || null,
        picture: body.picture
          ? { connect: { id: body.picture.id } }
          : undefined,
      },
    });
  }

  // ── Sessions ──

  async createSession(data: { userId: string; tokenHash: string; expiresAt: Date; ip: string; userAgent: string }) {
    return this._session.model.session.create({ data });
  }

  async getUserSessions(userId: string) {
    return this._session.model.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ip: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
    });
  }

  async getSessionById(id: string) {
    return this._session.model.session.findUnique({ where: { id } });
  }

  async findSessionByTokenHash(tokenHash: string) {
    return this._session.model.session.findUnique({ where: { tokenHash } });
  }

  async findSessionByPreviousTokenHash(previousTokenHash: string) {
    return this._session.model.session.findFirst({
      where: { previousTokenHash },
    });
  }

  async revokeSession(id: string, userId: string) {
    return this._session.model.session.update({
      where: { id, userId },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessionsExcept(userId: string, currentTokenHash: string) {
    return this._session.model.session.updateMany({
      where: {
        userId,
        tokenHash: { not: currentTokenHash },
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserSessions(userId: string) {
    return this._session.model.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async rotateSessionToken(
    id: string,
    userId: string,
    newTokenHash: string,
    previousTokenHash: string,
    ip: string,
    userAgent: string
  ) {
    return this._session.model.session.update({
      where: { id, userId },
      data: {
        tokenHash: newTokenHash,
        previousTokenHash,
        lastUsedAt: new Date(),
        ip,
        userAgent,
      },
    });
  }

  async cleanupExpiredSessions() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    return this._session.model.session.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: thirtyDaysAgo } },
          { revokedAt: { not: null, lt: sevenDaysAgo } },
        ],
      },
    });
  }

  // ── Profile ──

  async updateUserAvatar(userId: string, avatarUrl: string) {
    return this._profile.model.userProfile.upsert({
      where: { userId },
      create: { userId, avatarUrl },
      update: { avatarUrl },
    });
  }

  async getProfileByUserId(userId: string) {
    return this._profile.model.userProfile.findUnique({
      where: { userId },
      include: {
        picture: {
          select: {
            id: true,
            path: true,
          },
        },
      },
    });
  }
}
