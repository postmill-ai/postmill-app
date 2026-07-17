import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { ApiTags } from '@nestjs/swagger';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { MediaStudioService } from '@gitroom/nestjs-libraries/media/studio/media-studio.service';
import { MediaStudioGenerateDto } from '@gitroom/nestjs-libraries/dtos/media-studio/media-studio.generate.dto';

// Generic studio endpoint shared by every descriptor-driven provider studio (Runway,
// Luma, MiniMax, Kling, …). No provider-specific code — the adapter + descriptor carry
// all differences.
@ApiTags('Media Studio')
@Controller('/media/studio')
export class MediaStudioController {
  constructor(private readonly _studio: MediaStudioService) {}

  @Get('/:provider/status')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  getStatus(
    @Param('provider') provider: string,
    @GetOrgFromRequest() org: Organization,
    @Query('version') version?: string,
  ) {
    return this._studio.getStatus(org.id, provider, version);
  }

  @Get('/:provider/jobs')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  getJobs(
    @Param('provider') provider: string,
    @GetOrgFromRequest() org: Organization,
    @Query('version') version?: string,
  ) {
    return this._studio.listJobs(org.id, provider, version);
  }

  // Runtime model catalog for the studio's dynamic model dropdown.
  @Get('/:provider/models')
  @CheckPolicies([AuthorizationActions.Read, Sections.MEDIA])
  @RequirePermission('media', 'read')
  getModels(
    @Param('provider') provider: string,
    @Query('operation') operation: string,
    @GetOrgFromRequest() org: Organization,
    @Query('version') version?: string,
  ) {
    const op = operation === 'video' || operation === 'audio' ? operation : 'image';
    return this._studio.listModels(org.id, provider, op, version);
  }

  @Post('/:provider/generate')
  @CheckPolicies([AuthorizationActions.Create, Sections.MEDIA])
  @RequirePermission('media', 'create')
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  async generate(
    @Param('provider') provider: string,
    @Body() body: MediaStudioGenerateDto,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Query('version') version?: string,
  ) {
    // Optional idempotency: a retry after an ambiguous client-side timeout re-sends
    // the same X-Idempotency-Key and cannot start a second PAID media job. Absent
    // key → unchanged behaviour. Header-based so no DTO/whitelist change. The claim
    // fails OPEN on a Redis outage (never fail the generate) and is RELEASED if the
    // dispatch throws, so a definite failure is retryable while a successful start
    // still dedups an ambiguous timeout. (3.2)
    if (idempotencyKey) {
      let claimed = true;
      try {
        const res = await ioRedis.set(
          `idem:${org.id}:${idempotencyKey}`,
          '1',
          'EX',
          86400,
          'NX',
        );
        claimed = res === 'OK';
      } catch {
        claimed = true; // Redis down → fail open
      }
      if (!claimed) {
        return { duplicate: true };
      }
    }
    try {
      return await this._studio.generate(org.id, user.id, provider, {
        operation: body.operation,
        model: body.model,
        input: body.input,
        mediaInputs: body.mediaInputs,
        folderId: body.folderId,
        version,
      });
    } catch (e) {
      if (idempotencyKey) {
        try {
          await ioRedis.del(`idem:${org.id}:${idempotencyKey}`);
        } catch {
          // best-effort release — a stale key just expires at the 24h TTL
        }
      }
      throw e;
    }
  }
}
