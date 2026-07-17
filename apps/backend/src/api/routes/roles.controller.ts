import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { ApiTags } from '@nestjs/swagger';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { RolesService } from '@gitroom/nestjs-libraries/database/prisma/roles/roles.service';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { OrgRbacGuard } from '@gitroom/backend/services/auth/rbac/org-rbac.guard';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';

class CreateRoleDto {
  @IsString()
  key!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  permissionIds!: string[];
}

class UpdateRoleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionIds?: string[];
}

class AssignRoleDto {
  @IsString()
  roleId!: string;
}

@ApiTags('Roles')
@Controller('/settings/roles')
@UseGuards(OrgRbacGuard)
export class RolesController {
  constructor(private _rolesService: RolesService) {}

  @Get('/')
  @RequirePermission('members', 'read')
  @CheckPolicies([AuthorizationActions.Read, Sections.TEAM_MEMBERS])
  async list(@GetOrgFromRequest() org: Organization) {
    return this._rolesService.getRoles(org.id);
  }

  @Get('/permissions')
  @RequirePermission('members', 'read')
  @CheckPolicies([AuthorizationActions.Read, Sections.TEAM_MEMBERS])
  async listPermissions() {
    return this._rolesService.getPermissions();
  }

  // Open to every authenticated org member (no @RequirePermission / @CheckPolicies):
  // the frontend uses it to decide which surfaces to show. Must be declared
  // before the parameterized '/:id' route.
  @Get('/me')
  async myPermissions(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    const effective = await this._rolesService.getEffectivePermissions(
      org.id,
      user.id,
    );
    return {
      role: effective?.role ?? null,
      permissions: effective?.permissions ?? [],
      isSuperAdmin: !!user.isSuperAdmin,
    };
  }

  @Get('/:id')
  @RequirePermission('members', 'read')
  @CheckPolicies([AuthorizationActions.Read, Sections.TEAM_MEMBERS])
  async get(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    const result = await this._rolesService.getRole(org.id, id);
    if (!result) {
      throw new HttpException('Role not found', HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Post('/')
  @RequirePermission('members', 'manage')
  @CheckPolicies([AuthorizationActions.Create, Sections.TEAM_MEMBERS])
  async create(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateRoleDto,
  ) {
    return this._rolesService.createRole(org.id, body);
  }

  @Put('/:id')
  @RequirePermission('members', 'manage')
  @CheckPolicies([AuthorizationActions.Update, Sections.TEAM_MEMBERS])
  async update(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateRoleDto,
  ) {
    const result = await this._rolesService.updateRole(org.id, id, body);
    if (!result) {
      throw new HttpException('Role not found', HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Delete('/:id')
  @RequirePermission('members', 'manage')
  @CheckPolicies([AuthorizationActions.Delete, Sections.TEAM_MEMBERS])
  async delete(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    const result = await this._rolesService.deleteRole(org.id, id);
    if (!result) {
      throw new HttpException('Role not found', HttpStatus.NOT_FOUND);
    }
    return { success: true };
  }

  @Put('/team/:userId/role')
  @RequirePermission('members', 'manage')
  @CheckPolicies([AuthorizationActions.Update, Sections.TEAM_MEMBERS])
  async assignRole(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('userId') userId: string,
    @Body() body: AssignRoleDto,
  ) {
    return this._rolesService.assignRoleToMember(org.id, user, userId, body.roleId);
  }
}
