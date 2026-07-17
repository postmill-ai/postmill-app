import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { Organization, User, StorageProviderType } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import { OrgRbacGuard } from '@gitroom/backend/services/auth/rbac/org-rbac.guard';
import { SuperAdminGuard } from '@gitroom/backend/services/auth/rbac/super-admin.guard';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import {
  CreateStorageConfigDto,
  UpdateStorageConfigDto,
  MigrateStorageDto,
  SetOrgQuotaDto,
  SetDefaultFolderDto,
} from '@gitroom/nestjs-libraries/dtos/providers/provider-config.dtos';
import { AuditLogQueryDto } from '@gitroom/nestjs-libraries/dtos/storage/audit-log-query.dto';

@ApiTags('Storage Settings')
@Controller('/settings/storage')
@UseGuards(OrgRbacGuard)
export class StorageController {
  constructor(
    private _storageService: StorageService,
    private _auditService: AuditService,
    private _fileService: FileService,
    private _permissionsService: PermissionsService
  ) {}

  // F2: BYO storage is a TEAM/AGENCY capability. The mount endpoint carries the
  // policy decorator, but create/update need conditional gates (LOCAL configs
  // stay free; update only bites mounted non-LOCAL configs), so those run the
  // exact PoliciesGuard ability check in-handler and mirror its 402 outcome.
  private async _assertByoStorageEntitled(org: Organization) {
    const ability = await this._permissionsService.check(
      org.id,
      org.createdAt,
      // The role argument is not consulted by the BYO_STORAGE branch.
      'USER',
      [[AuthorizationActions.Create, Sections.BYO_STORAGE]]
    );
    if (!ability.can(AuthorizationActions.Create, Sections.BYO_STORAGE)) {
      throw new SubscriptionException({
        section: Sections.BYO_STORAGE,
        action: AuthorizationActions.Create,
      });
    }
  }

  @Get('/')
  @RequirePermission('storage-config', 'manage')
  async listProviders(@GetOrgFromRequest() org: Organization) {
    return this._storageService.getProviderConfigs(org.id);
  }

  @Post('/')
  @RequirePermission('storage-config', 'manage')
  async createProvider(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: CreateStorageConfigDto
  ) {
    // Gate on non-LOCAL type only — LOCAL config rows must stay creatable for
    // non-entitled orgs (decision B3a).
    if (body.type !== StorageProviderType.LOCAL) {
      await this._assertByoStorageEntitled(org);
    }
    return this._storageService.createAndTestConfig(
      org.id,
      {
        type: body.type,
        name: body.name,
        credentials: body.credentials,
        region: body.region,
        bucket: body.bucket,
        endpoint: body.endpoint,
        publicUrl: body.publicUrl,
        quotaBytes:
          body.quotaBytes !== undefined ? BigInt(body.quotaBytes) : undefined,
        version: body.version,
      },
      user.id
    );
  }

  @Put('/:id')
  @RequirePermission('storage-config', 'manage')
  async updateProvider(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: UpdateStorageConfigDto
  ) {
    // Decision D-F2-update: repointing an already-mounted non-LOCAL config to
    // new credentials/bucket is a BYO-storage operation — gate it for
    // non-entitled orgs rather than letting it bypass the create/mount gates.
    const stored = (await this._storageService.getProviderConfigs(org.id)).find(
      (c) => c.id === id
    );
    if (
      stored &&
      stored.mounted &&
      stored.type !== StorageProviderType.LOCAL
    ) {
      await this._assertByoStorageEntitled(org);
    }
    return this._storageService.updateConfig(
      id,
      org.id,
      {
        name: body.name,
        credentials: body.credentials,
        region: body.region,
        bucket: body.bucket,
        endpoint: body.endpoint,
        publicUrl: body.publicUrl,
        quotaBytes:
          body.quotaBytes !== undefined ? BigInt(body.quotaBytes) : undefined,
        version: body.version,
      },
      user.id
    );
  }

  @Delete('/:id')
  @RequirePermission('storage-config', 'manage')
  async deleteProvider(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string
  ) {
    await this._storageService.deleteConfig(id, org.id, user.id);
    return { success: true };
  }

  @Post('/:id/test')
  @RequirePermission('storage-config', 'manage')
  async testConnection(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._storageService.testConnection(id, org.id);
  }

  @Post('/:id/mount')
  @RequirePermission('storage-config', 'manage')
  @CheckPolicies([AuthorizationActions.Create, Sections.BYO_STORAGE])
  async mountProvider(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._storageService.mount(id, org.id);
  }

  @Post('/:id/unmount')
  @RequirePermission('storage-config', 'manage')
  async unmountProvider(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._storageService.unmount(id, org.id);
  }

  @Get('/:sourceId/migrate-preview')
  @RequirePermission('storage-config', 'manage')
  async migratePreview(
    @GetOrgFromRequest() org: Organization,
    @Param('sourceId') sourceId: string
  ) {
    return this._storageService.getMigrationPreview(sourceId, org.id);
  }

  @Post('/:sourceId/migrate/:targetId')
  @RequirePermission('storage-config', 'manage')
  async migrateStorage(
    @GetOrgFromRequest() org: Organization,
    @Param('sourceId') sourceId: string,
    @Param('targetId') targetId: string,
    @Body() body: MigrateStorageDto
  ) {
    const limit = body?.limit
      ? Math.min(100, Math.max(1, Math.floor(body.limit)))
      : 25;
    return this._storageService.migrate(
      sourceId,
      targetId,
      org.id,
      body?.cursor,
      limit
    );
  }

  @Get('/usage')
  @RequirePermission('storage-config', 'manage')
  async getUsage(@GetOrgFromRequest() org: Organization) {
    return this._storageService.getUsageDto(org.id);
  }

  @Get('/quota-status')
  @RequirePermission('storage-config', 'manage')
  async getQuotaStatus(@GetOrgFromRequest() org: Organization) {
    return this._storageService.getQuotaStatusDto(org.id);
  }

  @Put('/quota/:orgId')
  @UseGuards(SuperAdminGuard)
  async setOrgQuota(
    @GetUserFromRequest() user: User,
    @Param('orgId') orgId: string,
    @Body() body: SetOrgQuotaDto
  ) {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException('Super-admin required');
    }
    await this._storageService.setOrgQuota(orgId, BigInt(body.quotaBytes));
    return { orgId, quotaBytes: body.quotaBytes };
  }

  @Get('/usage-breakdown')
  @RequirePermission('storage-config', 'manage')
  async getUsageBreakdown(@GetOrgFromRequest() org: Organization) {
    return this._storageService.getUsageBreakdownDto(org.id);
  }

  @Get('/audit-log')
  @RequirePermission('storage-config', 'manage')
  async getAuditLog(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AuditLogQueryDto
  ) {
    const logs = await this._auditService.findByOrg(org.id, {
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });
    const total = await this._auditService.countByOrg(org.id);
    return {
      logs: logs.map((log) => ({
        id: log.id,
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        entityName: log.entityName,
        userId: log.userId,
        createdAt: log.createdAt,
      })),
      total,
    };
  }

  @Post('/:id/set-default-folder')
  @RequirePermission('storage-config', 'manage')
  async setDefaultFolder(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: SetDefaultFolderDto
  ) {
    const folderId = body.folderId || null;
    return this._storageService.setDefaultFolderForProvider(
      id,
      folderId,
      org.id,
      user.id
    );
  }
}
