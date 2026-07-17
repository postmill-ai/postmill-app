import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';

const mockRepo = {
  markSetupCompleted: vi.fn(),
  getOrgsByUserId: vi.fn(),
  getOwnerRoleId: vi.fn(),
  deleteTeamMember: vi.fn(),
  changeTeamMemberRole: vi.fn(),
  createTeamUser: vi.fn(),
};

const mockOrgAiSettingsService = {
  getActiveProvider: vi.fn(),
};

const mockRolesService = {
  assertCanAssignRole: vi.fn(),
  countOwners: vi.fn(),
};

vi.mock('./organization.repository', () => ({
  OrganizationRepository: vi.fn(() => mockRepo),
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service', () => ({
  OrgAiSettingsService: vi.fn(() => mockOrgAiSettingsService),
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({
  NotificationService: vi.fn(() => ({ hasEmailProvider: vi.fn(() => false) })),
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/roles/roles.service', () => ({
  RolesService: vi.fn(() => mockRolesService),
}));

import { OrganizationService } from './organization.service';

const ownerActor = { id: 'u-owner', isSuperAdmin: false } as any;
const adminActor = { id: 'u-admin', isSuperAdmin: false } as any;

// The org attached to the request carries the caller's membership row.
const orgAs = (roleId: string) =>
  ({ id: 'org-1', users: [{ roleId }] }) as any;

describe('OrganizationService', () => {
  let service: OrganizationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrganizationService(
      mockRepo as any,
      {} as any,
      mockOrgAiSettingsService as any,
      mockRolesService as any
    );
  });

  describe('completeSetup', () => {
    it('throws BadRequestException when no active LLM provider exists', async () => {
      mockOrgAiSettingsService.getActiveProvider.mockResolvedValue(null);

      await expect(service.completeSetup('org-1')).rejects.toThrow('active LLM provider is required');
      expect(mockRepo.markSetupCompleted).not.toHaveBeenCalled();
    });

    it('marks setup completed when an active LLM provider exists', async () => {
      mockOrgAiSettingsService.getActiveProvider.mockResolvedValue({ identifier: 'openai' });
      mockRepo.markSetupCompleted.mockResolvedValue({ id: 'org-1', setupCompletedAt: new Date() });

      const result = await service.completeSetup('org-1');

      expect(mockRepo.markSetupCompleted).toHaveBeenCalledWith('org-1');
      expect(result.setupCompletedAt).toBeInstanceOf(Date);
    });
  });

  describe('createTeamUser', () => {
    it('routes an explicit roleId through the subset check (admin → owner role → 403)', async () => {
      mockRolesService.assertCanAssignRole.mockRejectedValue(
        new HttpException(
          'Cannot assign a role with permissions beyond your own',
          403
        )
      );

      await expect(
        service.createTeamUser('org-1', adminActor, 'new@example.com', 'secret123', 'USER', 'role-owner')
      ).rejects.toThrow('Cannot assign a role with permissions beyond your own');
      expect(mockRolesService.assertCanAssignRole).toHaveBeenCalledWith(
        'org-1',
        adminActor,
        'role-owner'
      );
      expect(mockRepo.createTeamUser).not.toHaveBeenCalled();
    });

    it('creates the user when the role is within the creator ceiling', async () => {
      mockRolesService.assertCanAssignRole.mockResolvedValue(undefined);
      mockRepo.createTeamUser.mockResolvedValue({ id: 'u-1' });

      const result = await service.createTeamUser(
        'org-1',
        adminActor,
        'new@example.com',
        'secret123',
        'USER',
        'role-editor'
      );

      expect(result).toEqual({ id: 'u-1' });
      expect(mockRepo.createTeamUser).toHaveBeenCalledWith(
        'org-1',
        'new@example.com',
        'secret123',
        'member',
        'role-editor'
      );
    });

    it('skips the subset check on the pure legacy role-string path', async () => {
      mockRepo.createTeamUser.mockResolvedValue({ id: 'u-1' });

      await service.createTeamUser('org-1', adminActor, 'new@example.com', 'secret123', 'ADMIN');

      expect(mockRolesService.assertCanAssignRole).not.toHaveBeenCalled();
      expect(mockRepo.createTeamUser).toHaveBeenCalledWith(
        'org-1',
        'new@example.com',
        'secret123',
        'admin',
        undefined
      );
    });
  });

  describe('inviteTeamMember', () => {
    it('rejects an invite carrying a role beyond the inviter ceiling', async () => {
      mockRolesService.assertCanAssignRole.mockRejectedValue(
        new HttpException(
          'Cannot assign a role with permissions beyond your own',
          403
        )
      );

      await expect(
        service.inviteTeamMember('org-1', adminActor, {
          email: 'x@y.z',
          roleId: 'role-owner',
          sendEmail: false,
        } as any)
      ).rejects.toThrow('Cannot assign a role with permissions beyond your own');
    });

    it('signs the invite when the role is within the inviter ceiling', async () => {
      vi.stubEnv('JWT_SECRET', 'test-secret');
      vi.stubEnv('FRONTEND_URL', 'https://app.example.com');
      mockRolesService.assertCanAssignRole.mockResolvedValue(undefined);

      const result = await service.inviteTeamMember('org-1', ownerActor, {
        email: 'x@y.z',
        roleId: 'role-editor',
        sendEmail: false,
      } as any);

      expect(mockRolesService.assertCanAssignRole).toHaveBeenCalledWith(
        'org-1',
        ownerActor,
        'role-editor'
      );
      expect(result.url).toContain('https://app.example.com/?org=');
      vi.unstubAllEnvs();
    });
  });

  describe('deleteTeamMember', () => {
    beforeEach(() => {
      mockRepo.getOwnerRoleId.mockResolvedValue('role-owner');
    });

    it('rejects deleting the sole owner', async () => {
      mockRepo.getOrgsByUserId.mockResolvedValue([
        { id: 'org-1', users: [{ roleId: 'role-owner' }] },
      ]);
      mockRolesService.countOwners.mockResolvedValue(1);

      await expect(
        service.deleteTeamMember(orgAs('role-owner'), 'u-target')
      ).rejects.toThrow('Cannot remove the last owner');
      expect(mockRepo.deleteTeamMember).not.toHaveBeenCalled();
    });

    it('allows deleting an owner when another owner remains', async () => {
      mockRepo.getOrgsByUserId.mockResolvedValue([
        { id: 'org-1', users: [{ roleId: 'role-owner' }] },
      ]);
      mockRolesService.countOwners.mockResolvedValue(2);
      mockRepo.deleteTeamMember.mockResolvedValue({ id: 'uo-1' });

      await service.deleteTeamMember(orgAs('role-owner'), 'u-target');

      expect(mockRepo.deleteTeamMember).toHaveBeenCalledWith('org-1', 'u-target');
    });

    it('allows deleting a non-owner member without counting owners', async () => {
      mockRepo.getOrgsByUserId.mockResolvedValue([
        { id: 'org-1', users: [{ roleId: 'role-member' }] },
      ]);
      mockRepo.deleteTeamMember.mockResolvedValue({ id: 'uo-1' });

      await service.deleteTeamMember(orgAs('role-owner'), 'u-target');

      expect(mockRolesService.countOwners).not.toHaveBeenCalled();
      expect(mockRepo.deleteTeamMember).toHaveBeenCalledWith('org-1', 'u-target');
    });
  });

  describe('changeTeamMemberRole', () => {
    beforeEach(() => {
      mockRepo.getOwnerRoleId.mockResolvedValue('role-owner');
    });

    it("403s on the legacy bypass: role:'USER' + roleId:<owner> as admin", async () => {
      mockRepo.getOrgsByUserId.mockResolvedValue([
        { id: 'org-1', users: [{ roleId: 'role-member' }] },
      ]);
      mockRolesService.assertCanAssignRole.mockRejectedValue(
        new HttpException(
          'Cannot assign a role with permissions beyond your own',
          403
        )
      );

      await expect(
        service.changeTeamMemberRole(orgAs('role-admin'), adminActor, 'u-target', 'USER', 'role-owner')
      ).rejects.toThrow('Cannot assign a role with permissions beyond your own');
      expect(mockRepo.changeTeamMemberRole).not.toHaveBeenCalled();
    });

    it('rejects demoting the sole owner through the legacy route', async () => {
      mockRepo.getOrgsByUserId.mockResolvedValue([
        { id: 'org-1', users: [{ roleId: 'role-owner' }] },
      ]);
      mockRolesService.assertCanAssignRole.mockResolvedValue(undefined);
      mockRolesService.countOwners.mockResolvedValue(1);

      await expect(
        service.changeTeamMemberRole(orgAs('role-owner'), ownerActor, 'u-target', 'USER', 'role-admin')
      ).rejects.toThrow('Cannot remove the last owner');
      expect(mockRepo.changeTeamMemberRole).not.toHaveBeenCalled();
    });

    it('keeps the level guard on the pure legacy role-string path', async () => {
      mockRepo.getOrgsByUserId.mockResolvedValue([
        { id: 'org-1', users: [{ roleId: 'role-owner' }] },
      ]);

      // admin (level 1) acting on an owner (level 2) is rejected as before.
      await expect(
        service.changeTeamMemberRole(orgAs('role-admin'), adminActor, 'u-target', 'USER')
      ).rejects.toThrow('You do not have permission to change this user role');
      expect(mockRolesService.assertCanAssignRole).not.toHaveBeenCalled();
    });

    it('lets an owner demote an admin via the pure legacy path', async () => {
      mockRepo.getOrgsByUserId.mockResolvedValue([
        { id: 'org-1', users: [{ roleId: 'role-admin' }] },
      ]);
      mockRepo.changeTeamMemberRole.mockResolvedValue({ id: 'uo-1' });

      await service.changeTeamMemberRole(orgAs('role-owner'), ownerActor, 'u-target', 'USER');

      expect(mockRepo.changeTeamMemberRole).toHaveBeenCalledWith(
        'org-1',
        'u-target',
        'USER',
        undefined
      );
    });
  });
});
