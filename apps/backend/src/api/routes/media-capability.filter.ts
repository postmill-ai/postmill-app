import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { CapabilityNotAvailable } from '@gitroom/nestjs-libraries/ai/governance/errors';
import { DefaultNotConfiguredError } from '@gitroom/nestjs-libraries/ai/defaults/ai-defaults.service';

// Narrowly-scoped (MediaController only, via @UseFilters) so it never reclassifies
// unrelated 500s elsewhere. Maps the two "tool isn't configured for this org" errors that
// the media tool endpoints throw onto a clean HTTP 409 — consistent with the public
// generate-video route's manual mapping. Endpoints that deliberately fall back instead of
// throwing (generate-video → image, upscale → original) never reach here, so their
// behaviour is preserved.
@Catch(CapabilityNotAvailable, DefaultNotConfiguredError)
export class MediaCapabilityFilter implements ExceptionFilter {
  private readonly _logger = new Logger('MediaCapabilityFilter');

  catch(
    exception: CapabilityNotAvailable | DefaultNotConfiguredError,
    host: ArgumentsHost,
  ) {
    const res = host.switchToHttp().getResponse<Response>();
    const category =
      exception instanceof DefaultNotConfiguredError
        ? exception.category
        : exception.capability;
    this._logger.warn(`Media tool unavailable (409): ${exception.message}`);
    res.status(409).json({ error: exception.message, category });
  }
}
