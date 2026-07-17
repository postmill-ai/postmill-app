import { describe, it, expect, beforeEach } from 'vitest';
import { HidemeAdapter } from './vpn.adapter';

describe('HidemeAdapter', () => {
  let adapter: HidemeAdapter;

  beforeEach(() => {
    adapter = new HidemeAdapter();
  });

  it('has identifier and name', () => {
    expect(adapter.identifier).toBe('hideme');
    expect(adapter.name).toBe('hide.me');
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
