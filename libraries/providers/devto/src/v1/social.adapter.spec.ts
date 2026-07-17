import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setSocialFetchPorts } from '@gitroom/provider-kernel';
import { DevToProvider } from './social.adapter';

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

describe('DevToProvider.authenticate (S-19)', () => {
  it('accepts a valid apiKey callback', async () => {
    const provider = new DevToProvider();
    (provider as any).fetch = vi.fn(async () => ({
      json: async () => ({
        name: 'Dev User',
        id: 1,
        profile_image: 'https://dev.to/avatar.png',
        username: 'devuser',
      }),
    })) as any;

    const result = await provider.authenticate({
      code: encodeCallback({ apiKey: 'my-api-key' }),
      codeVerifier: 'x',
    });

    if (typeof result === 'string') {
      throw new Error(`Expected object, got: ${result}`);
    }
    expect(result.username).toBe('devuser');
    expect(result.accessToken).toBe('my-api-key');
  });

  it('rejects malformed base64/JSON', async () => {
    const provider = new DevToProvider();
    const result = await provider.authenticate({
      code: 'not-base64!!!',
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects missing apiKey', async () => {
    const provider = new DevToProvider();
    const result = await provider.authenticate({
      code: encodeCallback({ foo: 'bar' }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects non-string apiKey', async () => {
    const provider = new DevToProvider();
    const result = await provider.authenticate({
      code: encodeCallback({ apiKey: 123 }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });
});
