import { metadata as providerMetadata } from './metadata';
import {
  ProviderModule,
  VpnCapability,
  VpnConfigValidationResult,
  VpnCredentialField,
  VpnProviderCapabilities,
} from '@gitroom/provider-kernel';

export class IpvanishAdapter implements VpnCapability {
  readonly identifier = 'ipvanish';
  readonly name = 'IPVanish';

  readonly credentialFields: VpnCredentialField[] = [
    {
      key: 'serviceCredentials',
      label: 'Service Credentials',
      type: 'password',
      required: true,
      placeholder: 'username:password from IPVanish account',
    },
    {
      key: 'configUrl',
      label: 'OpenVPN Config URL',
      type: 'text',
      required: false,
      placeholder: 'https://www.ipvanish.com/.../config',
    },
  ];

  readonly capabilities: VpnProviderCapabilities = {
    wireguard: true,
    openvpn: true,
    ikev2: true,
    socks5: true,
    multiHop: false,
    killSwitch: true,
  };

  readonly setupNotes =
    'Use your IPVanish account username and password for manual OpenVPN/WireGuard setups.';

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

const _meta: VpnCapability = new IpvanishAdapter();

export const ipvanishVpnModule: ProviderModule<any, any> = {
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
  create: () => new IpvanishAdapter(),
};
