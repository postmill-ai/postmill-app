import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setSocialFetchPorts } from '@gitroom/provider-kernel';
import { PeerTubeProvider } from './social.adapter';

const encodeCallback = (payload: Record<string, string>) =>
  Buffer.from(JSON.stringify(payload)).toString('base64');

beforeEach(() => {
  setSocialFetchPorts({
    safeFetch: vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
      blob: async () => new Blob([]),
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

describe('PeerTubeProvider.authenticate (S-13)', () => {
  it('accepts a valid HTTPS instance callback', async () => {
    const provider = new PeerTubeProvider();
    (provider as any).fetch = vi.fn(async (url: string) => {
      if (url.includes('/oauth-clients/local')) {
        return { json: async () => ({ client_id: 'c', client_secret: 's' }) } as any;
      }
      if (url.includes('/users/token')) {
        return { json: async () => ({ access_token: 'tok' }) } as any;
      }
      return {
        json: async () => ({
          id: 1,
          username: 'user',
          account: { displayName: 'User', avatar: { path: '/avatar.png' } },
        }),
      } as any;
    });

    const result = await provider.authenticate({
      code: encodeCallback({
        instance: 'https://peertube.example.com',
        username: 'user',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });

    if (typeof result === 'string') {
      throw new Error(`Expected object, got: ${result}`);
    }
    expect(result.username).toBe('user');
    expect(result.name).toBe('User');
  });

  it('rejects http: instances', async () => {
    const provider = new PeerTubeProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        instance: 'http://peertube.example.com',
        username: 'user',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid PeerTube credentials');
  });

  it('rejects localhost', async () => {
    const provider = new PeerTubeProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        instance: 'https://localhost',
        username: 'user',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid PeerTube credentials');
  });

  it('rejects literal IP addresses', async () => {
    const provider = new PeerTubeProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        instance: 'https://192.168.1.1',
        username: 'user',
        password: 'secret',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid PeerTube credentials');
  });

  it('rejects malformed base64/JSON', async () => {
    const provider = new PeerTubeProvider();
    const result = await provider.authenticate({
      code: 'not-base64!!!',
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid PeerTube credentials');
  });

  it('rejects missing required fields', async () => {
    const provider = new PeerTubeProvider();
    const result = await provider.authenticate({
      code: encodeCallback({ instance: 'https://peertube.example.com' } as any),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid PeerTube credentials');
  });
});
