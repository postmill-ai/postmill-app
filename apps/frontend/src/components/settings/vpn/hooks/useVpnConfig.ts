'use client';

import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { createFetchError } from '../../shared/fetch-error';

export interface VpnProviderCapabilityInfo {
  wireguard: boolean;
  openvpn: boolean;
  ikev2: boolean;
  socks5: boolean;
  multiHop: boolean;
  killSwitch: boolean;
}

export interface VpnCredentialFieldInfo {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
}

export interface VpnProviderInfo {
  identifier: string;
  name: string;
  enabled: boolean;
  isConfigured: boolean;
  version: string;
  capabilities: VpnProviderCapabilityInfo;
  credentialFields: VpnCredentialFieldInfo[];
  proxyRegions: VpnProxyRegionInfo[];
  enabledRegions: string[];
  isDynamicRegions: boolean;
  setupNotes?: string;
}

export interface VpnProxyRegionInfo {
  id: string;
  label: string;
  host: string;
  port: number;
  protocol: 'socks5' | 'http-connect';
}

export interface VpnConfigResponse {
  providers: VpnProviderInfo[];
}

export const useVpnConfig = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch('/settings/vpn/config');
    if (!res.ok) throw createFetchError('failed_to_load_vpn_config', 'Failed to load VPN config');
    return res.json();
  }, [fetch]);
  return useSWR<VpnConfigResponse>('org-vpn-config', load, {
    revalidateOnFocus: false,
  });
};

export const useVpnProviders = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch('/settings/vpn/providers');
    if (!res.ok) throw createFetchError('failed_to_load_vpn_providers', 'Failed to load VPN providers');
    return res.json();
  }, [fetch]);
  return useSWR<VpnConfigResponse>('org-vpn-providers', load, {
    revalidateOnFocus: false,
  });
};
