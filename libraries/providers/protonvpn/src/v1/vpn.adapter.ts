import { metadata as providerMetadata } from './metadata';
import {
  ProviderModule,
  VpnCapability,
  VpnConfigValidationResult,
  VpnCredentialField,
  VpnProviderCapabilities,
} from '@gitroom/provider-kernel';

export class ProtonvpnAdapter implements VpnCapability {
  readonly identifier = 'protonvpn';
  readonly name = 'Proton VPN';

  readonly credentialFields: VpnCredentialField[] = [
    {
      key: 'openvpnCredentials',
      label: 'OpenVPN / IKEv2 Credentials',
      type: 'password',
      required: true,
      placeholder: 'username:password from Proton VPN account settings',
    },
    {
      key: 'configUrl',
      label: 'Config File URL',
      type: 'text',
      required: false,
      placeholder: 'https://account.protonvpn.com/.../config',
    },
  ];

  readonly capabilities: VpnProviderCapabilities = {
    wireguard: true,
    openvpn: true,
    ikev2: true,
    socks5: false,
    multiHop: true,
    killSwitch: true,
  };

  readonly setupNotes =
    'Proton VPN uses separate OpenVPN/IKEv2 credentials. Find them under Account → OpenVPN / IKEv2 credentials.';

  validateConfig(config: Record<string, string>): VpnConfigValidationResult {
    const errors: string[] = [];
    const creds = config.openvpnCredentials?.trim() || '';
    if (!creds) {
      errors.push('OpenVPN / IKEv2 credentials are required.');
    } else if (!creds.includes(':')) {
      errors.push('Credentials must be in the format username:password.');
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

const _meta: VpnCapability = new ProtonvpnAdapter();

export const protonvpnVpnModule: ProviderModule<any, any> = {
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
  create: () => new ProtonvpnAdapter(),
};
