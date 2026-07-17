import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';

const mockOrganization = {
  organization: {
    update: vi.fn(),
    findFirst: vi.fn(),
  },
};
const mockUserOrg = {
  userOrganization: {
    create: vi.fn(),
    update: vi.fn(),
  },
};
const mockUser = {
  user: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};
const mockAppRole = {
  appRole: {
    findFirst: vi.fn(),
  },
};

const mockPrismaRepository = (model: any) => ({ model });

import { OrganizationRepository } from './organization.repository';

const orgModel = mockOrganization.organization;
const userOrgModel = mockUserOrg.userOrganization;
const userModel = mockUser.user;
const appRoleModel = mockAppRole.appRole;

describe('OrganizationRepository', () => {
  let repository: OrganizationRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new OrganizationRepository(
      mockPrismaRepository(mockOrganization) as any,
      mockPrismaRepository(mockUserOrg) as any,
      mockPrismaRepository(mockUser) as any,
      mockPrismaRepository({}) as any,
      mockPrismaRepository(mockAppRole) as any
    );
  });

  describe('markSetupCompleted', () => {
    it('sets setupCompletedAt to a non-null timestamp', async () => {
      const now = new Date();
      orgModel.update.mockResolvedValue({
        id: 'org-1',
        setupCompletedAt: now,
      });

      const result = await repository.markSetupCompleted('org-1');

      expect(orgModel.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { setupCompletedAt: expect.any(Date) },
      });
      expect(result.setupCompletedAt).toEqual(now);
    });

    it('is idempotent on repeat calls', async () => {
      orgModel.update.mockResolvedValue({
        id: 'org-1',
        setupCompletedAt: new Date(),
      });

      await repository.markSetupCompleted('org-1');
      await repository.markSetupCompleted('org-1');

      expect(orgModel.update).toHaveBeenCalledTimes(2);
    });
  });

  // F1 — every caller-supplied roleId must resolve inside the org scope
  // (system template role or a role owned by the org), at all three sinks.
  const orgScopedWhere = {
    id: 'foreign-role',
    OR: [
      { organizationId: null, isSystem: true },
      { organizationId: 'org-1' },
    ],
  };

  describe('addUserToOrg role resolution', () => {
    beforeEach(() => {
      userModel.findFirst.mockResolvedValue(null); // invite id unused
      orgModel.findFirst.mockResolvedValue({
        subscription: { subscriptionTier: 'TEAM' },
      });
    });

    it('400s on a foreign-org roleId', async () => {
      appRoleModel.findFirst.mockResolvedValue(null);

      await expect(
        repository.addUserToOrg('u-1', 'invite-1', 'org-1', 'USER', 'foreign-role')
      ).rejects.toThrow(BadRequestException);
      await expect(
        repository.addUserToOrg('u-1', 'invite-1', 'org-1', 'USER', 'foreign-role')
      ).rejects.toThrow('Role not found in organization');
      expect(appRoleModel.findFirst).toHaveBeenCalledWith({
        where: orgScopedWhere,
      });
      expect(userOrgModel.create).not.toHaveBeenCalled();
    });

    it('accepts a roleId that resolves in the org scope', async () => {
      appRoleModel.findFirst.mockResolvedValue({ id: 'role-editor', key: 'editor' });
      userOrgModel.create.mockResolvedValue({ organizationId: 'org-1' });

      const result = await repository.addUserToOrg(
        'u-1',
        'invite-1',
        'org-1',
        'USER',
        'role-editor'
      );

      expect(userOrgModel.create).toHaveBeenCalledWith({
        data: { roleId: 'role-editor', userId: 'u-1', organizationId: 'org-1' },
      });
      expect(userModel.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { inviteId: 'invite-1' },
      });
      expect(result).toEqual({ organizationId: 'org-1' });
    });
  });

  describe('createTeamUser role resolution', () => {
    it('400s on a foreign-org roleId before creating the user', async () => {
      appRoleModel.findFirst.mockResolvedValue(null);

      await expect(
        repository.createTeamUser('org-1', 'new@example.com', 'secret123', 'member', 'foreign-role')
      ).rejects.toThrow('Role not found in organization');
      expect(appRoleModel.findFirst).toHaveBeenCalledWith({
        where: orgScopedWhere,
      });
      expect(userModel.create).not.toHaveBeenCalled();
    });

    it('creates the user with a role that resolves in the org scope', async () => {
      appRoleModel.findFirst.mockResolvedValue({ id: 'role-editor', key: 'editor' });
      userModel.create.mockResolvedValue({ id: 'u-1', email: 'new@example.com' });

      const result = await repository.createTeamUser(
        'org-1',
        'new@example.com',
        'secret123',
        'member',
        'role-editor'
      );

      expect(userOrgModel.create).toHaveBeenCalledWith({
        data: { userId: 'u-1', organizationId: 'org-1', roleId: 'role-editor' },
      });
      expect(result).toEqual({
        id: 'u-1',
        email: 'new@example.com',
        role: 'editor',
      });
    });
  });

  describe('changeTeamMemberRole role resolution', () => {
    it('400s on a foreign-org roleId', async () => {
      appRoleModel.findFirst.mockResolvedValue(null);

      await expect(
        repository.changeTeamMemberRole('org-1', 'u-1', 'USER', 'foreign-role')
      ).rejects.toThrow('Role not found in organization');
      expect(appRoleModel.findFirst).toHaveBeenCalledWith({
        where: orgScopedWhere,
      });
      expect(userOrgModel.update).not.toHaveBeenCalled();
    });

    it('updates the membership with a role that resolves in the org scope', async () => {
      appRoleModel.findFirst.mockResolvedValue({ id: 'role-editor', key: 'editor' });
      userOrgModel.update.mockResolvedValue({ id: 'uo-1' });

      await repository.changeTeamMemberRole('org-1', 'u-1', 'USER', 'role-editor');

      expect(userOrgModel.update).toHaveBeenCalledWith({
        where: { userId_organizationId: { userId: 'u-1', organizationId: 'org-1' } },
        data: { roleId: 'role-editor' },
      });
    });
  });
});
