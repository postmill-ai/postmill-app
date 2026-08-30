import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { OAuthService } from './oauth.service';

const sha256Lookup = (value: string) =>
  `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

const s256Challenge = (verifier: string) =>
  crypto.createHash('sha256').update(verifier).digest('base64url').replace(/=+$/, '');

describe('OAuthService (v1.0.0 — mandatory PKCE, sha256-only lookups)', () => {
  let repository: any;
  let service: OAuthService;

  beforeEach(() => {
    repository = {
      createAuthorization: vi.fn().mockResolvedValue({}),
      getAppByClientId: vi.fn(),
      findByCode: vi.fn(),
      exchangeCodeForToken: vi.fn().mockResolvedValue({
        organizationId: 'org-1',
        organization: { paymentId: 'cus-1' },
      }),
    };
    service = new OAuthService(repository);
  });

  describe('createAuthorizationCode', () => {
    it('rejects requests without a code_challenge (400)', async () => {
      await expect(
        service.createAuthorizationCode('app-1', 'user-1', 'org-1')
      ).rejects.toMatchObject({ status: 400 });
      expect(repository.createAuthorization).not.toHaveBeenCalled();
    });

    it('rejects a non-S256 code_challenge_method (400)', async () => {
      await expect(
        service.createAuthorizationCode('app-1', 'user-1', 'org-1', {
          codeChallenge: 'abc',
          codeChallengeMethod: 'plain',
        })
      ).rejects.toMatchObject({ status: 400 });
      expect(repository.createAuthorization).not.toHaveBeenCalled();
    });

    it('accepts an S256 challenge and stores it with the code', async () => {
      const code = await service.createAuthorizationCode('app-1', 'user-1', 'org-1', {
        codeChallenge: s256Challenge('verifier-1'),
        codeChallengeMethod: 'S256',
      });

      expect(typeof code).toBe('string');
      expect(repository.createAuthorization).toHaveBeenCalledWith(
        expect.objectContaining({
          authorizationCode: sha256Lookup(code),
          codeChallenge: s256Challenge('verifier-1'),
          codeChallengeMethod: 'S256',
        })
      );
    });
  });

  describe('exchangeCodeForToken', () => {
    const app = {
      id: 'app-1',
      clientSecret: sha256Lookup('pcs_secret'),
    };
    const storedAuth = {
      id: 'auth-1',
      oauthAppId: 'app-1',
      organizationId: 'org-1',
      userId: 'user-1',
      codeExpiresAt: new Date(Date.now() + 60_000),
      redirectUri: null,
      codeChallenge: s256Challenge('verifier-1'),
      codeChallengeMethod: 'S256',
      scope: null,
    };

    beforeEach(() => {
      repository.getAppByClientId.mockResolvedValue(app);
      repository.findByCode.mockResolvedValue(storedAuth);
    });

    it('looks the code up by its sha256 hash only', async () => {
      await service.exchangeCodeForToken('the-code', 'client-1', 'pcs_secret', {
        codeVerifier: 'verifier-1',
      });
      expect(repository.findByCode).toHaveBeenCalledWith(sha256Lookup('the-code'));
    });

    it('rejects a client secret that only matches a legacy (non-sha256) stored value', async () => {
      repository.getAppByClientId.mockResolvedValue({
        id: 'app-1',
        clientSecret: 'legacy-cbc-hex',
      });

      await expect(
        service.exchangeCodeForToken('the-code', 'client-1', 'pcs_secret', {
          codeVerifier: 'verifier-1',
        })
      ).rejects.toMatchObject({ status: 401 });
    });

    it('rejects the exchange when no code_verifier is supplied (400)', async () => {
      await expect(
        service.exchangeCodeForToken('the-code', 'client-1', 'pcs_secret')
      ).rejects.toMatchObject({ status: 400 });
      expect(repository.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it('rejects a challenge-less legacy authorization row (400)', async () => {
      repository.findByCode.mockResolvedValue({
        ...storedAuth,
        codeChallenge: null,
        codeChallengeMethod: null,
      });

      await expect(
        service.exchangeCodeForToken('the-code', 'client-1', 'pcs_secret', {
          codeVerifier: 'verifier-1',
        })
      ).rejects.toMatchObject({ status: 400 });
      expect(repository.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it('rejects a mismatched code_verifier (400)', async () => {
      await expect(
        service.exchangeCodeForToken('the-code', 'client-1', 'pcs_secret', {
          codeVerifier: 'wrong-verifier',
        })
      ).rejects.toMatchObject({ status: 400 });
      expect(repository.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it('exchanges a valid code + verifier for tokens', async () => {
      const result = await service.exchangeCodeForToken(
        'the-code',
        'client-1',
        'pcs_secret',
        { codeVerifier: 'verifier-1' }
      );

      expect(result.access_token).toMatch(/^pos_/);
      expect(result.refresh_token).toMatch(/^posr_/);
      expect(result.expires_in).toBe(3600);
      expect(repository.exchangeCodeForToken).toHaveBeenCalledWith(
        'auth-1',
        'org-1',
        'user-1',
        sha256Lookup(result.access_token),
        expect.objectContaining({
          refreshToken: sha256Lookup(result.refresh_token),
        })
      );
    });
  });
});
