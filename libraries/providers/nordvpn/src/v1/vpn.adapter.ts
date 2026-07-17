import { metadata as providerMetadata } from './metadata';
import {
  ProviderModule,
  VpnCapability,
  VpnConfigValidationResult,
  VpnCredentialField,
  VpnProviderCapabilities,
  VpnProxyAuth,
  VpnProxyRegion,
} from '@gitroom/provider-kernel';

export class NordvpnAdapter implements VpnCapability {
  readonly identifier = 'nordvpn';
  readonly name = 'NordVPN';

  readonly credentialFields: VpnCredentialField[] = [
    {
      key: 'serviceCredentials',
      label: 'Service Credentials',
      type: 'password',
      required: true,
      placeholder: 'username:password from NordVPN manual setup',
    },
    {
      key: 'configUrl',
      label: 'OpenVPN Config URL',
      type: 'text',
      required: false,
      placeholder: 'https://downloads.nordcdn.com/configs/files/ovpn/...',
    },
  ];

  readonly capabilities: VpnProviderCapabilities = {
    wireguard: true,
    openvpn: true,
    ikev2: true,
    socks5: true,
    multiHop: true,
    killSwitch: true,
  };

  readonly setupNotes =
    'Generate manual service credentials in your NordVPN account dashboard. These are separate from your login password. SOCKS5 proxy egress uses the same credentials.';

  // NordVPN's public SOCKS5 proxy endpoints (port 1080). Grounded in NordVPN's
  // published SOCKS5 server list — verify hostnames against a live account.
  readonly proxyRegions: VpnProxyRegion[] = [
    { id: 'nl-amsterdam', label: 'Netherlands — Amsterdam', host: 'amsterdam.nl.socks.nordhold.net', port: 1080, protocol: 'socks5' },
    { id: 'se-stockholm', label: 'Sweden — Stockholm', host: 'stockholm.se.socks.nordhold.net', port: 1080, protocol: 'socks5' },
    { id: 'us-atlanta', label: 'United States — Atlanta', host: 'atlanta.us.socks.nordhold.net', port: 1080, protocol: 'socks5' },
    { id: 'us-dallas', label: 'United States — Dallas', host: 'dallas.us.socks.nordhold.net', port: 1080, protocol: 'socks5' },
    { id: 'us-los-angeles', label: 'United States — Los Angeles', host: 'los-angeles.us.socks.nordhold.net', port: 1080, protocol: 'socks5' },
  ];

  resolveProxyAuth(config: Record<string, string>): VpnProxyAuth | null {
    const creds = config.serviceCredentials?.trim() || '';
    const idx = creds.indexOf(':');
    if (idx <= 0) return null;
    return { username: creds.slice(0, idx), password: creds.slice(idx + 1) };
  }

  validateConfig(config: Record<string, string>): VpnConfigValidationResult {
    const errors: string[] = [];
    const creds = config.serviceCredentials?.trim() || '';
    if (!creds) {
      errors.push('Service credentials are required.');
    } else if (!creds.includes(':')) {
      errors.push('Service credentials must be in the format username:password.');
    }

    const configUrl = config.configUrl?.trim() || '';
    if (configUrl && !/^https:\/\//i.test(configUrl)) {
      errors.push('Config URL must be an HTTPS URL.');
    }

    return { valid: errors.length === 0, errors };
  }

  async healthCheck(config: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }
}

const _meta: VpnCapability = new NordvpnAdapter();

export const nordvpnVpnModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'vpn',
    providerId: _meta.identifier,
    version: 'v1',
    displayName: _meta.name,
    status: 'active',
    credentialFields: _meta.credentialFields as any,
    capabilities: _meta.capabilities,
    setupNotes: _meta.setupNotes,
  },
  create: () => new NordvpnAdapter(),
};
