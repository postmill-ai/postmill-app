import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ShortLinkPreference, SubscriptionTier, Provider, StorageProviderType } from '@prisma/client';
import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

// Terms-of-Service version recorded at account creation (I4 — consent tracking).
// Bump when the ToS materially changes so re-acceptance can be detected.
export const TOS_VERSION = '1.0';

@Injectable()
export class OrganizationRepository {
  constructor(
    private _organization: PrismaRepository<'organization'>,
    private _userOrg: PrismaRepository<'userOrganization'>,
    private _user: PrismaRepository<'user'>,
    private _storage: PrismaRepository<'storageProviderConfig'>,
    private _appRole: PrismaRepository<'appRole'>
  ) {}

  async createMaxUser(id: string, name: string, saasName: string, email: string) {
    const ownerRole = await this._appRole.model.appRole.findFirst({
      where: { organizationId: null, key: 'owner', isSystem: true },
    });
    return this._organization.model.organization.create({
      select: {
        id: true,
      },
      data: {
        name: name ? `${name}###${id}` : `Unnamed User###${id}`,
        isTrailing: false,
        subscription: {
          create: {
            totalChannels: 1000000,
            subscriptionTier: 'AGENCY',
            isLifetime: true,
            period: 'YEARLY',
          },
        },
        users: {
          create: {
            roleRef: ownerRole ? { connect: { id: ownerRole.id } } : undefined,
            user: {
              create: {
                activated: true,
                email: email
                  ? email.split('@').join(`+${saasName}@`)
                  : `${saasName}+` + makeId(10) + '@postiz.com',
                providerName: 'LOCAL',
                password: AuthService.hashPassword(makeId(500)),
                profile: {
                  create: {
                    name: name ? `${name}###${id}` : `Unnamed User###${id}`,
                  },
                },
              },
            },
          },
        },
        storageProviders: {
          create: {
            type: StorageProviderType.LOCAL,
            name: 'Local Storage',
          },
        },
      },
    });
  }

  getCount() {
    return this._organization.model.organization.count();
  }

  getAllIds() {
    return this._organization.model.organization.findMany({
      select: { id: true },
    });
  }

  getUserOrg(id: string) {
    return this._userOrg.model.userOrganization.findFirst({
      where: {
        id,
      },
      select: {
        user: true,
        organization: {
          include: {
            users: {
              select: {
                id: true,
                disabled: true,
                roleId: true,
                userId: true,
                roleRef: {
                  select: {
                    key: true,
                  },
                },
              },
            },
            subscription: {
              select: {
                subscriptionTier: true,
                totalChannels: true,
                isLifetime: true,
              },
            },
          },
        },
      },
    });
  }

  getImpersonateUser(name: string) {
    return this._userOrg.model.userOrganization.findMany({
      where: {
        OR: [
          {
            organizationId: {
              contains: name,
            },
          },
          {
            user: {
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
          },
        ],
      },
      select: {
        id: true,
        organization: {
          select: {
            id: true,
          },
        },
        user: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });
  }

  async getOrgsByUserId(userId: string) {
    return this._organization.model.organization.findMany({
      where: {
        users: {
          some: {
            userId,
          },
        },
      },
      include: {
        users: {
          where: {
            userId,
          },
          select: {
            disabled: true,
            roleId: true,
            roleRef: {
              select: {
                key: true,
              },
            },
          },
        },
        subscription: {
          select: {
            subscriptionTier: true,
            totalChannels: true,
            isLifetime: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async getOrgById(id: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id,
      },
    });
  }

  async addUserToOrg(
    userId: string,
    id: string,
    orgId: string,
    role: 'USER' | 'ADMIN',
    roleId?: string,
  ) {
    const checkIfInviteExists = await this._user.model.user.findFirst({
      where: {
        inviteId: id,
      },
    });

    if (checkIfInviteExists) {
      return false;
    }

    const checkForSubscription =
      await this._organization.model.organization.findFirst({
        where: {
          id: orgId,
        },
        select: {
          subscription: true,
        },
      });

    if (
      process.env.STRIPE_PUBLISHABLE_KEY &&
      checkForSubscription?.subscription?.subscriptionTier ===
        SubscriptionTier.STARTER
    ) {
      return false;
    }

    const appRole = roleId
      ? await this._resolveOrgRole(orgId, roleId)
      : await this._appRole.model.appRole.findFirst({
          where: { organizationId: null, key: role === 'ADMIN' ? 'admin' : 'member', isSystem: true },
        });

    const create = await this._userOrg.model.userOrganization.create({
      data: {
        roleId: appRole?.id,
        userId,
        organizationId: orgId,
      },
    });

    await this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        inviteId: id,
      },
    });

    return create;
  }

  async createOrgAndUser(
    body: Omit<CreateOrgUserDto, 'providerToken'> & { providerId?: string; name?: string; lastName?: string },
    hasEmail: boolean,
    ip: string,
    userAgent: string
  ) {
    const ownerRole = await this._appRole.model.appRole.findFirst({
      where: { organizationId: null, key: 'owner', isSystem: true },
    });
    return this._organization.model.organization.create({
      data: {
        name: body.company,
        allowTrial: true,
        isTrailing: true,
        users: {
          create: {
            roleRef: ownerRole ? { connect: { id: ownerRole.id } } : undefined,
            user: {
              create: {
                activated: body.provider !== 'LOCAL' || !hasEmail,
                email: body.email,
                password: body.password
                  ? AuthService.hashPassword(body.password)
                  : '',
                providerName: body.provider,
                providerId: body.providerId || '',
                ip,
                agent: userAgent,
                tosAcceptedAt: new Date(),
                tosVersion: TOS_VERSION,
                profile: {
                  create: {
                    name: body.name || null,
                    lastName: body.lastName || null,
                  },
                },
              },
            },
          },
        },
        storageProviders: {
          create: {
            type: StorageProviderType.LOCAL,
            name: 'Local Storage',
          },
        },
      },
      select: {
        id: true,
        users: {
          select: {
            user: {
              include: {
                profile: true,
              },
            },
          },
        },
      },
    });
  }

  getOrgByCustomerId(customerId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        paymentId: customerId,
      },
    });
  }

  async setStreak(organizationId: string, type: 'start' | 'end') {
    try {
      await this._organization.model.organization.update({
        where: {
          id: organizationId,
          ...(type === 'start'
            ? {
                streakSince: null,
              }
            : {}),
        },
        data: {
          ...(type === 'end' ? { streakSince: null } : {}),
          ...(type === 'start' ? { streakSince: new Date() } : {}),
        },
      });
    } catch (err) {}
  }

  async createTeamUser(orgId: string, email: string, password: string, roleKey: string, roleId?: string) {
    // Resolve the role before creating the user so a rejected roleId does not
    // leave an orphaned user row behind.
    const appRole = roleId
      ? await this._resolveOrgRole(orgId, roleId)
      : await this._appRole.model.appRole.findFirst({
          where: { organizationId: null, key: roleKey, isSystem: true },
        });

    const user = await this._user.model.user.create({
      data: {
        email,
        password: AuthService.hashPassword(password),
        providerName: Provider.LOCAL,
        activated: true,
      },
    });

    await this._userOrg.model.userOrganization.create({
      data: {
        userId: user.id,
        organizationId: orgId,
        roleId: appRole?.id,
      },
    });

    return { id: user.id, email: user.email, role: appRole?.key ?? roleKey };
  }

  // Tenant-guarded member profile: returns null when the user is not a member of
  // this org (the findFirst scope is the access check), so callers cannot look up
  // an arbitrary user across orgs.
  async getMemberProfile(orgId: string, userId: string) {
    return this._userOrg.model.userOrganization.findFirst({
      where: { organizationId: orgId, userId, disabled: false },
      select: {
        createdAt: true,
        roleRef: { select: { key: true, name: true } },
        user: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                name: true,
                lastName: true,
                bio: true,
                avatarUrl: true,
                picture: { select: { path: true } },
              },
            },
          },
        },
      },
    });
  }

  async getTeam(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id: orgId,
      },
      select: {
        users: {
          select: {
            disabled: true,
            roleId: true,
            user: {
              select: {
                activated: true,
                email: true,
                id: true,
                profile: {
                  select: {
                    name: true,
                    pictureId: true,
                  },
                },
              },
            },
            roleRef: {
              select: {
                key: true,
              },
            },
          },
        },
      },
    });
  }

  getAllUsersOrgs(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id: orgId,
      },
      select: {
        users: {
          select: {
            user: {
              select: {
                email: true,
                id: true,
                profile: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  async deleteTeamMember(orgId: string, userId: string) {
    return this._userOrg.model.userOrganization.delete({
      where: {
        userId_organizationId: {
          userId,
          organizationId: orgId,
        },
      },
    });
  }

  async changeTeamMemberRole(
    orgId: string,
    userId: string,
    role: 'USER' | 'ADMIN',
    roleId?: string,
  ) {
    const appRole = roleId
      ? await this._resolveOrgRole(orgId, roleId)
      : await this._appRole.model.appRole.findFirst({
          where: { organizationId: null, key: role === 'ADMIN' ? 'admin' : 'member', isSystem: true },
        });
    return this._userOrg.model.userOrganization.update({
      where: {
        userId_organizationId: {
          userId,
          organizationId: orgId,
        },
      },
      data: { roleId: appRole?.id },
    });
  }

  // F1: a caller-supplied roleId must resolve inside the org scope — a system
  // template role or a role owned by this org. An arbitrary cross-org (or
  // nonexistent) role id is rejected instead of silently trusted.
  private async _resolveOrgRole(orgId: string, roleId: string) {
    const role = await this._appRole.model.appRole.findFirst({
      where: {
        id: roleId,
        OR: [
          { organizationId: null, isSystem: true },
          { organizationId: orgId },
        ],
      },
    });
    if (!role) {
      throw new BadRequestException('Role not found in organization');
    }
    return role;
  }

  async getOwnerRoleId() {
    const role = await this._appRole.model.appRole.findFirst({
      where: { organizationId: null, key: 'owner', isSystem: true },
    });
    return role?.id || '';
  }

  async disableOrEnableNonSuperAdminUsers(orgId: string, disable: boolean) {
    const ownerRole = await this._appRole.model.appRole.findFirst({
      where: { organizationId: null, key: 'owner', isSystem: true },
    });
    return this._userOrg.model.userOrganization.updateMany({
      where: {
        organizationId: orgId,
        roleId: {
          not: ownerRole?.id || '',
        },
      },
      data: {
        disabled: disable,
      },
    });
  }

  /**
   * Disable non-owner members past the requested seat limit.
   * `keep` includes the owner, so keep=1 leaves only the owner enabled.
   */
  async disableExcessNonOwnerUsers(orgId: string, keep: number) {
    const ownerRole = await this._appRole.model.appRole.findFirst({
      where: { organizationId: null, key: 'owner', isSystem: true },
    });
    const ownerRoleId = ownerRole?.id || '';

    const members = await this._userOrg.model.userOrganization.findMany({
      where: {
        organizationId: orgId,
        roleId: { not: ownerRoleId },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    const excess = members.slice(Math.max(0, keep - 1));
    if (!excess.length) return;

    await this._userOrg.model.userOrganization.updateMany({
      where: {
        id: { in: excess.map((m) => m.id) },
      },
      data: { disabled: true },
    });
  }

  getShortlinkPreference(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id: orgId,
      },
      select: {
        shortlink: true,
      },
    });
  }

  updateShortlinkPreference(orgId: string, shortlink: ShortLinkPreference) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        shortlink,
      },
    });
  }

  async markSetupCompleted(orgId: string) {
    return this._organization.model.organization.update({
      where: { id: orgId },
      data: { setupCompletedAt: new Date() },
    });
  }
}
