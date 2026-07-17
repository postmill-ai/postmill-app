import { describe, it, expect, beforeEach } from 'vitest';
import { MullvadAdapter } from './vpn.adapter';

describe('MullvadAdapter', () => {
  let adapter: MullvadAdapter;

  beforeEach(() => {
    adapter = new MullvadAdapter();
  });

  it('has identifier and name', () => {
    expect(adapter.identifier).toBe('mullvad');
    expect(adapter.name).toBe('Mullvad VPN');
  });

  it('requires a 16-digit account number', () => {
    expect(adapter.validateConfig({}).valid).toBe(false);
    expect(adapter.validateConfig({ accountNumber: '12345' }).valid).toBe(false);
    expect(adapter.validateConfig({ accountNumber: '1234567890123456' }).valid).toBe(true);
    expect(adapter.validateConfig({ accountNumber: '1234 5678 9012 3456' }).valid).toBe(true);
  });

  it('rejects non-HTTPS config URLs', () => {
    expect(
      adapter.validateConfig({
        accountNumber: '1234567890123456',
        configUrl: 'http://example.com/config',
      }).valid,
    ).toBe(false);
  });

  it('healthCheck returns ok', async () => {
    const result = await adapter.healthCheck!({ accountNumber: '1234567890123456' });
    expect(result.ok).toBe(true);
  });
});
