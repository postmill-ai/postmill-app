import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ProviderKernel,
  ProviderCredentialError,
  ProviderManifestError,
  ProviderNotFoundError,
  ProviderVersionDeprecatedForWriteError,
  ProviderVersionRetiredError,
  ContentPackDailyCapError,
} from '@gitroom/provider-kernel';
import { PROVIDER_KERNEL } from '@gitroom/nestjs-libraries/providers/providers.module';

@Catch(
  ProviderVersionRetiredError,
  ProviderVersionDeprecatedForWriteError,
  ProviderNotFoundError,
  ProviderCredentialError,
  ProviderManifestError,
  ContentPackDailyCapError,
)
export class ProviderExceptionFilter implements ExceptionFilter {
  constructor(
    @Inject(PROVIDER_KERNEL) private readonly _kernel: ProviderKernel,
  ) {}

  catch(exception: Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    const body: Record<string, unknown> = {
      message: exception.message,
      providerId: (exception as any).ctx?.providerId,
      version: (exception as any).ctx?.version,
    };

    if (exception instanceof ProviderVersionRetiredError) {
      status = HttpStatus.GONE;
      const latest = this._kernel.latestActive(
        (exception as ProviderVersionRetiredError).ctx.domain as any,
        (exception as ProviderVersionRetiredError).ctx.providerId,
      );
      if (latest) {
        body.latestActive = latest.manifest.version;
      }
    } else if (
      exception instanceof ProviderVersionDeprecatedForWriteError ||
      exception instanceof ProviderCredentialError
    ) {
      status = HttpStatus.BAD_REQUEST;
    } else if (exception instanceof ProviderNotFoundError) {
      status = HttpStatus.NOT_FOUND;
    } else if (exception instanceof ContentPackDailyCapError) {
      // 1.7: a content pack's daily quota/rate limit → 402 Payment Required so
      // the UI shows a clear "limit reached" instead of a generic 500.
      status = HttpStatus.PAYMENT_REQUIRED;
    }

    response.status(status).json(body);
  }
}
