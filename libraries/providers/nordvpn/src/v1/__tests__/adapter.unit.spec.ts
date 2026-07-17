import { describe, it, expect, beforeEach } from 'vitest';
import { NordvpnAdapter } from '../vpn.adapter';

describe('NordvpnAdapter', () => {
  let adapter: NordvpnAdapter;

  beforeEach(() => {
    adapter = new NordvpnAdapter();
  });

  it('has identifier and name', () => {
    expect(adapter.identifier).toBe('nordvpn');
    expect(adapter.name).toBe('NordVPN');
  });

  it('requires service credentials in username:password format', () => {
    expect(adapter.validateConfig({}).valid).toBe(false);
    expect(adapter.validateConfig({ serviceCredentials: 'user' }).valid).toBe(false);
    expect(adapter.validateConfig({ serviceCredentials: 'user:pass' }).valid).toBe(true);
  });

  it('rejects non-HTTPS config URLs', () => {
    expect(
      adapter.validateConfig({
        serviceCredentials: 'user:pass',
        configUrl: 'ftp://example.com/config.ovpn',
      }).valid,
    ).toBe(false);
  });

  it('healthCheck returns ok', async () => {
    const result = await adapter.healthCheck!({ serviceCredentials: 'user:pass' });
    expect(result.ok).toBe(true);
  });
});
