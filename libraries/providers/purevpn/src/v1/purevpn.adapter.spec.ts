import { describe, it, expect, beforeEach } from 'vitest';
import { PurevpnAdapter } from './vpn.adapter';

describe('PurevpnAdapter', () => {
  let adapter: PurevpnAdapter;

  beforeEach(() => {
    adapter = new PurevpnAdapter();
  });

  it('has identifier and name', () => {
    expect(adapter.identifier).toBe('purevpn');
    expect(adapter.name).toBe('PureVPN');
  });

  it('validates username:password credentials', () => {
    expect(adapter.validateConfig({}).valid).toBe(false);
    expect(adapter.validateConfig({ serviceCredentials: 'user:pass' }).valid).toBe(true);
  });

  it('healthCheck returns ok', async () => {
    const result = await adapter.healthCheck!({ serviceCredentials: 'user:pass' });
    expect(result.ok).toBe(true);
  });
});
