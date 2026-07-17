import { metadata as providerMetadata } from './metadata';
import {
  ProviderModule,
  VpnCapability,
  VpnConfigValidationResult,
  VpnCredentialField,
  VpnProviderCapabilities,
} from '@gitroom/provider-kernel';

export class HotspotshieldAdapter implements VpnCapability {
  readonly identifier = 'hotspotshield';
  readonly name = 'Hotspot Shield';

  readonly credentialFields: VpnCredentialField[] = [
    {
      key: 'serviceCredentials',
      label: 'Service Credentials',
      type: 'password',
      required: true,
      placeholder: 'username:password from Hotspot Shield account',
    },
    {
      key: 'configUrl',
      label: 'Hydra / OpenVPN Config URL',
      type: 'text',
      required: false,
      placeholder: 'https://www.hotspotshield.com/.../config',
    },
  ];

  readonly capabilities: VpnProviderCapabilities = {
    wireguard: false,
    openvpn: true,
    ikev2: true,
    socks5: false,
    multiHop: false,
    killSwitch: true,
  };

  readonly setupNotes =
    'Hotspot Shield uses its proprietary Hydra protocol by default; OpenVPN/IKEv2 credentials may be available in premium account settings.';

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

const _meta: VpnCapability = new HotspotshieldAdapter();

export const hotspotshieldVpnModule: ProviderModule<any, any> = {
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
  create: () => new HotspotshieldAdapter(),
};
