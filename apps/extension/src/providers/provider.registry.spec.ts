import { describe, expect, it } from 'vitest';
import { getAllProviders, getProvider, providers } from './provider.registry';

describe('provider registry', () => {
  it('exposes at least one cookie provider', () => {
    expect(providers.length).toBeGreaterThan(0);
    expect(getAllProviders()).toEqual(providers);
  });

  it('looks up providers by identifier', () => {
    const first = providers[0];
    expect(getProvider(first.identifier)).toBe(first);
    expect(getProvider('non-existent')).toBeUndefined();
  });

  it('provider entries have required metadata', () => {
    for (const provider of providers) {
      expect(provider.identifier).toBeTruthy();
      expect(provider.name).toBeTruthy();
      expect(provider.url).toMatch(/^https?:\/\//);
      expect(provider.hostPermission).toBeTruthy();
      expect(provider.cookies.length).toBeGreaterThan(0);
    }
  });
});
