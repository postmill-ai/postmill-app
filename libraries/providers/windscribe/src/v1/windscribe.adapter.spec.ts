import { describe, it, expect, beforeEach } from 'vitest';
import { WindscribeAdapter } from './vpn.adapter';

describe('WindscribeAdapter', () => {
  let adapter: WindscribeAdapter;

  beforeEach(() => {
    adapter = new WindscribeAdapter();
  });

  it('has identifier and name', () => {
    expect(adapter.identifier).toBe('windscribe');
    expect(adapter.name).toBe('Windscribe');
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
