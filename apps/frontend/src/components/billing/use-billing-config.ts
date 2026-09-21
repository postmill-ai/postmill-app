'use client';

import useSWR from 'swr';
import { useCallback } from 'react';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';

export type BillingCheckoutMode = 'hosted' | 'embedded' | 'native';

export interface BillingProviderCapabilities {
  checkoutMode: BillingCheckoutMode;
  portal: boolean;
  proration: boolean;
  addons: boolean;
  refunds: boolean;
  promoCodes: boolean;
  trials: boolean;
  cardCheck: boolean;
  chargesHistory: boolean;
  periodEndCancel: boolean;
  planChange: boolean;
}

export interface BillingConfig {
  enabled: boolean;
  defaultProvider: string | null;
  providers: Array<{
    providerId: string;
    displayName: string;
    checkoutMode: BillingCheckoutMode;
    publicKey?: string;
  }>;
  /** The provider this organization is (or would be) billed through; null when billing is off. */
  org: {
    provider: string;
    checkoutMode: BillingCheckoutMode;
    capabilities: BillingProviderCapabilities;
    manageUrl: string | null;
  } | null;
}

/** Everything the billing UI needs to decide which affordances to show (no secrets). */
export const useBillingConfig = () => {
  const fetch = useFetch();
  const load = useCallback(async (): Promise<BillingConfig> => (await fetch('/billing/config')).json(), [fetch]);
  return useSWR<BillingConfig>('/billing/config', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
};

/** Display name for a provider id, for copy like "Continue with PayPal". */
export const billingProviderName = (config: BillingConfig | undefined, providerId: string | null) =>
  config?.providers.find((p) => p.providerId === providerId)?.displayName ?? providerId ?? '';
