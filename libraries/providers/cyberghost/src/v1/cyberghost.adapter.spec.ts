import { describe, it, expect, beforeEach } from 'vitest';
import { CyberghostAdapter } from './vpn.adapter';

describe('CyberghostAdapter', () => {
  let adapter: CyberghostAdapter;

  beforeEach(() => {
    adapter = new CyberghostAdapter();
  });

  it('has identifier and name', () => {
    expect(adapter.identifier).toBe('cyberghost');
    expect(adapter.name).toBe('CyberGhost');
  });

  it('validates username:password credentials', () => {
    expect(adapter.validateConfig({}).valid).toBe(false);
    expect(adapter.validateConfig({ serviceCredentials: 'user' }).valid).toBe(false);
    expect(adapter.validateConfig({ serviceCredentials: 'user:pass' }).valid).toBe(true);
  });

  it('rejects non-HTTPS config URLs', () => {
    expect(
      adapter.validateConfig({
        serviceCredentials: 'user:pass',
        configUrl: 'http://example.com/config',
      }).valid,
    ).toBe(false);
  });

  it('healthCheck returns ok', async () => {
    const result = await adapter.healthCheck!({ serviceCredentials: 'user:pass' });
    expect(result.ok).toBe(true);
  });
});
