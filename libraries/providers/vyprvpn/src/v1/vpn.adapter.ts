import { metadata as providerMetadata } from './metadata';
import {
  ProviderModule,
  VpnCapability,
  VpnConfigValidationResult,
  VpnCredentialField,
  VpnProviderCapabilities,
} from '@gitroom/provider-kernel';

export class VyprvpnAdapter implements VpnCapability {
  readonly identifier = 'vyprvpn';
  readonly name = 'VyprVPN';

  readonly credentialFields: VpnCredentialField[] = [
    {
      key: 'serviceCredentials',
      label: 'Service Credentials',
      type: 'password',
      required: true,
      placeholder: 'username:password from VyprVPN control panel',
    },
    {
      key: 'configUrl',
      label: 'OpenVPN / Chameleon Config URL',
      type: 'text',
      required: false,
      placeholder: 'https://www.vyprvpn.com/.../config',
    },
  ];

  readonly capabilities: VpnProviderCapabilities = {
    wireguard: true,
    openvpn: true,
    ikev2: true,
    socks5: false,
    multiHop: false,
    killSwitch: true,
  };

  readonly setupNotes =
    'VyprVPN owns and operates its server network. Use the credentials from the manual setup section of the control panel.';

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

const _meta: VpnCapability = new VyprvpnAdapter();

export const vyprvpnVpnModule: ProviderModule<any, any> = {
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
  create: () => new VyprvpnAdapter(),
};
