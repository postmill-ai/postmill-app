import {
  billingEnabled,
  publicPaymentsConfig,
} from '@postmill-ai/helpers/billing/payments.env';
import {
  NO_PAYMENTS,
  PaymentsVariables,
} from '@postmill-ai/react/helpers/variable.context';

/**
 * Server-side (layout) view of the payment configuration: the billing master
 * switch and the default web provider's public bits. Evaluated per request from
 * process.env, like the STRIPE_PUBLISHABLE_KEY checks it replaces.
 */
export function paymentsVariables(): { billingEnabled: boolean; payments: PaymentsVariables } {
  const config = publicPaymentsConfig();
  const active = config.providers.find((p) => p.providerId === config.defaultProvider);
  return {
    billingEnabled: billingEnabled(),
    payments: active
      ? {
          provider: active.providerId,
          checkoutMode: active.checkoutMode,
          publicKey: active.publicKey ?? '',
          displayName: active.displayName,
        }
      : NO_PAYMENTS,
  };
}
