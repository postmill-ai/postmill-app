import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the SSRF validator to allow everything (we test header handling, not SSRF).
vi.mock('./webhook.url.validator', () => ({
  isSafePublicHttpsUrl: vi.fn(async () => true),
}));
vi.mock('./ssrf.safe.dispatcher', () => ({ ssrfSafeDispatcher: {} }));

// Capture the init passed to each undici.fetch call.
const fetchCalls: Array<{ url: string; init: any }> = [];
vi.mock('undici', () => ({
  fetch: vi.fn(async (url: string, init: any) => {
    fetchCalls.push({ url, init });
    // First hop: 302 redirect to whatever the test seeded on the mock.
    const next = (globalThis as any).__redirectTo;
    if (fetchCalls.length === 1 && next) {
      return {
        status: 302,
        headers: new Map([['location', next]]) as any,
      };
    }
    return { status: 200, ok: true, headers: new Map() as any };
  }),
}));

import { safeFetch } from './safe.fetch';

function headerHas(init: any, name: string): boolean {
  const h = init?.headers || {};
  return Object.keys(h).some((k) => k.toLowerCase() === name.toLowerCase());
}

describe('safeFetch cross-origin redirect header stripping (1.4)', () => {
  beforeEach(() => {
    fetchCalls.length = 0;
  });

  it('strips x-api-key when the redirect leaves the original origin', async () => {
    (globalThis as any).__redirectTo = 'https://cdn.other.example/artifact';
    await safeFetch('https://api.provider.example/status', {
      headers: { 'x-api-key': 'secret', accept: 'application/json' },
    });
    expect(fetchCalls.length).toBe(2);
    // hop 1 keeps the key; hop 2 (different origin) drops it but keeps accept.
    expect(headerHas(fetchCalls[0].init, 'x-api-key')).toBe(true);
    expect(headerHas(fetchCalls[1].init, 'x-api-key')).toBe(false);
    expect(headerHas(fetchCalls[1].init, 'accept')).toBe(true);
  });

  it('preserves credential headers on a same-origin redirect', async () => {
    (globalThis as any).__redirectTo =
      'https://api.provider.example/status/final';
    await safeFetch('https://api.provider.example/status', {
      headers: { authorization: 'Bearer t' },
    });
    expect(fetchCalls.length).toBe(2);
    expect(headerHas(fetchCalls[1].init, 'authorization')).toBe(true);
  });
});
