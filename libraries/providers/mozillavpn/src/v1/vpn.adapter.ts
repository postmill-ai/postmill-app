import { metadata as providerMetadata } from './metadata';
import {
  ProviderModule,
  VpnCapability,
  VpnConfigValidationResult,
  VpnCredentialField,
  VpnProviderCapabilities,
} from '@gitroom/provider-kernel';

export class MozillavpnAdapter implements VpnCapability {
  readonly identifier = 'mozillavpn';
  readonly name = 'Mozilla VPN';

  readonly credentialFields: VpnCredentialField[] = [
    {
      key: 'subscriptionKey',
      label: 'Subscription Key',
      type: 'password',
      required: true,
      placeholder: 'Mozilla VPN subscription or device key',
    },
    {
      key: 'configUrl',
      label: 'WireGuard Config URL',
      type: 'text',
      required: false,
      placeholder: 'https://vpn.mozilla.org/.../config',
    },
  ];

  readonly capabilities: VpnProviderCapabilities = {
    wireguard: true,
    openvpn: false,
    ikev2: false,
    socks5: false,
    multiHop: false,
    killSwitch: true,
  };

  readonly setupNotes =
    'Mozilla VPN runs on Mullvad’s WireGuard backend. Paste your subscription/device key and an optional WireGuard config URL.';

  validateConfig(config: Record<string, string>): VpnConfigValidationResult {
    const errors: string[] = [];
    if (!config.subscriptionKey?.trim()) {
      errors.push('Subscription key is required.');
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

const _meta: VpnCapability = new MozillavpnAdapter();

export const mozillavpnVpnModule: ProviderModule<any, any> = {
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
  create: () => new MozillavpnAdapter(),
};
