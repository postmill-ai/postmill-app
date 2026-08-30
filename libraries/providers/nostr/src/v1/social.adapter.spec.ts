import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setSocialFetchPorts } from '@postmill-ai/provider-kernel';
import { NostrProvider } from './social.adapter';

const encodeCallback = (payload: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(payload)).toString('base64');

vi.mock('@postmill-ai/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedEncryption: (value: string) => `encrypted:${value}`,
    fixedDecryption: (value: string) =>
      value.startsWith('encrypted:') ? value.slice('encrypted:'.length) : value,
  },
}));

vi.mock('nostr-tools', async () => {
  const actual: any = await vi.importActual('nostr-tools');
  return {
    ...actual,
    getPublicKey: (privateKey: Uint8Array) => 'pubkey-' + Buffer.from(privateKey).toString('hex'),
    SimplePool: class {
      async get() {
        return {
          content: JSON.stringify({ name: 'Nostr User', displayName: 'Nostr User' }),
        };
      }
    },
  };
});

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

describe('NostrProvider.authenticate (S-19)', () => {
  it('accepts a valid hex private key callback and stores the key v2:-encrypted (no JWT wrapping)', async () => {
    const provider = new NostrProvider();
    const hexKey = 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233';
    const result = await provider.authenticate({
      code: encodeCallback({ password: hexKey }),
      codeVerifier: 'x',
    });

    if (typeof result === 'string') {
      throw new Error(`Expected object, got: ${result}`);
    }
    expect(result.name).toBe('Nostr User');
    expect(result.accessToken).toBe(`encrypted:${hexKey}`);
  });

  it('rejects malformed base64/JSON', async () => {
    const provider = new NostrProvider();
    const result = await provider.authenticate({
      code: 'not-base64!!!',
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects missing password', async () => {
    const provider = new NostrProvider();
    const result = await provider.authenticate({
      code: encodeCallback({ foo: 'bar' }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects non-string password', async () => {
    const provider = new NostrProvider();
    const result = await provider.authenticate({
      code: encodeCallback({ password: 123 }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });
});
