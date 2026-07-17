import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import {
  BadRequestException,
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { OrgAiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service';
import { RolesService } from '@gitroom/nestjs-libraries/database/prisma/roles/roles.service';
import { AddTeamMemberDto } from '@gitroom/nestjs-libraries/dtos/settings/add.team.member.dto';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { Organization, ShortLinkPreference, User } from '@prisma/client';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';

// The org attached to the request carries the caller's membership row
// (see org.from.request decorator) — surface just the roleId we read here.
type OrganizationWithMembership = Organization & {
  users?: { roleId: string | null }[];
};

@Injectable()
export class OrganizationService {
  constructor(
    private _organizationRepository: OrganizationRepository,
    private _notificationsService: NotificationService,
    @Inject(forwardRef(() => OrgAiSettingsService))
    private _orgAiSettingsService: OrgAiSettingsService,
    private _rolesService: RolesService
  ) {}
  async createOrgAndUser(
    body: Omit<CreateOrgUserDto, 'providerToken'> & { providerId?: string },
    ip: string,
    userAgent: string
  ) {
    return this._organizationRepository.createOrgAndUser(
      { ...body, name: body.name, lastName: body.lastName },
      this._notificationsService.hasEmailProvider(),
      ip,
      userAgent
    );
  }

  async getCount() {
    return this._organizationRepository.getCount();
  }

  async getAllIds() {
    return this._organizationRepository.getAllIds();
  }

  async createMaxUser(id: string, name: string, saasName: string, email: string) {
    return this._organizationRepository.createMaxUser(id, name, saasName, email);
  }

  addUserToOrg(
    userId: string,
    id: string,
    orgId: string,
    role: 'USER' | 'ADMIN',
    roleId?: string,
  ) {
    return this._organizationRepository.addUserToOrg(userId, id, orgId, role, roleId);
  }

  getOrgById(id: string) {
    return this._organizationRepository.getOrgById(id);
  }

  getUserOrg(id: string) {
    return this._organizationRepository.getUserOrg(id);
  }

  getOrgsByUserId(userId: string) {
    return this._organizationRepository.getOrgsByUserId(userId);
  }

  getTeam(orgId: string) {
    return this._organizationRepository.getTeam(orgId);
  }

  getMemberProfile(orgId: string, userId: string) {
    return this._organizationRepository.getMemberProfile(orgId, userId);
  }

  async createTeamUser(orgId: string, actor: User, email: string, password: string, userRole: string, roleId?: string) {
    if (roleId) {
      // F1: the creator may only assign a role within their own permissions.
      await this._rolesService.assertCanAssignRole(orgId, actor, roleId);
    }
    const roleKey = userRole === 'ADMIN' ? 'admin' : 'member';
    return this._organizationRepository.createTeamUser(orgId, email, password, roleKey, roleId);
  }

  async setStreak(organizationId: string, type: 'start' | 'end') {
    return this._organizationRepository.setStreak(organizationId, type);
  }

  getOrgByCustomerId(customerId: string) {
    return this._organizationRepository.getOrgByCustomerId(customerId);
  }

  async inviteTeamMember(orgId: string, actor: User, body: AddTeamMemberDto) {
    if (body.roleId) {
      // F1: the roleId rides the signed invite JWT unchanged into addUserToOrg,
      // so the inviter's ceiling is enforced here, at signing time.
      await this._rolesService.assertCanAssignRole(orgId, actor, body.roleId);
    }
    const timeLimit = dayjs().add(1, 'hour').format('YYYY-MM-DD HH:mm:ss');
    const id = makeId(5);
    const url =
      process.env.FRONTEND_URL +
      `/?org=${AuthService.signJWT({ ...body, orgId, timeLimit, id })}`;
    if (body.sendEmail) {
      await this._notificationsService.sendEmail(
        body.email,
        'You have been invited to join an organization',
        `You have been invited to join an organization. Click <a href="${url}">here</a> to join.<br />The link will expire in 1 hour.`
      );
    }
    return { url };
  }

  async deleteTeamMember(org: Organization, userId: string) {
    const userOrgs = await this._organizationRepository.getOrgsByUserId(userId);
    const findOrgToDelete = userOrgs.find((orgUser) => orgUser.id === org.id);
    if (!findOrgToDelete) {
      throw new Error('User is not part of this organization');
    }

    const myRole = (org as OrganizationWithMembership).users?.[0]?.roleId;
    const userRole = findOrgToDelete.users?.[0]?.roleId;
    const ownerRole = await this._organizationRepository.getOwnerRoleId();
    const isOwner = (id: string | null | undefined) => id === ownerRole;
    const myLevel = isOwner(myRole) ? 2 : myRole ? 1 : 0;
    const userLevel = isOwner(userRole) ? 2 : userRole ? 1 : 0;

    if (myLevel < userLevel) {
      throw new Error('You do not have permission to delete this user');
    }

    // F1: removing the last enabled owner strands the org — rejected
    // unconditionally, even for a superadmin caller.
    if (isOwner(userRole)) {
      const owners = await this._rolesService.countOwners(org.id);
      if (owners <= 1) {
        throw new HttpException(
          'Cannot remove the last owner',
          HttpStatus.FORBIDDEN
        );
      }
    }

    return this._organizationRepository.deleteTeamMember(org.id, userId);
  }

  async changeTeamMemberRole(
    org: Organization,
    actor: User,
    userId: string,
    role: 'USER' | 'ADMIN',
    roleId?: string,
  ) {
    const userOrgs = await this._organizationRepository.getOrgsByUserId(userId);
    const findOrg = userOrgs.find((orgUser) => orgUser.id === org.id);
    if (!findOrg) {
      throw new Error('User is not part of this organization');
    }

    const myRole = (org as OrganizationWithMembership).users?.[0]?.roleId;
    const userRole = findOrg.users?.[0]?.roleId;
    const ownerRole = await this._organizationRepository.getOwnerRoleId();
    const isOwner = (id: string | null | undefined) => id === ownerRole;

    if (roleId) {
      // F1: an explicit roleId goes through the permission-subset ceiling —
      // the legacy level math below never sees it (it derived the target level
      // from the 'USER'/'ADMIN' string only, so role:'USER' + roleId:<owner>
      // used to sail through).
      await this._rolesService.assertCanAssignRole(org.id, actor, roleId);
    } else {
      // Pure legacy role-string path: keep the level guard, with the target
      // level derived from the resolved role key, not the raw string.
      const myLevel = isOwner(myRole) ? 2 : myRole ? 1 : 0;
      const userLevel = isOwner(userRole) ? 2 : userRole ? 1 : 0;
      const targetKey = role === 'ADMIN' ? 'admin' : 'member';
      const targetLevel = targetKey === 'admin' ? 1 : 0;

      // Only act on members strictly below you, and never promote above your own level.
      if (myLevel <= userLevel || myLevel <= targetLevel) {
        throw new Error('You do not have permission to change this user role');
      }
    }

    // F1: demoting the last enabled owner strands the org — unconditional.
    const newRoleIsOwner = roleId ? roleId === ownerRole : false;
    if (isOwner(userRole) && !newRoleIsOwner) {
      const owners = await this._rolesService.countOwners(org.id);
      if (owners <= 1) {
        throw new HttpException(
          'Cannot remove the last owner',
          HttpStatus.FORBIDDEN
        );
      }
    }

    return this._organizationRepository.changeTeamMemberRole(
      org.id,
      userId,
      role,
      roleId,
    );
  }

  disableOrEnableNonSuperAdminUsers(orgId: string, disable: boolean) {
    return this._organizationRepository.disableOrEnableNonSuperAdminUsers(
      orgId,
      disable
    );
  }

  disableExcessNonOwnerUsers(orgId: string, keep: number) {
    return this._organizationRepository.disableExcessNonOwnerUsers(orgId, keep);
  }

  getShortlinkPreference(orgId: string) {
    return this._organizationRepository.getShortlinkPreference(orgId);
  }

  updateShortlinkPreference(orgId: string, shortlink: ShortLinkPreference) {
    return this._organizationRepository.updateShortlinkPreference(
      orgId,
      shortlink
    );
  }

  getImpersonateUser(name: string) {
    return this._organizationRepository.getImpersonateUser(name);
  }

  async completeSetup(orgId: string) {
    const activeProvider = await this._orgAiSettingsService.getActiveProvider(orgId);
    if (!activeProvider) {
      throw new BadRequestException('An active LLM provider is required before completing setup.');
    }
    return this._organizationRepository.markSetupCompleted(orgId);
  }
}
