import { describe, it, expect, vi } from 'vitest';
import { SkoolProvider } from './social.adapter';

vi.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedEncryption: vi.fn((value: string) => `encrypted:${value}`),
    fixedDecryption: vi.fn((value: string) =>
      value.startsWith('encrypted:') ? value.slice('encrypted:'.length) : value
    ),
    verifyJWT: vi.fn(),
  },
}));

const mockResponse = (body: any) =>
  ({
    json: async () => body,
  } as any);

const encodeCookies = (cookies: Record<string, string>) =>
  Buffer.from(JSON.stringify(cookies)).toString('base64');

describe('SkoolProvider.authenticate (S-19)', () => {
  it('rejects malformed base64/JSON', async () => {
    const provider = new SkoolProvider();
    const result = await provider.authenticate({
      code: 'not-base64!!!',
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid cookie data');
  });

  it('rejects missing client_id', async () => {
    const provider = new SkoolProvider();
    const result = await provider.authenticate({
      code: encodeCookies({ auth_token: 'tok-1' }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Missing required cookies: client_id');
  });

  it('rejects missing auth_token', async () => {
    const provider = new SkoolProvider();
    const result = await provider.authenticate({
      code: encodeCookies({ client_id: 'cid-1' }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Missing required cookies: auth_token');
  });
});

describe('SkoolProvider (S-02)', () => {
  it('routes authenticate through this.fetch()', async () => {
    const provider = new SkoolProvider();
    const fetchSpy = vi.spyOn(provider as any, 'fetch').mockResolvedValue(
      mockResponse({
        id: 'user-1',
        first_name: 'Test',
        last_name: 'User',
        name: 'testuser',
        metadata: { picture_profile: 'https://example.com/avatar.png' },
      })
    );

    const cookies = { client_id: 'cid-1', auth_token: 'tok-1' };
    const result = await provider.authenticate({
      code: encodeCookies(cookies),
      codeVerifier: 'verifier',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api2.skool.com/self',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Cookie: 'auth_token=tok-1; client_id=cid-1',
        },
      })
    );
    expect(result).toMatchObject({
      id: 'user-1',
      name: 'Test User',
      username: 'testuser',
      picture: 'https://example.com/avatar.png',
    });
  });

  it('routes groups through this.fetch()', async () => {
    const provider = new SkoolProvider();
    const fetchSpy = vi.spyOn(provider as any, 'fetch').mockResolvedValue(
      mockResponse({
        groups: [
          { id: 'g1', metadata: { display_name: 'Group One' } },
          { id: 'g2', metadata: { display_name: 'Group Two' } },
        ],
      })
    );

    const cookies = JSON.stringify({
      client_id: 'cid-1',
      auth_token: 'tok-1',
    });
    const integration = {
      id: 'int-1',
      organizationId: 'org-1',
      customInstanceDetails: `encrypted:${cookies}`,
    } as any;

    const result = await provider.groups('access-token', {}, 'user-1', integration);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api2.skool.com/users/user-1/groups?offset=0&limit=30',
      expect.objectContaining({
        headers: {
          Cookie: 'auth_token=tok-1; client_id=cid-1',
        },
      })
    );
    expect(result).toEqual([
      { id: 'g1', name: 'Group One' },
      { id: 'g2', name: 'Group Two' },
    ]);
  });

  it('returns an empty array when groups fetch fails', async () => {
    const provider = new SkoolProvider();
    vi.spyOn(provider as any, 'fetch').mockRejectedValue(new Error('network'));

    const cookies = JSON.stringify({
      client_id: 'cid-1',
      auth_token: 'tok-1',
    });
    const integration = {
      id: 'int-1',
      organizationId: 'org-1',
      customInstanceDetails: `encrypted:${cookies}`,
    } as any;

    const result = await provider.groups('access-token', {}, 'user-1', integration);

    expect(result).toEqual([]);
  });
});
