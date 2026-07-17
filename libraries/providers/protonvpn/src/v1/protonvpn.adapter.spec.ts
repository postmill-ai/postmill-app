import { describe, it, expect, beforeEach } from 'vitest';
import { ProtonvpnAdapter } from './vpn.adapter';

describe('ProtonvpnAdapter', () => {
  let adapter: ProtonvpnAdapter;

  beforeEach(() => {
    adapter = new ProtonvpnAdapter();
  });

  it('has identifier and name', () => {
    expect(adapter.identifier).toBe('protonvpn');
    expect(adapter.name).toBe('Proton VPN');
  });

  it('requires OpenVPN credentials in username:password format', () => {
    expect(adapter.validateConfig({}).valid).toBe(false);
    expect(adapter.validateConfig({ openvpnCredentials: 'user' }).valid).toBe(false);
    expect(adapter.validateConfig({ openvpnCredentials: 'user:pass' }).valid).toBe(true);
  });

  it('rejects non-HTTPS config URLs', () => {
    expect(
      adapter.validateConfig({
        openvpnCredentials: 'user:pass',
        configUrl: 'http://example.com/config',
      }).valid,
    ).toBe(false);
  });

  it('healthCheck returns ok', async () => {
    const result = await adapter.healthCheck!({ openvpnCredentials: 'user:pass' });
    expect(result.ok).toBe(true);
  });
});
