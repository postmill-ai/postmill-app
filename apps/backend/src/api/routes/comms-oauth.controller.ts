import { Controller, Get, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CommsConfigService } from '@postmill-ai/nestjs-libraries/comms/comms-config.service';

/**
 * Public comms OAuth callbacks (provider → backend redirect). NOT in the
 * authenticatedController group: the browser hits this from Slack's consent
 * redirect and the state parameter (Redis-bound, single-use) is the
 * authorization — mirroring the channels `organization:${state}` binding.
 * On success it serves the channels-style close page: postMessage
 * (`postmill:comms-connected`) to the opener + close when inside a connect
 * popup, redirect to the comms settings page otherwise.
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

    const frontendOrigin = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!doctype html>
<html><body><script>
if (window.opener && window.opener !== window) {
  window.opener.postMessage({ type: 'postmill:comms-connected', provider: 'slack' }, ${JSON.stringify(frontendOrigin)});
  window.close();
}
window.location.href = ${JSON.stringify(settingsUrl('?connected=slack'))};
</script></body></html>`);
  }
}
