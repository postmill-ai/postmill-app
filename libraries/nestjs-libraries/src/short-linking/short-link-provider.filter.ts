import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Response } from 'express';
import { ShortLinkProviderError } from './short-link-provider.error';
import { HttpStatusCode } from 'axios';

@Catch(ShortLinkProviderError)
export class ShortLinkProviderFilter implements ExceptionFilter {
  catch(exception: ShortLinkProviderError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    response
      .status(HttpStatusCode.Conflict)
      .json({
        provider: exception.provider,
        reason: 'not_configured',
        settingsUrl: '/settings?tab=shortlinks',
        message: exception.message,
      });
  }
}

export const SHORT_LINK_PROVIDER_FILTER = {
  provide: APP_FILTER,
  useClass: ShortLinkProviderFilter,
};
