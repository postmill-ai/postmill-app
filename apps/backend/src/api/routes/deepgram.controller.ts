import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { DeepgramService } from '@gitroom/nestjs-libraries/media/deepgram/deepgram.service';
import { SaveTranscriptDto, TranscribeDto } from '@gitroom/nestjs-libraries/dtos/deepgram';

@ApiTags('Deepgram Studio')
@Controller('/media/deepgram')
export class DeepgramController {
  constructor(private readonly _deepgram: DeepgramService) {}

  @Get('/status')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  getStatus(@GetOrgFromRequest() org: Organization) {
    return this._deepgram.getStatus(org.id);
  }

  @Post('/transcribe')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  transcribe(@Body() body: TranscribeDto, @GetOrgFromRequest() org: Organization) {
    return this._deepgram.transcribe(org.id, {
      fileId: body.fileId,
      model: body.model,
      language: body.language,
    });
  }

  @Post('/save-transcript')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  saveTranscript(
    @Body() body: SaveTranscriptDto,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._deepgram.saveTranscript(org.id, user?.id, {
      text: body.text,
      segments: body.segments,
    });
  }
}
