import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';

const mockCreateTeamUser = vi.fn();
const mockInviteTeamMember = vi.fn();
const mockGetTeam = vi.fn();
const mockChangeTeamMemberRole = vi.fn();
const mockDeleteTeamMember = vi.fn();
const mockGetShortlinkPreference = vi.fn();
const mockUpdateShortlinkPreference = vi.fn();

vi.mock(
  '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({
    OrganizationService: class {
      createTeamUser = mockCreateTeamUser;
      inviteTeamMember = mockInviteTeamMember;
      getTeam = mockGetTeam;
      changeTeamMemberRole = mockChangeTeamMemberRole;
      deleteTeamMember = mockDeleteTeamMember;
      getShortlinkPreference = mockGetShortlinkPreference;
      updateShortlinkPreference = mockUpdateShortlinkPreference;
    },
  })
);

import { SettingsController } from './settings.controller';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';
import { CreateTeamUserDto } from '@postmill-ai/nestjs-libraries/dtos/settings/create-team-user.dto';
import { REQUIRE_PERMISSION_KEY } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';

const org = { id: 'org-1' } as any;

const permissionOf = (method: string) =>
  Reflect.getMetadata(REQUIRE_PERMISSION_KEY, SettingsController.prototype[method]);

describe('SettingsController', () => {
  let controller: SettingsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new SettingsController(new (OrganizationService as any)());
  });

  it('imports CreateTeamUserDto from the shared DTO package', () => {
    expect(CreateTeamUserDto).toBeDefined();
  });

  it('createTeamUser delegates to the service with the acting user and DTO fields', async () => {
    mockCreateTeamUser.mockResolvedValue({ id: 'u-1' });
    const user = { id: 'user-1', isSuperAdmin: false } as any;
    const body: CreateTeamUserDto = {
      email: 'new@example.com',
      password: 'secret123',
      role: 'USER',
    };

    const result = await controller.createTeamUser(org, user, body);

    expect(mockCreateTeamUser).toHaveBeenCalledWith(
      'org-1',
      user,
      'new@example.com',
      'secret123',
      'USER',
      undefined,
    );
    expect(result).toEqual({ id: 'u-1' });
  });

  it('gates every team-mutating route on members:manage, matching the UI and RolesController', () => {
    for (const method of [
      'inviteTeamMember',
      'changeTeamMemberRole',
      'createTeamUser',
      'deleteTeamMember',
    ]) {
      expect(permissionOf(method), method).toEqual({
        resource: 'members',
        action: 'manage',
      });
    }
  });

  it('keeps the team read route on settings:read', () => {
    expect(permissionOf('getTeam')).toEqual({
      resource: 'settings',
      action: 'read',
    });
  });
});
