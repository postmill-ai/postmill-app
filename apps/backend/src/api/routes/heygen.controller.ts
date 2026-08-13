import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { CheckPolicies } from '@postmill-ai/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@postmill-ai/backend/services/auth/permissions/permission.exception.class';
import { RequirePermission } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { HeyGenService } from '@postmill-ai/nestjs-libraries/media/heygen/heygen.service';
import {
  CreateAvatarVideoDto,
  TalkingPhotoVideoDto,
  TextToSpeechDto,
  TranslateVideoDto,
} from '@postmill-ai/nestjs-libraries/dtos/heygen';

@ApiTags('HeyGen Studio')
@Controller('/media/heygen')
export class HeyGenController {
  constructor(private readonly _heygen: HeyGenService) {}

  @Get('/status')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  getStatus(@GetOrgFromRequest() org: Organization) {
    return this._heygen.getStatus(org.id);
  }

  @Get('/avatars')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  getAvatars(@GetOrgFromRequest() org: Organization) {
    return this._heygen.listAvatars(org.id);
  }

  @Get('/voices')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  getVoices(@GetOrgFromRequest() org: Organization) {
    return this._heygen.listVoices(org.id);
  }

  @Get('/translate-languages')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  getTranslateLanguages(@GetOrgFromRequest() org: Organization) {
    return this._heygen.listTranslateLanguages(org.id);
  }

  @Get('/jobs')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  // The HeyGen render queue polls this every 5s while a job is running (720/h), which
  // overruns the global per-handler/per-org backstop of 600/h.
  @Throttle({ default: { limit: 2000, ttl: 3600000 } })
  getJobs(@GetOrgFromRequest() org: Organization) {
    return this._heygen.listJobs(org.id);
  }

  @Get('/jobs/:id')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  getJob(@Param('id') id: string, @GetOrgFromRequest() org: Organization) {
    return this._heygen.getJob(org.id, id);
  }

  @Post('/video')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  createVideo(
    @Body() body: CreateAvatarVideoDto,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._heygen.createAvatarVideo(org.id, user.id, {
      scenes: body.scenes,
      dimension: body.dimension,
      title: body.title,
      folderId: body.folderId,
    });
  }

  @Post('/talking-photo')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  createTalkingPhoto(
    @Body() body: TalkingPhotoVideoDto,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._heygen.createTalkingPhotoVideo(org.id, user.id, {
      fileId: body.fileId,
      voiceId: body.voiceId,
      inputText: body.inputText,
      dimension: body.dimension,
      title: body.title,
      folderId: body.folderId,
    });
  }

  @Post('/tts')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  createTts(
    @Body() body: TextToSpeechDto,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._heygen.textToSpeech(org.id, user.id, {
      voiceId: body.voiceId,
      text: body.text,
      folderId: body.folderId,
    });
  }

  @Post('/translate')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  translate(
    @Body() body: TranslateVideoDto,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._heygen.translateVideo(org.id, user.id, {
      fileId: body.fileId,
      url: body.url,
      languages: body.languages,
      folderId: body.folderId,
    });
  }
}
