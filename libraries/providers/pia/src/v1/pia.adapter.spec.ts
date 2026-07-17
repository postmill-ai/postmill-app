import { describe, it, expect, beforeEach } from 'vitest';
import { PiaAdapter } from './vpn.adapter';

describe('PiaAdapter', () => {
  let adapter: PiaAdapter;

  beforeEach(() => {
    adapter = new PiaAdapter();
  });

  it('has identifier and name', () => {
    expect(adapter.identifier).toBe('pia');
    expect(adapter.name).toBe('Private Internet Access');
  });

  it('validates username:password credentials', () => {
    expect(adapter.validateConfig({}).valid).toBe(false);
    expect(adapter.validateConfig({ serviceCredentials: 'user' }).valid).toBe(false);
    expect(adapter.validateConfig({ serviceCredentials: 'user:pass' }).valid).toBe(true);
  });

  it('healthCheck returns ok', async () => {
    const result = await adapter.healthCheck!({ serviceCredentials: 'user:pass' });
    expect(result.ok).toBe(true);
  });
});
