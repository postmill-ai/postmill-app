import { describe, it, expect, beforeEach } from 'vitest';
import { HotspotshieldAdapter } from './vpn.adapter';

describe('HotspotshieldAdapter', () => {
  let adapter: HotspotshieldAdapter;

  beforeEach(() => {
    adapter = new HotspotshieldAdapter();
  });

  it('has identifier and name', () => {
    expect(adapter.identifier).toBe('hotspotshield');
    expect(adapter.name).toBe('Hotspot Shield');
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
