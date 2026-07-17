import { describe, it, expect, beforeEach } from 'vitest';
import { IpvanishAdapter } from './vpn.adapter';

describe('IpvanishAdapter', () => {
  let adapter: IpvanishAdapter;

  beforeEach(() => {
    adapter = new IpvanishAdapter();
  });

  it('has identifier and name', () => {
    expect(adapter.identifier).toBe('ipvanish');
    expect(adapter.name).toBe('IPVanish');
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
