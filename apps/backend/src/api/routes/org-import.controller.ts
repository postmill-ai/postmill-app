import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Organization, User } from '@prisma/client';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { RequirePermission } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';
import { OrgImportService } from '@postmill-ai/nestjs-libraries/database/prisma/org-portability/org-import.service';
import {
  ImportChunkDto,
  ImportPassphraseDto,
} from '@postmill-ai/nestjs-libraries/dtos/org-portability/org-import-upload.dto';

@ApiTags('Organization portability')
@RequirePermission('organization', 'manage')
@Controller('/org-portability/import-uploads')
export class OrgImportController {
  constructor(private readonly _import: OrgImportService) {}

  @Post('/')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createUpload(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
  ) {
    return this._import.createUpload(organization.id, user.id);
  }

  @Get('/:id')
  @Throttle({ default: { limit: 2400, ttl: 3_600_000 } })
  getJob(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string,
  ) {
    return this._import.getJob(organization.id, user.id, id);
  }

  @Put('/:id/chunks')
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  appendChunk(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string,
    @Body() body: ImportChunkDto,
  ) {
    return this._import.appendChunk(organization.id, user.id, id, body.offset, body.data);
  }

  @Post('/:id/validate')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  validateUpload(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string,
    @Body() body: ImportPassphraseDto,
  ) {
    return this._import.validateUpload(organization.id, user.id, id, body.passphrase);
  }

  @Post('/:id/commit')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  commitImport(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string,
    @Body() body: ImportPassphraseDto,
  ) {
    return this._import.commitImport(organization.id, user.id, id, body.passphrase);
  }
}
