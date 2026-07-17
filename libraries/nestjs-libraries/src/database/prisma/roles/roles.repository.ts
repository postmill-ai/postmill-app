import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class RolesRepository {
  constructor(
    private _appRole: PrismaRepository<'appRole'>,
    private _permission: PrismaRepository<'permission'>,
    private _appRolePermission: PrismaRepository<'appRolePermission'>,
    private _userOrganization: PrismaRepository<'userOrganization'>,
  ) {}

  getRoles(orgId: string) {
    return this._appRole.model.appRole.findMany({
      where: {
        OR: [
          { organizationId: null, isSystem: true },
          { organizationId: orgId },
        ],
      },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
    });
  }

  getRole(orgId: string, roleId: string) {
    return this._appRole.model.appRole.findFirst({
      where: {
        id: roleId,
        OR: [
          { organizationId: null, isSystem: true },
          { organizationId: orgId },
        ],
      },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });
  }

  async createRole(
    orgId: string,
    data: { key: string; name: string; description?: string; permissionIds: string[] },
  ) {
    const role = await this._appRole.model.appRole.create({
      data: {
        organizationId: orgId,
        key: data.key,
        name: data.name,
        description: data.description,
        isSystem: false,
      },
    });

    if (data.permissionIds.length > 0) {
      await this._appRolePermission.model.appRolePermission.createMany({
        data: data.permissionIds.map((permissionId) => ({
          roleId: role.id,
          permissionId,
        })),
      });
    }

    return this.getRole(orgId, role.id);
  }

  async updateRole(
    orgId: string,
    roleId: string,
    data: { name?: string; description?: string; permissionIds?: string[] },
  ) {
    const role = await this._appRole.model.appRole.findFirst({
      where: { id: roleId, organizationId: orgId, isSystem: false },
    });
    if (!role) return null;

    if (data.name !== undefined || data.description !== undefined) {
      const { count } = await this._appRole.model.appRole.updateMany({
        where: { id: roleId, organizationId: orgId, isSystem: false },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
        },
      });
      if (count === 0) return null;
    }

    if (data.permissionIds !== undefined) {
      await this._appRolePermission.model.appRolePermission.deleteMany({
        where: { roleId },
      });
      if (data.permissionIds.length > 0) {
        await this._appRolePermission.model.appRolePermission.createMany({
          data: data.permissionIds.map((permissionId) => ({
            roleId,
            permissionId,
          })),
        });
      }
    }

    return this.getRole(orgId, roleId);
  }

  async deleteRole(orgId: string, roleId: string) {
    const role = await this._appRole.model.appRole.findFirst({
      where: { id: roleId, organizationId: orgId, isSystem: false },
    });
    if (!role) return null;

    const { count } = await this._appRole.model.appRole.deleteMany({
      where: { id: roleId, organizationId: orgId, isSystem: false },
    });
    if (count === 0) return null;
    return { id: roleId };
  }

  getMemberEffectivePermissions(orgId: string, userId: string) {
    return this._userOrganization.model.userOrganization.findFirst({
      where: { userId, organizationId: orgId, disabled: false },
      include: {
        roleRef: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
      },
    });
  }

  getMemberRoleId(orgId: string, userId: string) {
    return this._userOrganization.model.userOrganization.findFirst({
      where: { userId, organizationId: orgId, disabled: false },
      select: { roleId: true },
    });
  }

  async getOwnerRoleId(): Promise<string | null> {
    const role = await this._appRole.model.appRole.findFirst({
      where: { organizationId: null, key: 'owner', isSystem: true },
      select: { id: true },
    });
    return role?.id ?? null;
  }

  // Enabled members holding the system owner role — the input to the
  // last-owner guard (a zero-owner org is never valid).
  async countOwners(orgId: string): Promise<number> {
    const ownerRoleId = await this.getOwnerRoleId();
    if (!ownerRoleId) {
      return 0;
    }
    return this._userOrganization.model.userOrganization.count({
      where: { organizationId: orgId, roleId: ownerRoleId, disabled: false },
    });
  }

  async assignRoleToMember(orgId: string, userId: string, roleId: string) {
    const membership = await this._userOrganization.model.userOrganization.findFirst({
      where: { userId, organizationId: orgId },
    });
    if (!membership) return null;

    return this._userOrganization.model.userOrganization.update({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      data: { roleId },
    });
  }

  getPermissions() {
    return this._permission.model.permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });
  }
}
