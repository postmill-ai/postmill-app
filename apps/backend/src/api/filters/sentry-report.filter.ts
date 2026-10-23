import {
  ArgumentsHost,
  Catch,
  HttpException,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';

/**
 * Backstop filter, registered LAST (as the final APP_FILTER in AppModule):
 * the specific filters (provider errors, 401s, validation) get first chance to
 * shape their responses, and anything that falls through lands here. Unexpected
 * errors (plain `Error`s, not deliberate HttpExceptions) are reported to Sentry
 * before the default error response renders — previously these only hit the
 * Nest log and never reached Sentry (e.g. the HeyGen avatar-catalog timeout 500).
 *
 * Do NOT register this via app.useGlobalFilters() in main.ts: those land ahead
 * of every APP_FILTER provider in Nest's first-match-wins resolution, so a
 * catch-all there shadows all typed module filters (ProviderExceptionFilter et
 * al. lost their response envelopes and account-explained upstream 4xx — the
 * org's own key/plan/quota state, not app bugs — spammed Sentry as errors).
 */
@Catch()
export class SentryReportFilter extends BaseExceptionFilter {
  private readonly _logger = new Logger(SentryReportFilter.name);

  constructor(httpAdapterHost: HttpAdapterHost) {
    super(httpAdapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    // Capture unexpected errors AND 5xx HttpExceptions — controllers often wrap
    // root causes into HttpException(500) (e.g. media-provider test route), and
    // those would otherwise stay invisible too. Deliberate 4xx stays quiet.
    const status =
      exception instanceof HttpException ? exception.getStatus() : null;
    if (status === null || status >= 500) {
      this._logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
      Sentry.captureException(exception, {
        mechanism: { handled: false, type: 'postmill.global_filter' },
      });
    }
    super.catch(exception, host);
  }
}
