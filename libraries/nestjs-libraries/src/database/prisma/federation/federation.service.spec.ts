import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { verify } from 'jsonwebtoken';
import {
  FEDERATION_AUDIENCE,
  FederationService,
} from './federation.service';

const sha256Lookup = (value: string) =>
  `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

const s256Challenge = (verifier: string) =>
  crypto.createHash('sha256').update(verifier).digest('base64url').replace(/=+$/, '');

const REDIRECT_URI = 'https://store.example.com/cb';
const ISSUER = 'https://instance.example.com';

const makeGrant = (overrides: Record<string, unknown> = {}) => ({
  id: 'grant-1',
  userId: 'user-1',
  organizationId: 'org-1',
  codeExpiresAt: new Date(Date.now() + 60_000),
  redirectUri: REDIRECT_URI,
  codeChallenge: s256Challenge('verifier-1'),
  codeChallengeMethod: 'S256',
  nonce: 'nonce-1',
  scope: 'profile email org',
  organization: { id: 'org-1', name: 'Acme' },
  user: {
    id: 'user-1',
    email: 'jane@acme.com',
    activated: true,
    organizations: [{ organizationId: 'org-1', roleRef: { key: 'owner' } }],
    profile: {
      name: 'Jane',
      lastName: 'Doe',
      avatarUrl: 'https://img.example.com/avatar.png',
      picture: null,
    },
  },
  ...overrides,
});

describe('FederationService (Postmill ID)', () => {
  let repository: any;
  let encryption: any;
  let service: FederationService;
  let storedPrivateKeyPem: string;

  beforeEach(() => {
    process.env.BACKEND_URL = ISSUER;
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.FEDERATION_TRUSTED_REDIRECT_URIS = REDIRECT_URI;
    storedPrivateKeyPem = '';
    repository = {
      getIdentity: vi.fn().mockResolvedValue(null),
      createIdentity: vi.fn().mockImplementation((data) => {
        storedPrivateKeyPem = data.privateKeyEnc.replace(/^enc:/, '');
        return Promise.resolve(data);
      }),
      upsertGrant: vi.fn().mockResolvedValue({}),
      findByCode: vi.fn(),
      markCodeExchanged: vi.fn().mockResolvedValue({}),
      findByAccessToken: vi.fn(),
      getGrantsForUser: vi.fn().mockResolvedValue([]),
      revoke: vi.fn().mockResolvedValue({}),
    };
    encryption = {
      encrypt: vi.fn((v: string) => `enc:${v}`),
      decrypt: vi.fn((v: string) => v.replace(/^enc:/, '')),
    };
    service = new FederationService(repository, encryption);
  });

  afterEach(() => {
    delete process.env.BACKEND_URL;
    delete process.env.FRONTEND_URL;
    delete process.env.FEDERATION_TRUSTED_REDIRECT_URIS;
    delete process.env.FEDERATION_ISSUER;
    delete process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL;
    delete process.env.NEXT_PUBLIC_BACKEND_URL;
  });

  describe('instance identity', () => {
    it('generates and stores an RS256 keypair on first use, private key encrypted', async () => {
      const jwks = await service.getJwks();

      expect(repository.createIdentity).toHaveBeenCalledOnce();
      const stored = repository.createIdentity.mock.calls[0][0];
      expect(stored.privateKeyEnc).toMatch(/^enc:/);
      expect(stored.kid).toMatch(/^[0-9a-f]{16}$/);
      expect(jwks.keys).toHaveLength(1);
      expect(jwks.keys[0]).toMatchObject({
        kty: 'RSA',
        use: 'sig',
        alg: 'RS256',
        kid: stored.kid,
      });
      // The stored PEM is a real RSA private key matching the advertised JWK.
      const keyObject = crypto.createPrivateKey(storedPrivateKeyPem);
      expect(keyObject.asymmetricKeyType).toBe('rsa');
    });

    it('reuses the stored identity on subsequent boots (decrypts, never regenerates)', async () => {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      repository.getIdentity.mockResolvedValue({
        kid: 'abc123',
        publicJwk: publicKey.export({ format: 'jwk' }),
        privateKeyEnc: `enc:${privateKey.export({ type: 'pkcs8', format: 'pem' })}`,
      });

      const jwks = await service.getJwks();

      expect(repository.createIdentity).not.toHaveBeenCalled();
      expect(encryption.decrypt).toHaveBeenCalled();
      expect(jwks.keys[0].kid).toBe('abc123');
    });

    it('adopts the winning row when a concurrent boot creates the identity first', async () => {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      const winner = {
        kid: 'winner1',
        publicJwk: publicKey.export({ format: 'jwk' }),
        privateKeyEnc: `enc:${privateKey.export({ type: 'pkcs8', format: 'pem' })}`,
      };
      repository.getIdentity
        .mockResolvedValueOnce(null) // first read: no identity yet
        .mockResolvedValueOnce(winner); // after losing the create race
      repository.createIdentity.mockRejectedValue(
        new Error('Unique constraint failed')
      );

      const jwks = await service.getJwks();

      expect(jwks.keys[0].kid).toBe('winner1');
    });

    it('rethrows a persistent createIdentity failure instead of recursing', async () => {
      repository.getIdentity.mockResolvedValue(null);
      repository.createIdentity.mockRejectedValue(new Error('db down'));

      await expect(service.getJwks()).rejects.toThrow('db down');
      // One create attempt only — no retry loop, no stack growth.
      expect(repository.createIdentity).toHaveBeenCalledTimes(1);
    });
  });

  describe('validateAuthorizeRequest', () => {
    it('accepts an allow-listed redirect_uri', () => {
      expect(service.validateAuthorizeRequest(REDIRECT_URI)).toEqual({
        redirectUri: REDIRECT_URI,
      });
    });

    it('rejects a redirect_uri outside the pinned allow-list (400)', () => {
      expect(() =>
        service.validateAuthorizeRequest('https://evil.example.com/cb')
      ).toThrowError(
        expect.objectContaining({ status: 400 })
      );
    });

    it('rejects a missing redirect_uri (400)', () => {
      expect(() => service.validateAuthorizeRequest(undefined)).toThrowError(
        expect.objectContaining({ status: 400 })
      );
    });

    // Every other test in this file sets FEDERATION_TRUSTED_REDIRECT_URIS in
    // beforeEach, so the baked-in default — the value production actually runs
    // on, since the variable is optional — was covered by nothing at all. It has
    // to agree character for character with the store's own callbackUrl().
    describe('with no FEDERATION_TRUSTED_REDIRECT_URIS set', () => {
      beforeEach(() => {
        delete process.env.FEDERATION_TRUSTED_REDIRECT_URIS;
      });

      it('falls back to the template store callback, per-provider path included', () => {
        const uri = 'https://templates.postmill.ai/auth/callback/postmill';

        expect(service.validateAuthorizeRequest(uri)).toEqual({
          redirectUri: uri,
        });
      });

      it('rejects the bare /auth/callback path — matching is exact, not prefix', () => {
        expect(() =>
          service.validateAuthorizeRequest(
            'https://templates.postmill.ai/auth/callback'
          )
        ).toThrowError(expect.objectContaining({ status: 400 }));
      });
    });
  });

  describe('createAuthorizationCode', () => {
    const pkce = {
      codeChallenge: s256Challenge('verifier-1'),
      codeChallengeMethod: 'S256',
    };

    it('rejects requests without an S256 code_challenge (400)', async () => {
      await expect(
        service.createAuthorizationCode('user-1', 'org-1', {
          redirectUri: REDIRECT_URI,
        })
      ).rejects.toMatchObject({ status: 400 });
      expect(repository.upsertGrant).not.toHaveBeenCalled();
    });

    it('rejects an untrusted redirect_uri before anything is stored (400)', async () => {
      await expect(
        service.createAuthorizationCode('user-1', 'org-1', {
          redirectUri: 'https://evil.example.com/cb',
          ...pkce,
        })
      ).rejects.toMatchObject({ status: 400 });
      expect(repository.upsertGrant).not.toHaveBeenCalled();
    });

    it('rejects a scope with no known federation scopes (400)', async () => {
      await expect(
        service.createAuthorizationCode('user-1', 'org-1', {
          redirectUri: REDIRECT_URI,
          scope: 'mcp:read mcp:posts:write',
          ...pkce,
        })
      ).rejects.toMatchObject({ status: 400 });
      expect(repository.upsertGrant).not.toHaveBeenCalled();
    });

    it('stores a hashed code with only known scopes and the nonce', async () => {
      const code = await service.createAuthorizationCode('user-1', 'org-1', {
        redirectUri: REDIRECT_URI,
        scope: 'profile email made:up',
        nonce: 'nonce-1',
        ...pkce,
      });

      expect(repository.upsertGrant).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          organizationId: 'org-1',
          authorizationCode: sha256Lookup(code),
          codeChallenge: pkce.codeChallenge,
          nonce: 'nonce-1',
          scope: 'profile email',
        })
      );
    });
  });

  describe('exchangeCode', () => {
    beforeEach(() => {
      repository.findByCode.mockResolvedValue(makeGrant());
    });

    const exchange = (verifier = 'verifier-1') =>
      service.exchangeCode('the-code', REDIRECT_URI, verifier);

    it('looks the code up by its sha256 hash only', async () => {
      await exchange();
      expect(repository.findByCode).toHaveBeenCalledWith(sha256Lookup('the-code'));
    });

    it('rejects an unknown code (400)', async () => {
      repository.findByCode.mockResolvedValue(null);
      await expect(exchange()).rejects.toMatchObject({ status: 400 });
    });

    it('rejects an expired code (400)', async () => {
      repository.findByCode.mockResolvedValue(
        makeGrant({ codeExpiresAt: new Date(Date.now() - 1000) })
      );
      await expect(exchange()).rejects.toMatchObject({ status: 400 });
    });

    it('rejects a redirect_uri mismatch (400)', async () => {
      await expect(
        service.exchangeCode('the-code', `${REDIRECT_URI}/other`, 'verifier-1')
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects a missing or wrong code_verifier (400)', async () => {
      await expect(
        service.exchangeCode('the-code', REDIRECT_URI)
      ).rejects.toMatchObject({ status: 400 });
      await expect(exchange('wrong-verifier')).rejects.toMatchObject({
        status: 400,
      });
      expect(repository.markCodeExchanged).not.toHaveBeenCalled();
    });

    it('returns a posf_ access token and a verifiable RS256 id_token with full claims', async () => {
      const result = await exchange();

      expect(result.access_token).toMatch(/^posf_/);
      expect(result.expires_in).toBe(3600);
      expect(repository.markCodeExchanged).toHaveBeenCalledWith('grant-1', {
        accessToken: sha256Lookup(result.access_token),
        tokenExpiresAt: expect.any(Date),
      });

      const publicKey = crypto.createPublicKey(storedPrivateKeyPem);
      const claims = verify(result.id_token, publicKey, {
        algorithms: ['RS256'],
        audience: FEDERATION_AUDIENCE,
        issuer: ISSUER,
      }) as Record<string, unknown>;

      expect(claims.sub).toBe('user-1');
      expect(claims.nonce).toBe('nonce-1');
      expect(claims.name).toBe('Jane Doe');
      expect(claims.picture).toBe('https://img.example.com/avatar.png');
      expect(claims.email).toBe('jane@acme.com');
      expect(claims.email_verified).toBe(true);
      expect(claims.org).toEqual({ id: 'org-1', name: 'Acme', role: 'owner' });
    });

    it('omits email and org claims when those scopes were not granted', async () => {
      repository.findByCode.mockResolvedValue(makeGrant({ scope: 'profile' }));

      const result = await exchange();
      const publicKey = crypto.createPublicKey(storedPrivateKeyPem);
      const claims = verify(result.id_token, publicKey, {
        algorithms: ['RS256'],
        audience: FEDERATION_AUDIENCE,
        issuer: ISSUER,
      }) as Record<string, unknown>;

      expect(claims.name).toBe('Jane Doe');
      expect(claims.email).toBeUndefined();
      expect(claims.org).toBeUndefined();
    });
  });

  describe('getUserInfo', () => {
    it('returns null for an unknown or expired token', async () => {
      repository.findByAccessToken.mockResolvedValue(null);
      await expect(service.getUserInfo('posf_nope')).resolves.toBeNull();
      expect(repository.findByAccessToken).toHaveBeenCalledWith(
        sha256Lookup('posf_nope')
      );
    });

    it('returns scope-gated claims for a valid token', async () => {
      repository.findByAccessToken.mockResolvedValue(
        makeGrant({ scope: 'email org' })
      );

      const claims = await service.getUserInfo('posf_valid');

      expect(claims).toEqual({
        sub: 'user-1',
        email: 'jane@acme.com',
        email_verified: true,
        org: { id: 'org-1', name: 'Acme', role: 'owner' },
      });
    });
  });

  describe('getDiscoveryDocument', () => {
    it('advertises the federation endpoints, scopes and fixed audience', async () => {
      const doc = await service.getDiscoveryDocument();

      expect(doc).toMatchObject({
        issuer: ISSUER,
        authorization_endpoint:
          'https://app.example.com/oauth/authorize?client=federation',
        token_endpoint: `${ISSUER}/federation/token`,
        userinfo_endpoint: `${ISSUER}/federation/userinfo`,
        jwks_uri: `${ISSUER}/federation/jwks`,
        code_challenge_methods_supported: ['S256'],
        id_token_signing_alg_values_supported: ['RS256'],
        audience: FEDERATION_AUDIENCE,
      });
      expect(doc.scopes_supported).toEqual(['profile', 'email', 'org']);
    });

    it('fails loudly (500) when FRONTEND_URL is unset instead of advertising "undefined/..."', async () => {
      delete process.env.FRONTEND_URL;

      await expect(service.getDiscoveryDocument()).rejects.toMatchObject({
        status: 500,
      });
    });
  });

  describe('revoke', () => {
    it('returns success when a grant was revoked', async () => {
      repository.revoke.mockResolvedValue(1);
      await expect(service.revoke('user-1', 'grant-1')).resolves.toEqual({
        success: true,
      });
      expect(repository.revoke).toHaveBeenCalledWith('user-1', 'grant-1');
    });

    it('404s on an unknown or foreign grant id', async () => {
      repository.revoke.mockResolvedValue(0);
      await expect(service.revoke('user-1', 'nope')).rejects.toMatchObject({
        status: 404,
      });
    });
  });
});
