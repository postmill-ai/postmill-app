import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { MetaCallbacksService } from '@postmill-ai/nestjs-libraries/integrations/meta-callbacks.service';
import { MetaSignedRequestDto } from '@postmill-ai/nestjs-libraries/dtos/integrations/meta-signed-request.dto';

/**
 * Meta app-level callbacks — public (NOT in the authenticatedController group):
 * Meta's servers POST here with no session, authenticated solely by the
 * `signed_request` HMAC (verified against every configured Meta app secret).
 * Reached through the frontend domain via the Next.js route handlers under
 * /integrations/social/meta/* (the URLs registered in the Meta app console).
 */
@ApiTags('Meta Callbacks')
@Controller('/integrations/meta')
export class MetaCallbacksController {
  private readonly _logger = new Logger(MetaCallbacksController.name);

  constructor(private _meta: MetaCallbacksService) {}

  @Post('/deauthorize')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  async deauthorize(@Req() req: Request, @Body() body: MetaSignedRequestDto) {
    this._logger.log(`meta deauthorize hit: ${this._size(req)} bytes`);
    const parsed = await this._meta.parseSignedRequest(body.signed_request);
    if (!parsed) {
      this._logger.warn('meta deauthorize: signed_request did not verify against any configured Meta app — 400');
      throw new BadRequestException('invalid signed_request');
    }
    this._logger.log(`meta deauthorize: verified via ${parsed.source} (user ${parsed.payload.user_id}, issued_at ${parsed.payload.issued_at})`);
    const result = await this._meta.deauthorize(parsed.family, parsed.payload.user_id);
    return { ok: true, channels: result.channels };
  }

  @Post('/data-deletion')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  async dataDeletion(@Req() req: Request, @Body() body: MetaSignedRequestDto) {
    this._logger.log(`meta data-deletion hit: ${this._size(req)} bytes`);
    const parsed = await this._meta.parseSignedRequest(body.signed_request);
    if (!parsed) {
      this._logger.warn('meta data-deletion: signed_request did not verify against any configured Meta app — 400');
      throw new BadRequestException('invalid signed_request');
    }
    this._logger.log(`meta data-deletion: verified via ${parsed.source} (user ${parsed.payload.user_id}, issued_at ${parsed.payload.issued_at})`);
    const result = await this._meta.requestDeletion(parsed.family, parsed.payload.user_id);
    // Exactly the shape Meta expects back.
    return { url: result.url, confirmation_code: result.confirmation_code };
  }

  @Get('/data-deletion/:code')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  deletionStatus(@Param('code') code: string) {
    return this._meta.deletionStatus(code);
  }

  private _size(req: Request): number {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    return raw?.length ?? Number(req.headers['content-length'] ?? 0);
  }
}
