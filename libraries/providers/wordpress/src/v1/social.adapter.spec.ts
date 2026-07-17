import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setSocialFetchPorts } from '@gitroom/provider-kernel';
import { WordpressProvider } from './social.adapter';

const encodeCallback = (payload: Record<string, string>) =>
  Buffer.from(JSON.stringify(payload)).toString('base64');

beforeEach(() => {
  setSocialFetchPorts({
    safeFetch: vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
      text: async () => '{}',
    })) as any,
    isSafePublicHttpsUrl: async () => true,
    getVpnDispatcher: () => undefined,
    ssrfSafeDispatcher: {},
    undiciFetch: vi.fn(),
    RefreshTokenError: Error,
    BadBodyError: Error,
    timer: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    sharp: vi.fn(),
    readOrFetch: vi.fn(),
  } as any);
});

describe('WordpressProvider.authenticate (S-10)', () => {
  it('accepts a valid HTTPS domain callback', async () => {
    const provider = new WordpressProvider();
    setSocialFetchPorts({
      safeFetch: vi.fn(async (url: string) => {
        expect(url).toBe('https://example.com/wp-json/wp/v2/users/me');
        return {
          ok: true,
          json: async () => ({
            id: 1,
            name: 'Admin',
            avatar_urls: { 96: 'https://example.com/avatar.png' },
          }),
        } as any;
      }),
      isSafePublicHttpsUrl: async () => true,
      getVpnDispatcher: () => undefined,
      ssrfSafeDispatcher: {},
      undiciFetch: vi.fn(),
      RefreshTokenError: Error,
      BadBodyError: Error,
      timer: (ms: number) => new Promise((r) => setTimeout(r, ms)),
      sharp: vi.fn(),
      readOrFetch: vi.fn(),
    } as any);

    const result = await provider.authenticate({
      code: encodeCallback({
        domain: 'https://example.com',
        username: 'admin',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });

    if (typeof result === 'string') {
      throw new Error(`Expected object, got: ${result}`);
    }
    expect(result.name).toBe('Admin');
    expect(result.username).toBe('admin');
  });

  it('rejects http: domains', async () => {
    const provider = new WordpressProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        domain: 'http://example.com',
        username: 'admin',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects localhost', async () => {
    const provider = new WordpressProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        domain: 'https://localhost',
        username: 'admin',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects literal IP addresses', async () => {
    const provider = new WordpressProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        domain: 'https://192.168.1.1',
        username: 'admin',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects malformed base64/JSON', async () => {
    const provider = new WordpressProvider();
    const result = await provider.authenticate({
      code: 'not-base64!!!',
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects missing required fields', async () => {
    const provider = new WordpressProvider();
    const result = await provider.authenticate({
      code: encodeCallback({ domain: 'https://example.com' } as any),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });
});
