import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/roles/roles.service',
  () => ({
    RolesService: class {},
  })
);

import { RolesController } from './roles.controller';

const org = { id: 'org-1' } as never;

interface MockRolesService {
  getRoles: ReturnType<typeof vi.fn>;
  getRole: ReturnType<typeof vi.fn>;
  createRole: ReturnType<typeof vi.fn>;
  updateRole: ReturnType<typeof vi.fn>;
  deleteRole: ReturnType<typeof vi.fn>;
  assignRoleToMember: ReturnType<typeof vi.fn>;
  getPermissions: ReturnType<typeof vi.fn>;
  getEffectivePermissions: ReturnType<typeof vi.fn>;
}

describe('RolesController', () => {
  let service: MockRolesService;
  let controller: RolesController;

  beforeEach(() => {
    service = {
      getRoles: vi.fn(),
      getRole: vi.fn(),
      createRole: vi.fn(),
      updateRole: vi.fn(),
      deleteRole: vi.fn(),
      assignRoleToMember: vi.fn(),
      getPermissions: vi.fn(),
      getEffectivePermissions: vi.fn(),
    };
    controller = new RolesController(service as never);
  });

  describe('myPermissions (GET /settings/roles/me)', () => {
    it('returns the resolved role and permission set', async () => {
      service.getEffectivePermissions.mockResolvedValue({
        role: 'admin',
        permissions: ['settings:read', 'settings:update'],
      });

      const result = await controller.myPermissions(org, {
        id: 'user-1',
        isSuperAdmin: false,
      } as never);

      expect(service.getEffectivePermissions).toHaveBeenCalledWith(
        'org-1',
        'user-1'
      );
      expect(result).toEqual({
        role: 'admin',
        permissions: ['settings:read', 'settings:update'],
        isSuperAdmin: false,
      });
    });

    it('returns an empty set with a null role for members without a role', async () => {
      service.getEffectivePermissions.mockResolvedValue(null);

      const result = await controller.myPermissions(org, {
        id: 'user-1',
        isSuperAdmin: false,
      } as never);

      expect(result).toEqual({
        role: null,
        permissions: [],
        isSuperAdmin: false,
      });
    });

    it('flags platform super-admins', async () => {
      service.getEffectivePermissions.mockResolvedValue(null);

      const result = await controller.myPermissions(org, {
        id: 'user-1',
        isSuperAdmin: true,
      } as never);

      expect(result.isSuperAdmin).toBe(true);
    });
  });

  describe('roles CRUD passthrough', () => {
    it('lists roles for the org', async () => {
      service.getRoles.mockResolvedValue([{ id: 'r1' }]);
      expect(await controller.list(org)).toEqual([{ id: 'r1' }]);
      expect(service.getRoles).toHaveBeenCalledWith('org-1');
    });

    it('lists the permission catalog', async () => {
      service.getPermissions.mockResolvedValue([{ id: 'p1' }]);
      expect(await controller.listPermissions()).toEqual([{ id: 'p1' }]);
    });

    it('404s when getting an unknown role', async () => {
      service.getRole.mockResolvedValue(null);
      await expect(controller.get(org, 'missing')).rejects.toThrow(
        HttpException
      );
    });

    it('returns a role when found', async () => {
      service.getRole.mockResolvedValue({ id: 'r1' });
      expect(await controller.get(org, 'r1')).toEqual({ id: 'r1' });
    });

    it('creates a custom role', async () => {
      service.createRole.mockResolvedValue({ id: 'r2' });
      const body = {
        key: 'custom',
        name: 'Custom',
        permissionIds: ['p1'],
      };
      expect(await controller.create(org, body as never)).toEqual({
        id: 'r2',
      });
      expect(service.createRole).toHaveBeenCalledWith('org-1', body);
    });

    it('404s when updating an unknown role', async () => {
      service.updateRole.mockResolvedValue(null);
      await expect(
        controller.update(org, 'missing', { name: 'x' } as never)
      ).rejects.toThrow(HttpException);
    });

    it('updates a custom role', async () => {
      service.updateRole.mockResolvedValue({ id: 'r2', name: 'x' });
      expect(
        await controller.update(org, 'r2', { name: 'x' } as never)
      ).toEqual({ id: 'r2', name: 'x' });
    });

    it('404s when deleting an unknown role', async () => {
      service.deleteRole.mockResolvedValue(null);
      await expect(controller.delete(org, 'missing')).rejects.toThrow(
        HttpException
      );
    });

    it('deletes a custom role', async () => {
      service.deleteRole.mockResolvedValue({ id: 'r2' });
      expect(await controller.delete(org, 'r2')).toEqual({ success: true });
    });

    it('assigns a role to a member, passing the acting user through', async () => {
      const user = { id: 'user-1', isSuperAdmin: false } as never;
      service.assignRoleToMember.mockResolvedValue({ id: 'uo1' });
      expect(
        await controller.assignRole(org, user, 'user-2', {
          roleId: 'r1',
        } as never)
      ).toEqual({ id: 'uo1' });
      expect(service.assignRoleToMember).toHaveBeenCalledWith(
        'org-1',
        user,
        'user-2',
        'r1'
      );
    });
  });
});
