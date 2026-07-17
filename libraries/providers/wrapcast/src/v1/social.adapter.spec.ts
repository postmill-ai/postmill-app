import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setSocialFetchPorts } from '@gitroom/provider-kernel';
import { FarcasterProvider } from './social.adapter';

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

describe('FarcasterProvider.authenticate (S-19)', () => {
  it('accepts a valid callback payload', async () => {
    const provider = new FarcasterProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        fid: 123,
        display_name: 'Caster',
        signer_uuid: 'signer-1',
        username: 'caster',
        pfp_url: 'https://example.com/pfp.png',
      }),
      codeVerifier: 'x',
    });

    if (typeof result === 'string') {
      throw new Error(`Expected object, got: ${result}`);
    }
    expect(result.id).toBe('123');
    expect(result.username).toBe('caster');
    expect(result.accessToken).toBe('signer-1');
  });

  it('rejects malformed base64/JSON', async () => {
    const provider = new FarcasterProvider();
    const result = await provider.authenticate({
      code: 'not-base64!!!',
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects missing fid', async () => {
    const provider = new FarcasterProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        display_name: 'Caster',
        signer_uuid: 'signer-1',
        username: 'caster',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects missing signer_uuid', async () => {
    const provider = new FarcasterProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        fid: 123,
        display_name: 'Caster',
        username: 'caster',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects missing username', async () => {
    const provider = new FarcasterProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        fid: 123,
        display_name: 'Caster',
        signer_uuid: 'signer-1',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });
});
