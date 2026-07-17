import * as net from 'net';

import { metadata as providerMetadata } from './metadata';
import {
  ProviderModule,
  VpnCapability,
  VpnConfigValidationResult,
  VpnCredentialField,
  VpnProviderCapabilities,
  VpnProxyAuth,
  VpnProxyProtocol,
  VpnProxyRegion,
} from '@gitroom/provider-kernel';

// Generic "bring-your-own proxy" provider. The org supplies its own SOCKS5 /
// HTTP-CONNECT endpoint (e.g. a proxy on their office network reachable over
// their corporate VPN), and channels using it egress from that proxy's IP.
// Unlike the consumer-VPN adapters there is no fixed region catalog — the single
// region is derived from the stored config (`resolveRegions`).
export class CustomProxyAdapter implements VpnCapability {
  readonly identifier = 'custom';
  readonly name = 'Custom VPN / Proxy';

  readonly credentialFields: VpnCredentialField[] = [
    {
      key: 'label',
      label: 'Connection name',
      type: 'text',
      required: true,
      placeholder: 'e.g. Office VPN',
    },
    {
      key: 'host',
      label: 'Proxy host',
      type: 'text',
      required: true,
      placeholder: 'proxy.example.com or 203.0.113.5',
    },
    {
      key: 'port',
      label: 'Proxy port',
      type: 'text',
      required: true,
      placeholder: '1080',
    },
    {
      key: 'protocol',
      label: 'Protocol',
      type: 'select',
      required: true,
      options: [
        { label: 'SOCKS5', value: 'socks5' },
        { label: 'HTTP (CONNECT)', value: 'http-connect' },
      ],
    },
    {
      key: 'username',
      label: 'Username (optional)',
      type: 'text',
      required: false,
    },
    {
      key: 'password',
      label: 'Password (optional)',
      type: 'password',
      required: false,
    },
  ];

  readonly capabilities: VpnProviderCapabilities = {
    wireguard: false,
    openvpn: false,
    ikev2: false,
    socks5: true,
    multiHop: false,
    killSwitch: false,
  };

  readonly setupNotes =
    'Route this organization’s posts through your own SOCKS5 or HTTP proxy — e.g. a proxy on your office network. The proxy must be reachable from the Postmill server (a public host, or a private address with SSRF_ALLOWED_PRIVATE_CIDRS set on a self-hosted instance).';

  validateConfig(config: Record<string, string>): VpnConfigValidationResult {
    const errors: string[] = [];
    if (!config.label?.trim()) {
      errors.push('Connection name is required.');
    }
    if (!config.host?.trim()) {
      errors.push('Proxy host is required.');
    }
    const port = Number(config.port);
    if (!config.port?.trim()) {
      errors.push('Proxy port is required.');
    } else if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push('Proxy port must be a number between 1 and 65535.');
    }
    const protocol = config.protocol?.trim();
    if (protocol !== 'socks5' && protocol !== 'http-connect') {
      errors.push('Protocol must be SOCKS5 or HTTP (CONNECT).');
    }
    return { valid: errors.length === 0, errors };
  }

  resolveRegions(config: Record<string, string>): VpnProxyRegion[] {
    const host = config.host?.trim();
    const port = Number(config.port);
    const protocol = config.protocol?.trim();
    if (
      !host ||
      !Number.isInteger(port) ||
      (protocol !== 'socks5' && protocol !== 'http-connect')
    ) {
      return [];
    }
    return [
      {
        id: 'custom',
        label: config.label?.trim() || 'Custom proxy',
        host,
        port,
        protocol: protocol as VpnProxyProtocol,
      },
    ];
  }

  resolveProxyAuth(config: Record<string, string>): VpnProxyAuth {
    return {
      username: config.username?.trim() || '',
      password: config.password || '',
    };
  }

  // Unlike the consumer-VPN adapters (fixed catalog, key-only), the custom proxy points
  // at an arbitrary user-supplied host/port. A cheap TCP connect at save time catches a
  // typo now instead of surfacing it as a publish-time posting error.
  async healthCheck(config: Record<string, string> = {}): Promise<{ ok: boolean; error?: string }> {
    const host = config.host?.trim();
    const port = Number(config.port);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'A valid proxy host and port are required.' };
    }

    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      const done = (result: { ok: boolean; error?: string }) => {
        clearTimeout(timer);
        socket.destroy();
        resolve(result);
      };
      const timer = setTimeout(
        () => done({ ok: false, error: `Could not reach proxy at ${host}:${port} (timed out).` }),
        5000
      );
      socket.once('connect', () => done({ ok: true }));
      socket.once('error', (err: Error) =>
        done({ ok: false, error: `Could not reach proxy at ${host}:${port}: ${err.message}` })
      );
    });
  }
}

const _meta: VpnCapability = new CustomProxyAdapter();

export const customproxyVpnModule: ProviderModule<any, any> = {
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
  create: () => new CustomProxyAdapter(),
};
