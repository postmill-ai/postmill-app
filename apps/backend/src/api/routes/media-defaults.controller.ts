import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { MediaDefaultsService } from '@gitroom/nestjs-libraries/ai/defaults/media-defaults.service';
import { SetDefaultModelDto } from '@gitroom/nestjs-libraries/dtos/ai-settings/default-model.dto';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';

@ApiTags('Media Defaults')
@Controller('/settings/content/media-defaults')
@RequirePermission('media-config', 'manage')
export class MediaDefaultsController {
  constructor(private _mediaDefaultsService: MediaDefaultsService) {}

  @Get('/')
  async getMediaDefaults(@GetOrgFromRequest() org: Organization) {
    return this._mediaDefaultsService.getMediaDefaults(org.id);
  }

  @Put('/:category')
  async setMediaDefault(
    @GetOrgFromRequest() org: Organization,
    @Param('category') category: string,
    @Body() body: SetDefaultModelDto,
  ) {
    return this._mediaDefaultsService.setMediaDefault(org.id, category, body);
  }

  @Delete('/:category')
  async clearMediaDefault(
    @GetOrgFromRequest() org: Organization,
    @Param('category') category: string,
  ) {
    return this._mediaDefaultsService.clearMediaDefault(org.id, category);
  }

  @Get('/catalog')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getMediaDefaultsCatalog(
    @GetOrgFromRequest() org: Organization,
    @Query('category') category: string,
  ) {
    return this._mediaDefaultsService.getMediaDefaultsCatalog(org.id, category);
  }
}
