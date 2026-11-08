import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { createReadStream, statSync } from 'fs';
import { pipeline } from 'stream/promises';
import type { Response } from 'express';
import type { Organization, User } from '@prisma/client';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { OrgPortabilityService } from '@postmill-ai/nestjs-libraries/database/prisma/org-portability/org-portability.service';
import { CreateOrgExportDto } from '@postmill-ai/nestjs-libraries/dtos/org-portability/create-org-export.dto';
import { RequirePermission } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';

@ApiTags('Organization portability')
@RequirePermission('organization', 'manage')
@Controller('/org-portability')
export class OrgPortabilityController {
  constructor(private readonly _portability: OrgPortabilityService) {}

  @Post('/exports')
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  createExport(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Body() body: CreateOrgExportDto,
  ) {
    return this._portability.createExport(organization.id, user.id, body.passphrase);
  }

  @Get('/jobs')
  listJobs(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
  ) {
    return this._portability.listJobs(organization.id, user.id);
  }

  @Get('/jobs/:id')
  getJob(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string,
  ) {
    return this._portability.getJob(organization.id, user.id, id);
  }

  @Post('/jobs/:id/download')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  issueDownload(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string,
  ) {
    return this._portability.issueDownload(organization.id, user.id, id);
  }
}

@ApiTags('Organization portability')
@Controller('/org-portability')
export class OrgPortabilityDownloadController {
  constructor(private readonly _portability: OrgPortabilityService) {}

  @Get('/download/:token')
  async download(@Param('token') token: string, @Res() response: Response) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new BadRequestException('Invalid download token.');
    }
    const job = await this._portability.consumeDownload(token);
    const size = statSync(job.spoolPath!).size;
    response.set({
      'Content-Type': 'application/zip',
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="postmill-org-export-${job.id}.zip"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    await pipeline(createReadStream(job.spoolPath!), response);
  }
}
