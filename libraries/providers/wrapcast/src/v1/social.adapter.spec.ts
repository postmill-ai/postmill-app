import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setSocialFetchPorts } from '@postmill-ai/provider-kernel';
import { FarcasterProvider } from './social.adapter';

const getOrgCredentialMock = vi.fn(() => 'neynar-api-key-123');
vi.mock('@postmill-ai/provider-kernel', async (importActual) => ({
  ...(await importActual<typeof import('@postmill-ai/provider-kernel')>()),
  getOrgCredential: (...args: unknown[]) => getOrgCredentialMock(...args),
}));

const searchChannelsMock = vi.fn(async () => ({
  channels: [{ name: 'postmill', id: 'postmill' }],
}));
const neynarConstructorSpy = vi.fn();
vi.mock('@neynar/nodejs-sdk', () => ({
  NeynarAPIClient: class {
    constructor(config: { apiKey: string }) {
      neynarConstructorSpy(config);
    }
    searchChannels = searchChannelsMock;
  },
}));

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

describe('FarcasterProvider.subreddits (channel search)', () => {
  it('authenticates with the Neynar API key from org credentials, not the org id', async () => {
    const provider = new FarcasterProvider();
    const result = await provider.subreddits(
      'signer-uuid',
      { word: 'post' },
      'internal-1',
      { organizationId: 'org-uuid-9' } as any
    );

    // The integration token is the user's signer UUID and the org id is a
    // UUID — neither is the Neynar key. The key comes from the org credential
    // cache (gap-filled from NEYNAR_SECRET_KEY for the env platform app).
    expect(getOrgCredentialMock).toHaveBeenCalledWith(
      'org-uuid-9',
      'wrapcast',
      'clientSecret'
    );
    expect(neynarConstructorSpy).toHaveBeenCalledWith({
      apiKey: 'neynar-api-key-123',
    });
    expect(searchChannelsMock).toHaveBeenCalledWith({ q: 'post', limit: 10 });
    expect(result).toEqual([{ title: 'postmill', name: 'postmill', id: 'postmill' }]);
  });
});
