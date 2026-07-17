import { describe, it, expect, beforeEach } from 'vitest';
import { VyprvpnAdapter } from './vpn.adapter';

describe('VyprvpnAdapter', () => {
  let adapter: VyprvpnAdapter;

  beforeEach(() => {
    adapter = new VyprvpnAdapter();
  });

  it('has identifier and name', () => {
    expect(adapter.identifier).toBe('vyprvpn');
    expect(adapter.name).toBe('VyprVPN');
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
