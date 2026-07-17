import { describe, it, expect, beforeEach } from 'vitest';
import { MozillavpnAdapter } from './vpn.adapter';

describe('MozillavpnAdapter', () => {
  let adapter: MozillavpnAdapter;

  beforeEach(() => {
    adapter = new MozillavpnAdapter();
  });

  it('has identifier and name', () => {
    expect(adapter.identifier).toBe('mozillavpn');
    expect(adapter.name).toBe('Mozilla VPN');
  });

  it('requires a subscription key', () => {
    expect(adapter.validateConfig({}).valid).toBe(false);
    expect(adapter.validateConfig({ subscriptionKey: '  ' }).valid).toBe(false);
    expect(adapter.validateConfig({ subscriptionKey: 'abc-123' }).valid).toBe(true);
  });

  it('healthCheck returns ok', async () => {
    const result = await adapter.healthCheck!({ subscriptionKey: 'abc-123' });
    expect(result.ok).toBe(true);
  });
});
