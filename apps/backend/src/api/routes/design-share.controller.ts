import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Put,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Organization } from '@prisma/client';
import type { Response } from 'express';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { DesignShareService } from '@postmill-ai/nestjs-libraries/database/prisma/design/design-share.service';
import { UpdateDesignShareDto } from '@postmill-ai/nestjs-libraries/dtos/design/design-share.dto';
import { CheckPolicies } from '@postmill-ai/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@postmill-ai/backend/services/auth/permissions/permission.exception.class';
import { RequirePermission } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';

@ApiTags('Design sharing')
@Controller('/media/designs')
export class DesignShareController {
  constructor(private readonly _shareService: DesignShareService) {}

  @Get('/:id/share')
  @Header('Cache-Control', 'private, no-store')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  getShare(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._shareService.getShare(org.id, id);
  }

  @Put('/:id/share')
  @Header('Cache-Control', 'private, no-store')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  saveShare(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateDesignShareDto,
  ) {
    return this._shareService.saveShare(org.id, id, body);
  }

  @Delete('/:id/share')
  @CheckPolicies([AuthorizationActions.Update, Sections.MEDIA])
  @RequirePermission('media', 'update')
  disableShare(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._shareService.disableShare(org.id, id);
  }

  @Get('/:id/preview')
  @Header('Cache-Control', 'private, no-store')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  getTeamPreview(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._shareService.getTeamPreview(org.id, id);
  }

  @Get('/:id/preview/:outputIndex/:pageNumber')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  async renderTeamPreview(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Param('outputIndex', ParseIntPipe) outputIndex: number,
    @Param('pageNumber', ParseIntPipe) pageNumber: number,
    @Res() res: Response,
  ): Promise<void> {
    const png = await this._shareService.renderTeamPreview(org.id, id, outputIndex, pageNumber);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(png);
  }
}
