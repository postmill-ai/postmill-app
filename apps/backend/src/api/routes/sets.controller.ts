import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { SetsService } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.service';
import {
  UpdateSetsDto,
  SetsDto,
} from '@gitroom/nestjs-libraries/dtos/sets/sets.dto';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { OrgRbacGuard } from '@gitroom/backend/services/auth/rbac/org-rbac.guard';

// A Set is a saved post template, so it is gated on the `posts` RBAC resource.
@ApiTags('Sets')
@Controller('/sets')
@UseGuards(OrgRbacGuard)
export class SetsController {
  constructor(private _setsService: SetsService) {}

  @Get('/')
  @RequirePermission('posts', 'read')
  async getSets(@GetOrgFromRequest() org: Organization) {
    return this._setsService.getSets(org.id);
  }

  @Post('/')
  @RequirePermission('posts', 'create')
  async createASet(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SetsDto
  ) {
    return this._setsService.createSet(org.id, body);
  }

  @Put('/')
  @RequirePermission('posts', 'create')
  async updateSet(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UpdateSetsDto
  ) {
    return this._setsService.createSet(org.id, body);
  }

  @Delete('/:id')
  @RequirePermission('posts', 'delete')
  async deleteSet(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._setsService.deleteSet(org.id, id);
  }
}
