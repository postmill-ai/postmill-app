import {
  ProviderSurfaceDescriptor,
  ProviderRow,
  ProviderFormState,
  CapabilityMeta,
} from '../provider-surface.types';
import { createFetchError } from '../../fetch-error';
import {
  VpnConfigResponse,
  VpnProviderInfo,
} from '@gitroom/frontend/components/settings/vpn/hooks/useVpnConfig';

/**
 * VPN provider settings surface descriptor (Provider Settings Kit).
 *
 * VPN has NO `set-active` backend route — there is no stored "Primary" provider
 * here (the per-channel egress default lives in the Channels surface), so
 * `features.primary` is false and no Make-Primary button is rendered.
 */

const CAPABILITY_LABELS: Record<string, string> = {
  wireguard: 'WireGuard',
  openvpn: 'OpenVPN',
  ikev2: 'IKEv2',
  socks5: 'SOCKS5',
  multiHop: 'Multi-hop',
  killSwitch: 'Kill switch',
};

const CAPABILITY_COLORS: Record<string, string> = {
  wireguard: 'bg-cyan-500/20 text-cyan-800 dark:text-cyan-400',
  openvpn: 'bg-blue-500/20 text-blue-800 dark:text-blue-400',
  ikev2: 'bg-indigo-500/20 text-indigo-800 dark:text-indigo-400',
  socks5: 'bg-amber-500/20 text-amber-800 dark:text-amber-400',
  multiHop: 'bg-purple-500/20 text-purple-800 dark:text-purple-400',
  killSwitch: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-400',
};

const capabilityMeta: Record<string, CapabilityMeta> = Object.fromEntries(
  Object.keys(CAPABILITY_LABELS).map(
    (key): [string, CapabilityMeta] => [
      key,
      { label: CAPABILITY_LABELS[key], color: CAPABILITY_COLORS[key] },
    ],
  ),
);

export const vpnDescriptor: ProviderSurfaceDescriptor<VpnProviderInfo> = {
  key: 'vpn',
  title: 'VPN',
  description:
    'Route your posts through a private connection for extra security or to meet location rules.',
  basePath: '/settings/vpn',
  swrKey: 'org-vpn-config',
  catalogDomain: 'vpn',

  load: async (fetch) => {
    const res = await fetch('/settings/vpn/config');
    if (!res.ok) throw createFetchError('failed_to_load_vpn_config', 'Failed to load VPN config');
    const data: VpnConfigResponse = await res.json();
    const rows: ProviderRow<VpnProviderInfo>[] = (data.providers || []).map(
      (p) => ({
        id: p.identifier,
        identifier: p.identifier,
        name: p.name,
        isConfigured: p.isConfigured,
        isPrimary: false,
        enabled: p.enabled,
        capabilities: Object.entries(p.capabilities || {})
          .filter(([, supported]) => supported)
          .map(([key]) => key),
        version: p.version,
        meta: p,
      }),
    );
    return { rows };
  },

  features: { toggle: true, primary: false, remove: true, test: true },

  filter: { search: true },

  capabilityMeta,

  form: {
    instanceName: true,
    extraFields: [
      { type: 'instance-name', key: 'name' },
      { type: 'region-checklist', key: 'regions' },
    ],
    credentialFieldsFromMeta: (m) => m.credentialFields,
    buildBody: (state: ProviderFormState, meta: VpnProviderInfo) => ({
      name: state.name || undefined,
      credentials: Object.values(state.credentials).some((v) => v)
        ? state.credentials
        : undefined,
      regions:
        meta.proxyRegions?.length && !meta.isDynamicRegions
          ? state.extra.regions
          : undefined,
      // Preserve the current enable state — editing creds must NOT silently
      // re-enable a provider an admin toggled off (egress safety). The list On/Off
      // toggle is the only thing that flips this; new configs default to disabled.
      enabled: !!meta.enabled,
    }),
    buildTestBody: (state: ProviderFormState) => ({
      credentials: state.credentials,
    }),
    seedState: (meta: VpnProviderInfo) => ({
      extra: { regions: meta.enabledRegions ?? [] },
    }),
  },
};
