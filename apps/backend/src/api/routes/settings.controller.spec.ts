import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateTeamUser = vi.fn();
const mockInviteTeamMember = vi.fn();
const mockGetTeam = vi.fn();
const mockChangeTeamMemberRole = vi.fn();
const mockDeleteTeamMember = vi.fn();
const mockGetShortlinkPreference = vi.fn();
const mockUpdateShortlinkPreference = vi.fn();

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
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
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { CreateTeamUserDto } from '@gitroom/nestjs-libraries/dtos/settings/create-team-user.dto';

const org = { id: 'org-1' } as any;

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
});
