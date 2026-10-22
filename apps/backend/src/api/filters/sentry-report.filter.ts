import {
  ArgumentsHost,
  Catch,
  HttpException,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';

/**
 * Backstop filter, registered LAST: the specific filters (provider errors,
 * 401s, validation) get first chance to shape their responses, and anything
 * that falls through lands here. Unexpected errors (plain `Error`s, not
 * deliberate HttpExceptions) are reported to Sentry before the default
 * error response renders — previously these only hit the Nest log and
 * never reached Sentry (e.g. the HeyGen avatar-catalog timeout 500).
 */
@Catch()
export class SentryReportFilter extends BaseExceptionFilter {
  private readonly _logger = new Logger(SentryReportFilter.name);

  constructor(httpAdapterHost: HttpAdapterHost) {
    super(httpAdapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    if (!(exception instanceof HttpException)) {
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
