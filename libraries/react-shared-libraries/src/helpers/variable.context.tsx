'use client';

import { createContext, FC, ReactNode, useContext, useEffect } from 'react';

/** The deployment's default web payment provider, as the server layouts resolve it (no secrets). */
export interface PaymentsVariables {
  provider: string | null;
  checkoutMode: 'hosted' | 'embedded' | 'native' | null;
  /** Stripe publishable key / PayPal client id — whatever the checkout UI needs. */
  publicKey: string;
  displayName: string;
}

export const NO_PAYMENTS: PaymentsVariables = {
  provider: null,
  checkoutMode: null,
  publicKey: '',
  displayName: '',
};

interface VariableContextInterface {
  payments: PaymentsVariables;
  billingEnabled: boolean;
  isGeneral: boolean;
  genericOauth: boolean;
  oauthLogoUrl: string;
  oauthDisplayName: string;
  mcpUrl?: string;
  mainUrl: string;
  frontEndUrl: string;
  storageProvider: 'local';
  backendUrl: string;
  environment: string;
  discordUrl: string;
  uploadDirectory: string;
  facebookPixel: string;
  telegramBotName: string;
  neynarClientId: string;
  isSecured: boolean;
  disableImageCompression: boolean;
  disableXAnalytics: boolean;
  language: string;
  dub: boolean;
  transloadit: string[];
  sentryDsn: string;
  extensionId: string;
  googleAdsId?: string;
  googleAdsTrialTracking?: string;
}
const VariableContext = createContext({
  payments: NO_PAYMENTS,
  billingEnabled: false,
  isGeneral: true,
  genericOauth: false,
  oauthLogoUrl: '',
  googleAdsId: '',
  googleAdsTrialTracking: '',
  oauthDisplayName: '',
  mcpUrl: '',
  mainUrl: '',
  frontEndUrl: '',
  storageProvider: 'local' as const,
  backendUrl: '',
  discordUrl: '',
  uploadDirectory: '',
  isSecured: false,
  telegramBotName: '',
  facebookPixel: '',
  neynarClientId: '',
  disableImageCompression: false,
  disableXAnalytics: false,
  language: '',
  dub: false,
  transloadit: [],
  sentryDsn: '',
  extensionId: '',
} as VariableContextInterface);
export const VariableContextComponent: FC<
  VariableContextInterface & {
    children: ReactNode;
  }
> = (props) => {
  const { children, ...otherProps } = props;
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // @ts-ignore
      window.vars = otherProps;
    }
  }, [otherProps]);
  return (
    <VariableContext.Provider value={otherProps}>
      {children}
    </VariableContext.Provider>
  );
};
export const useVariables = () => {
  return useContext(VariableContext);
};
export const loadVars = () => {
  // @ts-ignore
  return window.vars as VariableContextInterface;
};
