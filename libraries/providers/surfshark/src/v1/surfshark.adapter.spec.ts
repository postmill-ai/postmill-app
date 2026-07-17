import { describe, it, expect, beforeEach } from 'vitest';
import { SurfsharkAdapter } from './vpn.adapter';

describe('SurfsharkAdapter', () => {
  let adapter: SurfsharkAdapter;

  beforeEach(() => {
    adapter = new SurfsharkAdapter();
  });

  it('has identifier and name', () => {
    expect(adapter.identifier).toBe('surfshark');
    expect(adapter.name).toBe('Surfshark');
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
        configUrl: 'http://insecure.example.com/config',
      }).valid,
    ).toBe(false);
  });

  it('healthCheck returns ok', async () => {
    const result = await adapter.healthCheck!({ serviceCredentials: 'user:pass' });
    expect(result.ok).toBe(true);
  });
});
