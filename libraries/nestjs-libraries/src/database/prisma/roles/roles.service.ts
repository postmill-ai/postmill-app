import { BadRequestException, Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { User } from '@prisma/client';
import { RolesRepository } from './roles.repository';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';

type RolePermissionRow = { permission: { resource: string; action: string } };
type AssignableRole = {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  permissions: RolePermissionRow[];
};

@Injectable()
export class RolesService {
  private readonly _logger = new Logger(RolesService.name);
  constructor(
    private _repository: RolesRepository,
    private _audit: AuditService
  ) {}

  // Best-effort audit (B4): a logging failure must never break the role mutation.
  private async _audited(entry: {
    organizationId: string;
    action: string;
    entity: string;
    entityId?: string;
    entityName?: string;
    details?: string;
  }) {
    try {
      await this._audit.create(entry);
    } catch (err) {
      this._logger.warn(`Failed to audit ${entry.action}: ${(err as any)?.message}`);
    }
  }

  getRoles(orgId: string) {
    return this._repository.getRoles(orgId);
  }

  getRole(orgId: string, roleId: string) {
    return this._repository.getRole(orgId, roleId);
  }

  async createRole(
    orgId: string,
    data: { key: string; name: string; description?: string; permissionIds: string[] },
  ) {
    if (!data.permissionIds || data.permissionIds.length === 0) {
      throw new HttpException('At least one permission is required', HttpStatus.BAD_REQUEST);
    }

    const permissions = await this._repository.getPermissions();
    const validIds = new Set(permissions.map((p) => p.id));
    const invalidIds = data.permissionIds.filter((id) => !validIds.has(id));
    if (invalidIds.length > 0) {
      throw new HttpException(
        `Invalid permission IDs: ${invalidIds.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const created = await this._repository.createRole(orgId, data);
    await this._audited({
      organizationId: orgId,
      action: 'role.create',
      entity: 'role',
      entityId: created?.id,
      entityName: data.name,
      details: JSON.stringify({ key: data.key, permissionIds: data.permissionIds }),
    });
    return created;
  }

  async updateRole(
    orgId: string,
    roleId: string,
    data: { name?: string; description?: string; permissionIds?: string[] },
  ) {
    if (data.permissionIds !== undefined) {
      if (data.permissionIds.length === 0) {
        throw new HttpException('At least one permission is required', HttpStatus.BAD_REQUEST);
      }

      const permissions = await this._repository.getPermissions();
      const validIds = new Set(permissions.map((p) => p.id));
      const invalidIds = data.permissionIds.filter((id) => !validIds.has(id));
      if (invalidIds.length > 0) {
        throw new HttpException(
          `Invalid permission IDs: ${invalidIds.join(', ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const role = await this._repository.getRole(orgId, roleId);
    if (!role) return null;
    if (role.isSystem) {
      throw new HttpException('Cannot modify system roles', HttpStatus.FORBIDDEN);
    }

    const updated = await this._repository.updateRole(orgId, roleId, data);
    await this._audited({
      organizationId: orgId,
      action: 'role.update',
      entity: 'role',
      entityId: roleId,
      entityName: data.name ?? role.name,
      details: JSON.stringify(data),
    });
    return updated;
  }

  async deleteRole(orgId: string, roleId: string) {
    const role = await this._repository.getRole(orgId, roleId);
    if (!role) return null;
    if (role.isSystem) {
      throw new HttpException('Cannot delete system roles', HttpStatus.FORBIDDEN);
    }

    const deleted = await this._repository.deleteRole(orgId, roleId);
    await this._audited({
      organizationId: orgId,
      action: 'role.delete',
      entity: 'role',
      entityId: roleId,
      entityName: role.name,
    });
    return deleted;
  }

  async assignRoleToMember(
    orgId: string,
    actor: User,
    targetUserId: string,
    roleId: string
  ) {
    const targetRole = await this._repository.getRole(orgId, roleId);
    if (!targetRole) {
      throw new HttpException('Role not found', HttpStatus.NOT_FOUND);
    }

    // Superadmins bypass the privilege ceiling (they already bypass
    // OrgRbacGuard) — but never the last-owner guard below.
    if (!actor.isSuperAdmin) {
      const actorEff = await this.getEffectivePermissions(orgId, actor.id);
      if (!actorEff) {
        throw new HttpException(
          'Not a member of this organization',
          HttpStatus.FORBIDDEN
        );
      }
      this._assertAssignableRole(targetRole, actorEff);
    }

    await this._assertNotLastOwnerDemotion(orgId, targetUserId, targetRole);

    const result = await this._repository.assignRoleToMember(orgId, targetUserId, roleId);
    if (!result) {
      throw new HttpException('Member not found in organization', HttpStatus.NOT_FOUND);
    }

    await this._audited({
      organizationId: orgId,
      action: 'member.role.assign',
      entity: 'member',
      entityId: targetUserId,
      entityName: targetRole.name,
      details: JSON.stringify({ memberUserId: targetUserId, roleId, actorUserId: actor.id }),
    });
    return result;
  }

  /**
   * F1 — the shared role-assignment ceiling for team-user creation, invites
   * and the legacy role-change route: the actor may only assign a role whose
   * (manage-expanded) permission set is a subset of their own effective set.
   * Superadmins bypass. Throws 400 when the role does not resolve in the org.
   */
  async assertCanAssignRole(orgId: string, actor: User, roleId: string) {
    if (actor.isSuperAdmin) {
      return;
    }
    const targetRole = await this._repository.getRole(orgId, roleId);
    if (!targetRole) {
      throw new BadRequestException('Role not found in organization');
    }
    const actorEff = await this.getEffectivePermissions(orgId, actor.id);
    if (!actorEff) {
      throw new HttpException(
        'Not a member of this organization',
        HttpStatus.FORBIDDEN
      );
    }
    this._assertAssignableRole(targetRole, actorEff);
  }

  countOwners(orgId: string) {
    return this._repository.countOwners(orgId);
  }

  // Mirrors OrgRbacGuard's wildcard semantics: `resource:manage` implies all
  // five actions. Both sides of the subset check are expanded so an owner
  // holding only the 18 seeded `resource:manage` rows can still assign the
  // lower roles (without expansion an owner could assign nothing).
  private _expandManage(permissions: string[]): Set<string> {
    const expanded = new Set<string>();
    for (const permission of permissions) {
      expanded.add(permission);
      if (permission.endsWith(':manage')) {
        const resource = permission.slice(0, -':manage'.length);
        for (const action of ['create', 'read', 'update', 'delete', 'manage']) {
          expanded.add(`${resource}:${action}`);
        }
      }
    }
    return expanded;
  }

  private _assertAssignableRole(
    targetRole: AssignableRole,
    actorEff: { role: string; permissions: string[] }
  ) {
    const actorPerms = this._expandManage(actorEff.permissions);
    const targetPerms = this._expandManage(
      targetRole.permissions.map(
        (rp) => `${rp.permission.resource}:${rp.permission.action}`
      )
    );
    for (const permission of targetPerms) {
      if (!actorPerms.has(permission)) {
        throw new HttpException(
          'Cannot assign a role with permissions beyond your own',
          HttpStatus.FORBIDDEN
        );
      }
    }

    if (
      targetRole.isSystem &&
      targetRole.key === 'owner' &&
      actorEff.role !== 'owner'
    ) {
      throw new HttpException(
        'Only an owner can assign the owner role',
        HttpStatus.FORBIDDEN
      );
    }
  }

  // Unconditional (applies even to a superadmin actor): demoting the sole
  // enabled owner would strand the org, so it is always rejected.
  private async _assertNotLastOwnerDemotion(
    orgId: string,
    targetUserId: string,
    targetRole: { id: string }
  ) {
    const ownerRoleId = await this._repository.getOwnerRoleId();
    if (!ownerRoleId || targetRole.id === ownerRoleId) {
      return; // assigning the owner role can never strand the org
    }
    const membership = await this._repository.getMemberRoleId(orgId, targetUserId);
    if (membership?.roleId !== ownerRoleId) {
      return;
    }
    const owners = await this._repository.countOwners(orgId);
    if (owners <= 1) {
      throw new HttpException(
        'Cannot remove the last owner',
        HttpStatus.FORBIDDEN
      );
    }
  }

  getPermissions() {
    return this._repository.getPermissions();
  }

  /**
   * Resolves the acting member's effective permission set for an org —
   * the single resolution path shared by `OrgRbacGuard` and `GET /settings/roles/me`.
   * Returns null when the user is not an enabled member or has no role assigned.
   */
  async getEffectivePermissions(
    orgId: string,
    userId: string,
  ): Promise<{ role: string; permissions: string[] } | null> {
    const membership = await this._repository.getMemberEffectivePermissions(
      orgId,
      userId,
    );
    if (!membership || !membership.roleRef) {
      return null;
    }

    return {
      role: membership.roleRef.key,
      permissions: membership.roleRef.permissions.map(
        (rp) => `${rp.permission.resource}:${rp.permission.action}`,
      ),
    };
  }
}
