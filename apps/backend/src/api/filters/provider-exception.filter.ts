import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Response } from 'express';
import {
  ProviderKernel,
  ProviderCredentialError,
  ProviderManifestError,
  ProviderNotFoundError,
  ProviderVersionDeprecatedForWriteError,
  ProviderVersionRetiredError,
  ContentPackDailyCapError,
  ProviderUpstreamError,
} from '@postmill-ai/provider-kernel';
import { PROVIDER_KERNEL } from '@postmill-ai/nestjs-libraries/providers/providers.module';

// Where the org fixes a provider's key / plan, by kernel domain.
const SETTINGS_URL_BY_DOMAIN: Record<string, string> = {
  ai: '/settings/ai',
  media: '/settings/content/ai-media',
  social: '/settings/channels',
  shortlink: '/settings/shortlinks',
  storage: '/settings/storage',
};

// Kinds the org's own account explains (key, plan, request) — the user's
// provider said no, so Sentry stays quiet. Outages / unclassified failures are
// worth a warning-level breadcrumb per provider.
const SENTRY_WARN_KINDS = new Set(['unavailable', 'timeout', 'unknown']);

@Catch(
  ProviderUpstreamError,
  ProviderVersionRetiredError,
  ProviderVersionDeprecatedForWriteError,
  ProviderNotFoundError,
  ProviderCredentialError,
  ProviderManifestError,
  ContentPackDailyCapError,
)
export class ProviderExceptionFilter implements ExceptionFilter {
  private readonly _logger = new Logger(ProviderExceptionFilter.name);

  constructor(
    @Inject(PROVIDER_KERNEL) private readonly _kernel: ProviderKernel,
  ) {}

  catch(exception: Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof ProviderUpstreamError) {
      this._upstream(exception, response);
      return;
    }

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

  // An upstream provider (the org's OpenAI / Google / Runway … account) said
  // no. 502 Bad Gateway: honest about where it failed, and a status the
  // frontend's global handlers leave alone (401 → logout, 402 → Postmill
  // billing, 429 → Postmill rate limit would all misattribute it). The
  // envelope lets the UI name the provider.
  private _upstream(exception: ProviderUpstreamError, response: Response) {
    const { ctx, kind, upstreamStatus, retryable, message } = exception;
    this._logger.warn(
      `provider upstream error ${ctx.domain}/${ctx.providerId} ${kind}` +
        `${upstreamStatus ? ` HTTP ${upstreamStatus}` : ''}` +
        `${ctx.operation ? ` (${ctx.operation})` : ''}: ${exception.detail}`,
    );
    if (SENTRY_WARN_KINDS.has(kind)) {
      Sentry.captureMessage(message, {
        level: 'warning',
        tags: { provider: ctx.providerId, domain: ctx.domain, kind },
        fingerprint: ['provider-upstream', ctx.domain, ctx.providerId, kind],
      });
    }
    response.status(HttpStatus.BAD_GATEWAY).json({
      statusCode: HttpStatus.BAD_GATEWAY,
      error: 'ProviderUpstreamError',
      provider: ctx.providerId,
      providerName: ctx.providerName,
      domain: ctx.domain,
      operation: ctx.operation,
      kind,
      upstreamStatus,
      retryable,
      message,
      settingsUrl: SETTINGS_URL_BY_DOMAIN[ctx.domain] || '/settings',
    });
  }
}
