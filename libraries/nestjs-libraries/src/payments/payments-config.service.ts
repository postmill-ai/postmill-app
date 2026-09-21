import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PaymentsCapability } from '@postmill-ai/provider-kernel';
import {
  PAYMENT_PROVIDER_ENV,
  PaymentProviderId,
  billingEnabled,
  configuredPaymentProviders,
  isPaymentProviderConfigured,
  isPaymentProviderId,
  missingPaymentProviderKeys,
  publicPaymentsConfig,
  resolveDefaultWebPaymentProvider,
} from '@postmill-ai/helpers/billing/payments.env';
import { ProviderResolutionService } from '@postmill-ai/nestjs-libraries/providers/provider-resolution.service';

/**
 * Which payment providers this deployment runs. Thin wrapper over the pure env
 * helpers (`libraries/helpers/billing/payments.env.ts`) plus kernel resolution;
 * logs the resolved default at boot so an operator with several key sets and
 * no `PAYMENTS_PROVIDER` sees the choice that was made for them.
 */
@Injectable()
export class PaymentsConfigService implements OnModuleInit {
  private readonly _logger = new Logger(PaymentsConfigService.name);

  constructor(private readonly _resolution: ProviderResolutionService) {}

  onModuleInit() {
    const configured = configuredPaymentProviders();
    if (configured.length === 0) {
      this._logger.log('No payment provider configured — billing is off (self-host mode).');
      return;
    }
    for (const id of configured) {
      const missing = missingPaymentProviderKeys(id);
      if (missing.length) {
        this._logger.warn(
          `Payment provider ${id} is enabled by ${PAYMENT_PROVIDER_ENV[id].enabledBy} but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set.`,
        );
      }
    }
    const resolved = resolveDefaultWebPaymentProvider();
    if (resolved.reason === 'ambiguous' || resolved.reason === 'invalid') {
      this._logger.error(resolved.detail!);
    }
    this._logger.log(
      `Payment providers: ${configured.join(', ')}; web checkout default: ${resolved.providerId ?? 'none'} (${resolved.reason}).`,
    );
  }

  billingEnabled(): boolean {
    return billingEnabled();
  }

  defaultWebProvider(): PaymentProviderId | null {
    return resolveDefaultWebPaymentProvider().providerId;
  }

  publicConfig() {
    return publicPaymentsConfig();
  }

  isConfigured(providerId: string): providerId is PaymentProviderId {
    return isPaymentProviderId(providerId) && isPaymentProviderConfigured(providerId);
  }

  /** The kernel capability for a configured provider; 404 otherwise (unknown route param, keys unset). */
  resolve(providerId: string): PaymentsCapability {
    const capability = this.tryResolve(providerId);
    if (!capability) {
      throw new NotFoundException(`Payment provider "${providerId}" is not configured`);
    }
    return capability;
  }

  tryResolve(providerId: string): PaymentsCapability | null {
    if (!this.isConfigured(providerId)) {
      return null;
    }
    try {
      const capability = this._resolution.resolvePayments(providerId);
      return capability.isConfigured() ? capability : null;
    } catch {
      return null;
    }
  }
}
