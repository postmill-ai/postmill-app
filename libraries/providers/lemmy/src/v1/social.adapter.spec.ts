import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setSocialFetchPorts } from '@gitroom/provider-kernel';
import { LemmyProvider } from './social.adapter';

const encodeCallback = (payload: Record<string, string>) =>
  Buffer.from(JSON.stringify(payload)).toString('base64');

beforeEach(() => {
  setSocialFetchPorts({
    safeFetch: vi.fn(async () => ({
      ok: true,
      status: 200,
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

describe('LemmyProvider.authenticate (S-11)', () => {
  it('accepts a valid HTTPS service callback', async () => {
    const provider = new LemmyProvider();
    setSocialFetchPorts({
      safeFetch: vi.fn(async (url: string) => {
        if (url.includes('/api/v3/user/login')) {
          return { ok: true, status: 200, json: async () => ({ jwt: 'token' }) } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            person_view: {
              person: { id: 1, name: 'user', display_name: 'User', avatar: '' },
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
        service: 'https://lemmy.world',
        identifier: 'user',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });

    if (typeof result === 'string') {
      throw new Error(`Expected object, got: ${result}`);
    }
    expect(result.username).toBe('user');
  });

  it('rejects http: services', async () => {
    const provider = new LemmyProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        service: 'http://lemmy.world',
        identifier: 'user',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects localhost', async () => {
    const provider = new LemmyProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        service: 'https://localhost',
        identifier: 'user',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects literal IP addresses', async () => {
    const provider = new LemmyProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        service: 'https://10.0.0.1',
        identifier: 'user',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects malformed base64/JSON', async () => {
    const provider = new LemmyProvider();
    const result = await provider.authenticate({
      code: 'not-base64!!!',
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects missing required fields', async () => {
    const provider = new LemmyProvider();
    const result = await provider.authenticate({
      code: encodeCallback({ service: 'https://lemmy.world' } as any),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });
});
