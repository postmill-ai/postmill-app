import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setSocialFetchPorts } from '@gitroom/provider-kernel';
import { MediumProvider } from './social.adapter';

const encodeCallback = (payload: Record<string, unknown>) =>
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

describe('MediumProvider.authenticate (S-19)', () => {
  it('accepts a valid apiKey callback', async () => {
    const provider = new MediumProvider();
    (provider as any).fetch = vi.fn(async () => ({
      json: async () => ({
        data: {
          name: 'Medium User',
          id: 'mid',
          imageUrl: 'https://medium.com/avatar.png',
          username: 'mediumuser',
        },
      }),
    })) as any;

    const result = await provider.authenticate({
      code: encodeCallback({ apiKey: 'my-token' }),
      codeVerifier: 'x',
    });

    if (typeof result === 'string') {
      throw new Error(`Expected object, got: ${result}`);
    }
    expect(result.username).toBe('mediumuser');
    expect(result.accessToken).toBe('my-token');
  });

  it('rejects malformed base64/JSON', async () => {
    const provider = new MediumProvider();
    const result = await provider.authenticate({
      code: 'not-base64!!!',
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects missing apiKey', async () => {
    const provider = new MediumProvider();
    const result = await provider.authenticate({
      code: encodeCallback({ foo: 'bar' }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects non-string apiKey', async () => {
    const provider = new MediumProvider();
    const result = await provider.authenticate({
      code: encodeCallback({ apiKey: 123 }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });
});
