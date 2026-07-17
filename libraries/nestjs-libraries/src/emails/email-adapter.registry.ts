import { Injectable } from '@nestjs/common';
import { parseQualified } from '@gitroom/provider-kernel';
import { EmailAdapter } from '@gitroom/nestjs-libraries/emails/email-adapter.interface';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';

/**
 * Facade that resolves the active email adapter through the ProviderKernel.
 *
 * The legacy in-memory registry (`_instances`, `register()`, `getAdapter()`,
 * `list()`) was removed in v4.0.0: email providers now live exclusively in the
 * kernel and are resolved per-call via ProviderResolutionService so every call
 * rides the telemetry proxy and feeds per-version health counters. This class
 * remains as a thin, injectable facade so consumers (EmailService,
 * EmailWebhooksController) do not need to import ProviderResolutionService
 * directly and can stay focused on email concerns.
 */
@Injectable()
export class EmailAdapterRegistry {
  constructor(
    // 4.9: resolve email providers through ProviderResolutionService so every
    // email call rides the telemetry proxy and feeds the per-version health
    // counters — rather than calling `mod.create(ctx)` on the raw kernel module.
    private readonly _resolution: ProviderResolutionService,
  ) {}

  getActiveAdapter(): EmailAdapter {
    const raw = process.env.EMAIL_PROVIDER || '';
    return this._resolveViaKernel(raw);
  }

  /**
   * Resolve the active email module through ProviderResolutionService (kernel +
   * telemetry proxy). EMAIL_PROVIDER accepts a qualified id ("resend@v1"); a bare
   * name ("resend") resolves to the latest active version.
   */
  private _resolveViaKernel(raw: string): EmailAdapter {
    if (!raw) {
      return this._kernelEmpty();
    }

    try {
      const { providerId, version } = parseQualified(raw);
      const adapter = this._resolution.resolveEmail(
        providerId,
        version ? { version } : {},
      );
      if (adapter && adapter.isConfigured()) {
        return adapter;
      }
      return this._kernelEmpty();
    } catch {
      return this._kernelEmpty();
    }
  }

  private _kernelEmpty(): EmailAdapter {
    return this._resolution.resolveEmail('empty');
  }
}
