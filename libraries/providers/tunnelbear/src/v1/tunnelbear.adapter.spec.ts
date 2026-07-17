import { describe, it, expect, beforeEach } from 'vitest';
import { TunnelbearAdapter } from './vpn.adapter';

describe('TunnelbearAdapter', () => {
  let adapter: TunnelbearAdapter;

  beforeEach(() => {
    adapter = new TunnelbearAdapter();
  });

  it('has identifier and name', () => {
    expect(adapter.identifier).toBe('tunnelbear');
    expect(adapter.name).toBe('TunnelBear');
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
