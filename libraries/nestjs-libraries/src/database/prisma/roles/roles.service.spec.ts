import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, HttpException } from '@nestjs/common';
import { RolesService } from './roles.service';

interface MockRolesRepository {
  getRoles: ReturnType<typeof vi.fn>;
  getRole: ReturnType<typeof vi.fn>;
  createRole: ReturnType<typeof vi.fn>;
  updateRole: ReturnType<typeof vi.fn>;
  deleteRole: ReturnType<typeof vi.fn>;
  assignRoleToMember: ReturnType<typeof vi.fn>;
  getPermissions: ReturnType<typeof vi.fn>;
  getMemberEffectivePermissions: ReturnType<typeof vi.fn>;
  getMemberRoleId: ReturnType<typeof vi.fn>;
  getOwnerRoleId: ReturnType<typeof vi.fn>;
  countOwners: ReturnType<typeof vi.fn>;
}

const perm = (resource: string, action: string) => ({
  permission: { resource, action },
});

// Seeder-faithful role fixtures: owner holds ONLY `resource:manage` rows.
const ownerRole = {
  id: 'role-owner',
  key: 'owner',
  name: 'Owner',
  isSystem: true,
  permissions: [perm('posts', 'manage'), perm('billing', 'manage'), perm('organization', 'manage')],
};
const adminRole = {
  id: 'role-admin',
  key: 'admin',
  name: 'Admin',
  isSystem: true,
  permissions: [perm('posts', 'manage'), perm('posts', 'create'), perm('billing', 'read')],
};
const editorRole = {
  id: 'role-editor',
  key: 'editor',
  name: 'Editor',
  isSystem: true,
  permissions: [perm('posts', 'create'), perm('posts', 'read')],
};
const memberRole = {
  id: 'role-member',
  key: 'member',
  name: 'Member',
  isSystem: true,
  permissions: [perm('posts', 'create'), perm('posts', 'read')],
};
const viewerRole = {
  id: 'role-viewer',
  key: 'viewer',
  name: 'Viewer',
  isSystem: true,
  permissions: [perm('posts', 'read')],
};
const customBillingRole = {
  id: 'role-custom',
  key: 'billing-admin',
  name: 'Billing Admin',
  isSystem: false,
  permissions: [perm('billing', 'manage')],
};

const OWNER_EFF = {
  role: 'owner',
  permissions: ['posts:manage', 'billing:manage', 'organization:manage'],
};
const ADMIN_EFF = {
  role: 'admin',
  permissions: ['posts:manage', 'billing:read', 'organization:read'],
};

const ownerActor = { id: 'u-owner', isSuperAdmin: false } as never;
const adminActor = { id: 'u-admin', isSuperAdmin: false } as never;
const superAdminActor = { id: 'u-sa', isSuperAdmin: true } as never;

describe('RolesService', () => {
  let repository: MockRolesRepository;
  let service: RolesService;

  beforeEach(() => {
    repository = {
      getRoles: vi.fn(),
      getRole: vi.fn(),
      createRole: vi.fn(),
      updateRole: vi.fn(),
      deleteRole: vi.fn(),
      assignRoleToMember: vi.fn(),
      getPermissions: vi.fn(),
      getMemberEffectivePermissions: vi.fn(),
      getMemberRoleId: vi.fn(),
      getOwnerRoleId: vi.fn(),
      countOwners: vi.fn(),
    };
    service = new RolesService(repository as never, { create: vi.fn() } as never);
  });

  describe('getEffectivePermissions', () => {
    it('returns null when the user is not a member', async () => {
      repository.getMemberEffectivePermissions.mockResolvedValue(null);
      expect(await service.getEffectivePermissions('o1', 'u1')).toBeNull();
      expect(repository.getMemberEffectivePermissions).toHaveBeenCalledWith(
        'o1',
        'u1'
      );
    });

    it('returns null when the membership has no role assigned', async () => {
      repository.getMemberEffectivePermissions.mockResolvedValue({
        id: 'uo1',
        roleRef: null,
      });
      expect(await service.getEffectivePermissions('o1', 'u1')).toBeNull();
    });

    it('maps the role key and flattens resource:action permission strings', async () => {
      repository.getMemberEffectivePermissions.mockResolvedValue({
        id: 'uo1',
        roleRef: {
          key: 'editor',
          permissions: [
            { permission: { resource: 'posts', action: 'manage' } },
            { permission: { resource: 'analytics', action: 'read' } },
          ],
        },
      });

      expect(await service.getEffectivePermissions('o1', 'u1')).toEqual({
        role: 'editor',
        permissions: ['posts:manage', 'analytics:read'],
      });
    });
  });

  describe('createRole', () => {
    it('rejects an empty permission set', async () => {
      await expect(
        service.createRole('o1', {
          key: 'k',
          name: 'n',
          permissionIds: [],
        })
      ).rejects.toThrow(HttpException);
    });

    it('rejects unknown permission ids', async () => {
      repository.getPermissions.mockResolvedValue([{ id: 'p1' }]);
      await expect(
        service.createRole('o1', {
          key: 'k',
          name: 'n',
          permissionIds: ['p1', 'bogus'],
        })
      ).rejects.toThrow('Invalid permission IDs: bogus');
    });

    it('creates a role with valid permissions', async () => {
      repository.getPermissions.mockResolvedValue([{ id: 'p1' }]);
      repository.createRole.mockResolvedValue({ id: 'r1' });
      expect(
        await service.createRole('o1', {
          key: 'k',
          name: 'n',
          permissionIds: ['p1'],
        })
      ).toEqual({ id: 'r1' });
    });
  });

  describe('updateRole', () => {
    it('returns null for an unknown role', async () => {
      repository.getRole.mockResolvedValue(null);
      expect(await service.updateRole('o1', 'r1', { name: 'x' })).toBeNull();
    });

    it('refuses to modify system roles', async () => {
      repository.getRole.mockResolvedValue({ id: 'r1', isSystem: true });
      await expect(
        service.updateRole('o1', 'r1', { name: 'x' })
      ).rejects.toThrow('Cannot modify system roles');
    });

    it('rejects clearing all permissions', async () => {
      await expect(
        service.updateRole('o1', 'r1', { permissionIds: [] })
      ).rejects.toThrow(HttpException);
    });

    it('updates a custom role', async () => {
      repository.getPermissions.mockResolvedValue([{ id: 'p1' }]);
      repository.getRole.mockResolvedValue({ id: 'r1', isSystem: false });
      repository.updateRole.mockResolvedValue({ id: 'r1', name: 'x' });
      expect(
        await service.updateRole('o1', 'r1', {
          name: 'x',
          permissionIds: ['p1'],
        })
      ).toEqual({ id: 'r1', name: 'x' });
    });
  });

  describe('deleteRole', () => {
    it('returns null for an unknown role', async () => {
      repository.getRole.mockResolvedValue(null);
      expect(await service.deleteRole('o1', 'r1')).toBeNull();
    });

    it('refuses to delete system roles', async () => {
      repository.getRole.mockResolvedValue({ id: 'r1', isSystem: true });
      await expect(service.deleteRole('o1', 'r1')).rejects.toThrow(
        'Cannot delete system roles'
      );
    });

    it('deletes custom roles', async () => {
      repository.getRole.mockResolvedValue({ id: 'r1', isSystem: false });
      repository.deleteRole.mockResolvedValue({ id: 'r1' });
      expect(await service.deleteRole('o1', 'r1')).toEqual({ id: 'r1' });
    });
  });

  // The service reads the actor's effective permissions through the membership
  // row — build the membership shape the repository would return from the flat
  // { role, permissions } effective set.
  const membershipFromEff = (
    eff: { role: string; permissions: string[] } | null
  ) =>
    eff === null
      ? null
      : {
          id: 'uo-actor',
          roleRef: {
            key: eff.role,
            permissions: eff.permissions.map((p) => {
              const [resource, action] = p.split(':');
              return perm(resource, action);
            }),
          },
        };

  describe('assignRoleToMember', () => {
    it('404s for an unknown role', async () => {
      repository.getRole.mockResolvedValue(null);
      await expect(
        service.assignRoleToMember('o1', ownerActor, 'u1', 'r1')
      ).rejects.toThrow('Role not found');
    });

    it('403s when the actor is not a member of the org', async () => {
      repository.getRole.mockResolvedValue(memberRole);
      repository.getMemberEffectivePermissions.mockResolvedValue(null);
      await expect(
        service.assignRoleToMember('o1', adminActor, 'u1', 'role-member')
      ).rejects.toThrow(HttpException);
      expect(repository.assignRoleToMember).not.toHaveBeenCalled();
    });

    // A1 regression: owner holds only the 18 `resource:manage` rows, so these
    // are all RED unless the subset check expands the manage wildcard.
    it.each([
      ['admin', adminRole],
      ['editor', editorRole],
      ['member', memberRole],
      ['viewer', viewerRole],
    ])('lets an owner assign the %s role', async (_key, role) => {
      repository.getRole.mockResolvedValue(role);
      repository.getMemberEffectivePermissions.mockResolvedValue(
        membershipFromEff(OWNER_EFF)
      );
      repository.getOwnerRoleId.mockResolvedValue('role-owner');
      repository.getMemberRoleId.mockResolvedValue({ roleId: 'role-viewer' });
      repository.assignRoleToMember.mockResolvedValue({ id: 'uo1' });

      await expect(
        service.assignRoleToMember('o1', ownerActor, 'u-target', role.id)
      ).resolves.toEqual({ id: 'uo1' });
    });

    it.each([
      ['editor', editorRole],
      ['member', memberRole],
      ['viewer', viewerRole],
    ])('lets an admin assign the %s role', async (_key, role) => {
      repository.getRole.mockResolvedValue(role);
      repository.getMemberEffectivePermissions.mockResolvedValue(
        membershipFromEff(ADMIN_EFF)
      );
      repository.getOwnerRoleId.mockResolvedValue('role-owner');
      repository.getMemberRoleId.mockResolvedValue({ roleId: 'role-viewer' });
      repository.assignRoleToMember.mockResolvedValue({ id: 'uo1' });

      await expect(
        service.assignRoleToMember('o1', adminActor, 'u-target', role.id)
      ).resolves.toEqual({ id: 'uo1' });
    });

    it('403s when an admin assigns the owner role', async () => {
      repository.getRole.mockResolvedValue(ownerRole);
      repository.getMemberEffectivePermissions.mockResolvedValue(
        membershipFromEff(ADMIN_EFF)
      );
      await expect(
        service.assignRoleToMember('o1', adminActor, 'u-target', 'role-owner')
      ).rejects.toThrow(
        'Cannot assign a role with permissions beyond your own'
      );
      expect(repository.assignRoleToMember).not.toHaveBeenCalled();
    });

    it('403s when an admin assigns a custom role holding billing:manage', async () => {
      repository.getRole.mockResolvedValue(customBillingRole);
      repository.getMemberEffectivePermissions.mockResolvedValue(
        membershipFromEff(ADMIN_EFF)
      );
      await expect(
        service.assignRoleToMember('o1', adminActor, 'u-target', 'role-custom')
      ).rejects.toThrow(
        'Cannot assign a role with permissions beyond your own'
      );
      expect(repository.assignRoleToMember).not.toHaveBeenCalled();
    });

    it('lets a superadmin assign any role without an actor permission lookup', async () => {
      repository.getRole.mockResolvedValue(ownerRole);
      repository.getOwnerRoleId.mockResolvedValue('role-owner');
      repository.assignRoleToMember.mockResolvedValue({ id: 'uo1' });

      await expect(
        service.assignRoleToMember('o1', superAdminActor, 'u-target', 'role-owner')
      ).resolves.toEqual({ id: 'uo1' });
      expect(repository.getMemberEffectivePermissions).not.toHaveBeenCalled();
    });

    it('403s when demoting the sole owner', async () => {
      repository.getRole.mockResolvedValue(adminRole);
      repository.getMemberEffectivePermissions.mockResolvedValue(
        membershipFromEff(OWNER_EFF)
      );
      repository.getOwnerRoleId.mockResolvedValue('role-owner');
      repository.getMemberRoleId.mockResolvedValue({ roleId: 'role-owner' });
      repository.countOwners.mockResolvedValue(1);

      await expect(
        service.assignRoleToMember('o1', ownerActor, 'u-target', 'role-admin')
      ).rejects.toThrow('Cannot remove the last owner');
      expect(repository.assignRoleToMember).not.toHaveBeenCalled();
    });

    it('applies the last-owner guard even to a superadmin', async () => {
      repository.getRole.mockResolvedValue(adminRole);
      repository.getOwnerRoleId.mockResolvedValue('role-owner');
      repository.getMemberRoleId.mockResolvedValue({ roleId: 'role-owner' });
      repository.countOwners.mockResolvedValue(1);

      await expect(
        service.assignRoleToMember('o1', superAdminActor, 'u-target', 'role-admin')
      ).rejects.toThrow('Cannot remove the last owner');
      expect(repository.assignRoleToMember).not.toHaveBeenCalled();
    });

    it('allows demoting an owner when another owner remains', async () => {
      repository.getRole.mockResolvedValue(adminRole);
      repository.getMemberEffectivePermissions.mockResolvedValue(
        membershipFromEff(OWNER_EFF)
      );
      repository.getOwnerRoleId.mockResolvedValue('role-owner');
      repository.getMemberRoleId.mockResolvedValue({ roleId: 'role-owner' });
      repository.countOwners.mockResolvedValue(2);
      repository.assignRoleToMember.mockResolvedValue({ id: 'uo1' });

      await expect(
        service.assignRoleToMember('o1', ownerActor, 'u-target', 'role-admin')
      ).resolves.toEqual({ id: 'uo1' });
    });

    it('404s when the member is not part of the org', async () => {
      repository.getRole.mockResolvedValue(memberRole);
      repository.getOwnerRoleId.mockResolvedValue('role-owner');
      repository.getMemberRoleId.mockResolvedValue({ roleId: 'role-viewer' });
      repository.assignRoleToMember.mockResolvedValue(null);
      await expect(
        service.assignRoleToMember('o1', superAdminActor, 'u1', 'role-member')
      ).rejects.toThrow('Member not found in organization');
    });
  });

  describe('assertCanAssignRole', () => {
    it('returns immediately for a superadmin without resolving the role', async () => {
      await expect(
        service.assertCanAssignRole('o1', superAdminActor, 'any-role')
      ).resolves.toBeUndefined();
      expect(repository.getRole).not.toHaveBeenCalled();
    });

    it('400s when the role does not resolve in the org scope', async () => {
      repository.getRole.mockResolvedValue(null);
      await expect(
        service.assertCanAssignRole('o1', adminActor, 'foreign-role')
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.assertCanAssignRole('o1', adminActor, 'foreign-role')
      ).rejects.toThrow('Role not found in organization');
    });

    it('403s when an admin tries to assign the owner role', async () => {
      repository.getRole.mockResolvedValue(ownerRole);
      repository.getMemberEffectivePermissions.mockResolvedValue(
        membershipFromEff(ADMIN_EFF)
      );
      await expect(
        service.assertCanAssignRole('o1', adminActor, 'role-owner')
      ).rejects.toThrow(
        'Cannot assign a role with permissions beyond your own'
      );
    });

    it('resolves when the role is within the actor ceiling', async () => {
      repository.getRole.mockResolvedValue(editorRole);
      repository.getMemberEffectivePermissions.mockResolvedValue(
        membershipFromEff(OWNER_EFF)
      );
      await expect(
        service.assertCanAssignRole('o1', ownerActor, 'role-editor')
      ).resolves.toBeUndefined();
    });
  });

  describe('countOwners', () => {
    it('passes through to the repository', async () => {
      repository.countOwners.mockResolvedValue(2);
      expect(await service.countOwners('o1')).toBe(2);
      expect(repository.countOwners).toHaveBeenCalledWith('o1');
    });
  });
});
