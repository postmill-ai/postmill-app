import { describe, it } from 'vitest';
import { runDomainConformance } from '@gitroom/provider-kernel';
import defaultModules from '../..';

describe('nordvpn provider conformance', () => {
  it('vpn module conforms', () => {
    const vpn = defaultModules.find((m) => m.manifest.domain === 'vpn');
    expect(vpn).toBeDefined();
    runDomainConformance('vpn', vpn!, {
      requiredMethods: ['validateConfig', 'resolveProxyAuth', 'healthCheck'],
      capabilityKeys: ['wireguard', 'openvpn', 'socks5'],
    });
  });
});
