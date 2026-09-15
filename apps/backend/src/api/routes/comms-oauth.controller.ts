import { Controller, Get, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CommsConfigService } from '@postmill-ai/nestjs-libraries/comms/comms-config.service';

/**
 * Public comms OAuth callbacks (provider → backend redirect). NOT in the
 * authenticatedController group: the browser hits this from the provider's
 * consent redirect and the state parameter (Redis-bound, single-use) is the
 * authorization — mirroring the channels `organization:${state}` binding.
 *
 * Success contract for EVERY OAuth comms callback: 302 to
 * `<frontend>/settings/comms?connected=<identifier>`. The frontend page is
 * the close page (CommsTab signals completion via localStorage/postMessage
 * and closes the popup). Never serve the close page from this API origin —
 * helmet's Cross-Origin-Opener-Policy: same-origin here would sever
 * window.opener even for providers whose own pages don't.
 */
@ApiTags('Comms OAuth')
@Controller('/settings/comms/oauth')
export class CommsOauthController {
  constructor(private _configService: CommsConfigService) {}

  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Get('/slack/callback')
  async slackCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const settingsUrl = (params: string) =>
      `${(process.env.FRONTEND_URL || '').replace(/\/+$/, '')}/settings/comms${params}`;

    if (error || !code || !state) {
      return res.redirect(
        settingsUrl(`?error=${encodeURIComponent(error || 'missing_code')}`),
      );
    }
    try {
      await this._configService.handleSlackOAuthCallback(code, state);
    } catch (err) {
      const message = ((err as Error)?.message || 'connect_failed').slice(0, 200);
      return res.redirect(settingsUrl(`?error=${encodeURIComponent(message)}`));
    }

    return res.redirect(settingsUrl('?connected=slack'));
  }
}
