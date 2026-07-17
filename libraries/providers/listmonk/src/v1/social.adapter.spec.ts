import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setSocialFetchPorts } from '@gitroom/provider-kernel';
import { ListmonkProvider } from './social.adapter';

const encodeCallback = (payload: Record<string, string>) =>
  Buffer.from(JSON.stringify(payload)).toString('base64');

beforeEach(() => {
  setSocialFetchPorts({
    safeFetch: vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
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

describe('ListmonkProvider.authenticate (S-12)', () => {
  it('accepts a valid HTTPS URL callback', async () => {
    const provider = new ListmonkProvider();
    setSocialFetchPorts({
      safeFetch: vi.fn(async (url: string) => {
        expect(url).toBe('https://listmonk.example.com/api/settings');
        return {
          ok: true,
          json: async () => ({
            data: {
              'app.site_name': 'Newsletter',
              'app.logo_url': 'https://listmonk.example.com/logo.png',
            },
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
        url: 'https://listmonk.example.com',
        username: 'admin',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });

    if (typeof result === 'string') {
      throw new Error(`Expected object, got: ${result}`);
    }
    expect(result.name).toBe('Newsletter');
    expect(result.username).toBe('Newsletter');
  });

  it('rejects http: URLs', async () => {
    const provider = new ListmonkProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        url: 'http://listmonk.example.com',
        username: 'admin',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects localhost', async () => {
    const provider = new ListmonkProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        url: 'https://localhost',
        username: 'admin',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects literal IP addresses', async () => {
    const provider = new ListmonkProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        url: 'https://192.168.1.1',
        username: 'admin',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects malformed base64/JSON', async () => {
    const provider = new ListmonkProvider();
    const result = await provider.authenticate({
      code: 'not-base64!!!',
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects missing required fields', async () => {
    const provider = new ListmonkProvider();
    const result = await provider.authenticate({
      code: encodeCallback({ url: 'https://listmonk.example.com' } as any),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });
});
