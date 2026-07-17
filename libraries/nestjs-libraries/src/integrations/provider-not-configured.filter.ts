import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Response } from 'express';
import { ProviderNotConfiguredError } from '@gitroom/nestjs-libraries/integrations/provider-not-configured.error';
import { HttpStatusCode } from 'axios';

@Catch(ProviderNotConfiguredError)
export class ProviderNotConfiguredFilter implements ExceptionFilter {
  catch(exception: ProviderNotConfiguredError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    response
      .status(HttpStatusCode.Conflict)
      .json({
        provider: exception.provider,
        reason: 'not_configured',
        settingsUrl: '/settings?tab=channels',
        message: exception.message,
      });
  }
}

export const PROVIDER_NOT_CONFIGURED_FILTER = {
  provide: APP_FILTER,
  useClass: ProviderNotConfiguredFilter,
};
