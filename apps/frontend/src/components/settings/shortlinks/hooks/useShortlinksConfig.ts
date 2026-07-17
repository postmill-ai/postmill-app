'use client';

import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { createFetchError } from '../../shared/fetch-error';

export interface ShortlinkProviderInfo {
  identifier: string;
  name: string;
  capabilities: {
    create: boolean;
    expand: boolean;
    statistics: boolean;
    bulkStatistics: boolean;
    customDomain: boolean;
  };
  credentialFields: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
    options?: Array<{ label: string; value: string }>;
  }>;
  authType: string;
  defaultDomain?: string;
  setupNotes?: string;
  enabled: boolean;
  isActive: boolean;
  isConfigured: boolean;
  version: string;
  customDomain: string;
  configName: string;
  accountFingerprint: string;
  createdAt: string | null;
  updatedAt: string | null;
  configs: ShortlinkAccountConfig[];
}

export interface ShortlinkAccountConfig {
  id: string;
  name: string;
  accountFingerprint: string;
  isActive: boolean;
  customDomain: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShortlinksConfigResponse {
  active: {
    identifier: string;
    name: string;
    capabilities: ShortlinkProviderInfo['capabilities'];
    customDomain?: string;
  } | null;
  providers: ShortlinkProviderInfo[];
}

export const useShortlinksConfig = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch('/settings/shortlinks/config');
    if (!res.ok) throw createFetchError('failed_to_load_shortlinks_config', 'Failed to load shortlinks config');
    return res.json();
  }, [fetch]);
  return useSWR<ShortlinksConfigResponse>('org-shortlinks-config', load, {
    revalidateOnFocus: false,
  });
};

export const useShortlinksProviders = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch('/settings/shortlinks/providers');
    if (!res.ok) throw createFetchError('failed_to_load_shortlinks_providers', 'Failed to load shortlinks providers');
    return res.json();
  }, [fetch]);
  return useSWR<ShortlinkProviderInfo[]>('org-shortlinks-providers', load, {
    revalidateOnFocus: false,
  });
};
