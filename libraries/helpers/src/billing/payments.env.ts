/**
 * Payment-provider env truth — pure and isomorphic so it can be evaluated in
 * leaf services, Inngest activities, MCP tools and Next.js server layouts that
 * have no access to the ProviderKernel.
 *
 * `billingEnabled()` is the billing master switch (it used to be
 * `!!process.env.STRIPE_PUBLISHABLE_KEY`). A provider is *configured* when its
 * `enabledBy` key is set; the rest of `required` is validated at boot with a
 * warning. Reads `process.env` on every call — no caching — because specs and
 * the self-host docs rely on toggling the key at runtime.
 *
 * Kept in lockstep with the registered kernel modules by
 * `apps/backend/src/__tests__/payments-env-lockstep.spec.ts`. Adding a payment
 * provider means adding a row here AND a kernel module.
 */

export type PaymentsCheckoutMode = 'hosted' | 'embedded' | 'native';

export interface PaymentProviderEnv {
  /** The single key whose presence enables the provider. */
  enabledBy: string;
  /** Every key the adapter reads (`enabledBy` included). */
  required: readonly string[];
  checkoutMode: PaymentsCheckoutMode;
  /** Browser-safe key exposed to the checkout UI. */
  publicKeyEnv?: string;
  displayName: string;
}

export const PAYMENT_PROVIDER_ENV = {
  stripe: {
    enabledBy: 'STRIPE_PUBLISHABLE_KEY',
    required: ['STRIPE_PUBLISHABLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_SIGNING_KEY'],
    checkoutMode: 'embedded',
    publicKeyEnv: 'STRIPE_PUBLISHABLE_KEY',
    displayName: 'Stripe',
  },
  paypal: {
    enabledBy: 'PAYPAL_CLIENT_ID',
    required: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'],
    checkoutMode: 'hosted',
    publicKeyEnv: 'PAYPAL_CLIENT_ID',
    displayName: 'PayPal',
  },
  apple: {
    enabledBy: 'APPLE_IAP_BUNDLE_ID',
    required: ['APPLE_IAP_BUNDLE_ID', 'APPLE_IAP_ISSUER_ID', 'APPLE_IAP_KEY_ID', 'APPLE_IAP_PRIVATE_KEY'],
    checkoutMode: 'native',
    displayName: 'App Store',
  },
  google: {
    enabledBy: 'GOOGLE_PLAY_PACKAGE_NAME',
    required: ['GOOGLE_PLAY_PACKAGE_NAME', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'],
    checkoutMode: 'native',
    displayName: 'Google Play',
  },
} as const satisfies Record<string, PaymentProviderEnv>;

export type PaymentProviderId = keyof typeof PAYMENT_PROVIDER_ENV;

/** Widened row view — the `as const` table narrows literals too far for comparisons. */
export function paymentProviderEnv(id: PaymentProviderId): PaymentProviderEnv {
  return PAYMENT_PROVIDER_ENV[id];
}

export const PAYMENT_PROVIDER_IDS = Object.keys(PAYMENT_PROVIDER_ENV) as PaymentProviderId[];

export function isPaymentProviderId(value: string): value is PaymentProviderId {
  return Object.prototype.hasOwnProperty.call(PAYMENT_PROVIDER_ENV, value);
}

type Env = Record<string, string | undefined>;

export function isPaymentProviderConfigured(id: PaymentProviderId, env: Env = process.env): boolean {
  return !!env[PAYMENT_PROVIDER_ENV[id].enabledBy];
}

/** Configured providers in table order (stripe first — the tie-break for an ambiguous default). */
export function configuredPaymentProviders(env: Env = process.env): PaymentProviderId[] {
  return PAYMENT_PROVIDER_IDS.filter((id) => isPaymentProviderConfigured(id, env));
}

/** Billing master switch: at least one payment provider is configured. */
export function billingEnabled(env: Env = process.env): boolean {
  return configuredPaymentProviders(env).length > 0;
}

/** `required` keys that are missing although the provider is enabled — surfaced as a boot warning. */
export function missingPaymentProviderKeys(id: PaymentProviderId, env: Env = process.env): string[] {
  if (!isPaymentProviderConfigured(id, env)) {
    return [];
  }
  return PAYMENT_PROVIDER_ENV[id].required.filter((key) => !env[key]);
}

export type DefaultWebProviderReason = 'explicit' | 'single' | 'ambiguous' | 'none' | 'invalid';

export interface DefaultWebProviderResolution {
  providerId: PaymentProviderId | null;
  reason: DefaultWebProviderReason;
  /** Human-readable detail for the boot log on `ambiguous` / `invalid`. */
  detail?: string;
}

/**
 * Which provider serves web checkout.
 * - `PAYMENTS_PROVIDER` set → must name a configured, non-native provider
 *   (`invalid` otherwise, and then the unset rules apply as the fallback).
 * - unset, exactly one configured web provider → `single`.
 * - unset, several → `ambiguous` + deterministic pick (table order: stripe first).
 * - none → `none`.
 * A qualified id (`stripe@v1`) is accepted; the version part is ignored here.
 */
export function resolveDefaultWebPaymentProvider(env: Env = process.env): DefaultWebProviderResolution {
  const web = configuredPaymentProviders(env).filter(
    (id) => paymentProviderEnv(id).checkoutMode !== 'native',
  );
  const raw = (env.PAYMENTS_PROVIDER || '').trim();
  const fallback = (): DefaultWebProviderResolution => {
    if (web.length === 0) {
      return { providerId: null, reason: 'none' };
    }
    if (web.length === 1) {
      return { providerId: web[0], reason: 'single' };
    }
    return {
      providerId: web[0],
      reason: 'ambiguous',
      detail: `Several payment providers are configured (${web.join(', ')}) and PAYMENTS_PROVIDER is unset — defaulting web checkout to ${web[0]}.`,
    };
  };

  if (!raw) {
    return fallback();
  }
  const requested = raw.split('@')[0];
  if (!isPaymentProviderId(requested)) {
    return { ...fallback(), reason: 'invalid', detail: `PAYMENTS_PROVIDER=${raw} is not a known payment provider.` };
  }
  if (paymentProviderEnv(requested).checkoutMode === 'native') {
    return {
      ...fallback(),
      reason: 'invalid',
      detail: `PAYMENTS_PROVIDER=${raw} is a native (app-store) provider and cannot serve web checkout.`,
    };
  }
  if (!isPaymentProviderConfigured(requested, env)) {
    return {
      ...fallback(),
      reason: 'invalid',
      detail: `PAYMENTS_PROVIDER=${raw} but ${PAYMENT_PROVIDER_ENV[requested].enabledBy} is not set.`,
    };
  }
  return { providerId: requested, reason: 'explicit' };
}

export interface PublicPaymentProviderConfig {
  providerId: PaymentProviderId;
  displayName: string;
  checkoutMode: PaymentsCheckoutMode;
  publicKey?: string;
}

export interface PublicPaymentsConfig {
  enabled: boolean;
  defaultProvider: PaymentProviderId | null;
  providers: PublicPaymentProviderConfig[];
}

/** Browser-safe snapshot: no secret ever leaves this function. */
export function publicPaymentsConfig(env: Env = process.env): PublicPaymentsConfig {
  const providers = configuredPaymentProviders(env).map((id) => {
    const row = paymentProviderEnv(id);
    return {
      providerId: id,
      displayName: row.displayName,
      checkoutMode: row.checkoutMode,
      ...(row.publicKeyEnv ? { publicKey: env[row.publicKeyEnv] } : {}),
    };
  });
  return {
    enabled: providers.length > 0,
    defaultProvider: resolveDefaultWebPaymentProvider(env).providerId,
    providers,
  };
}
