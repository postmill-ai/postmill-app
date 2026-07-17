import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { Request, Response } from 'express';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { AgentGraphInsertService } from '@gitroom/nestjs-libraries/agent/agent.graph.insert.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { OnlyURL } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { CreateAgentDto } from '@gitroom/backend/dtos/public/create-agent.dto';
import { MediaStreamService } from '@gitroom/nestjs-libraries/media/stream/media-stream.service';

@ApiTags('Public')
@Controller('/public')
export class PublicController {
  constructor(
    private _trackService: TrackService,
    private _agentGraphInsertService: AgentGraphInsertService,
    private _subscriptionService: SubscriptionService,
    private _mediaStreamService: MediaStreamService
  ) {}
  @Post('/agent')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async createAgent(@Body() body: CreateAgentDto) {
    if (
      !body.apiKey ||
      !process.env.AGENT_API_KEY ||
      body.apiKey !== process.env.AGENT_API_KEY
    ) {
      throw new UnauthorizedException();
    }
    return this._agentGraphInsertService.newPost(body.text);
  }

  @Post('/t')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async trackEvent(
    @Res() res: Response,
    @Req() req: Request,
    @RealIP() ip: string,
    @UserAgent() userAgent: string,
    @Body()
    body: { fbclid?: string; tt: TrackEnum; additional: Record<string, any> }
  ) {
    const uniqueId = req?.cookies?.track || makeId(10);
    const fbclid = req?.cookies?.fbclid || body.fbclid;
    await this._trackService.track(
      uniqueId,
      ip,
      userAgent,
      body.tt,
      body.additional,
      fbclid
    );
    if (!req.cookies.track) {
      res.cookie('track', uniqueId, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        // Dev-only NOT_SECURED relaxation (same re-guard as auth.controller.ts) — a
        // stray prod NOT_SECURED must not strip Secure/httpOnly from tracking cookies.
        ...(!process.env.NOT_SECURED || process.env.NODE_ENV !== 'development'
          ? {
              secure: true,
              httpOnly: true,
            }
          : {}),
        sameSite: 'none',
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });
    }

    if (body.fbclid && !req.cookies.fbclid) {
      res.cookie('fbclid', body.fbclid, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        // Dev-only NOT_SECURED relaxation (same re-guard as auth.controller.ts) — a
        // stray prod NOT_SECURED must not strip Secure/httpOnly from tracking cookies.
        ...(!process.env.NOT_SECURED || process.env.NODE_ENV !== 'development'
          ? {
              secure: true,
              httpOnly: true,
            }
          : {}),
        sameSite: 'none',
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });
    }

    res.status(200).json({
      track: uniqueId,
    });
  }

  @Post('/modify-subscription')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async modifySubscription(@Body('params') params: string) {
    return this._subscriptionService.modifyFromJwtToken(params);
  }


  @Get('/stream')
  async streamFile(
    @Query() query: OnlyURL,
    @Res() res: Response,
    @Req() req: Request
  ) {
    const { url } = query;
    if (!url.endsWith('mp4')) {
      return res.status(400).type('text/plain').send('Invalid video URL');
    }

    return this._mediaStreamService.streamExternalUrl(url, req, res);
  }
}
