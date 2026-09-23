import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { FederationRepository } from '@postmill-ai/nestjs-libraries/database/prisma/federation/federation.repository';
import { EncryptionService } from '@postmill-ai/nestjs-libraries/encryption/encryption.service';
import { makeId } from '@postmill-ai/nestjs-libraries/services/make.is';
import { sign } from 'jsonwebtoken';
import crypto from 'crypto';

// "Postmill ID" federation: the fixed audience for id_tokens issued to pinned
// first-party clients (the template store). There is no client registration —
// the audience + the FEDERATION_TRUSTED_REDIRECT_URIS allow-list pin the client.
export const FEDERATION_AUDIENCE = 'postmill-template-store';

// Only these scopes may be granted through federation — never mcp:* or any
// client-invented scope. Each maps 1:1 to a claim group in buildClaims.
const FEDERATION_SCOPES = ['profile', 'email', 'org'] as const;

type FederationScope = (typeof FEDERATION_SCOPES)[number];

const DEFAULT_TRUSTED_REDIRECT_URIS = [
  'https://templates.postmill.ai/auth/callback',
];

interface IdentityKeys {
  kid: string;
  publicJwk: { kty: string; n: string; e: string };
  privateKeyPem: string;
}

@Injectable()
export class FederationService {
  private _identityCache?: IdentityKeys;

  constructor(
    private _federationRepository: FederationRepository,
    private _encryptionService: EncryptionService
  ) {}

  private lookupHash(value: string) {
    return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
  }

  private issuer() {
    const issuer =
      process.env.FEDERATION_ISSUER ||
      process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL ||
      process.env.BACKEND_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!issuer) {
      throw new HttpException(
        {
          error: 'server_error',
          error_description:
            'Federation issuer is not configured (BACKEND_URL or FEDERATION_ISSUER)',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    return issuer.replace(/\/+$/, '');
  }

  trustedRedirectUris() {
    const fromEnv = (process.env.FEDERATION_TRUSTED_REDIRECT_URIS || '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    return fromEnv.length ? fromEnv : DEFAULT_TRUSTED_REDIRECT_URIS;
  }

  private async getOrCreateIdentity(): Promise<IdentityKeys> {
    if (this._identityCache) {
      return this._identityCache;
    }

    const existing = await this._federationRepository.getIdentity();
    if (existing) {
      this._identityCache = {
        kid: existing.kid,
        publicJwk: existing.publicJwk as IdentityKeys['publicJwk'],
        privateKeyPem: this._encryptionService.decrypt(existing.privateKeyEnc),
      };
      return this._identityCache;
    }

    // First boot: generate the instance's RS256 identity with zero operator
    // configuration. The private PEM is encrypted at rest via EncryptionService
    // (AES-256-GCM, v2:) — the same store used for channel secrets.
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const publicJwk = publicKey.export({ format: 'jwk' }) as IdentityKeys['publicJwk'];
    const privateKeyPem = privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    const kid = crypto
      .createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex')
      .slice(0, 16);

    try {
      await this._federationRepository.createIdentity({
        kid,
        publicJwk,
        privateKeyEnc: this._encryptionService.encrypt(privateKeyPem),
      });
    } catch {
      // Concurrent boot lost the race — another replica created the row.
      this._identityCache = undefined;
      return this.getOrCreateIdentity();
    }

    this._identityCache = { kid, publicJwk, privateKeyPem };
    return this._identityCache;
  }

  async getJwks() {
    const { kid, publicJwk } = await this.getOrCreateIdentity();
    return {
      keys: [
        {
          kty: publicJwk.kty,
          use: 'sig',
          alg: 'RS256',
          kid,
          n: publicJwk.n,
          e: publicJwk.e,
        },
      ],
    };
  }

  async getDiscoveryDocument() {
    const issuer = this.issuer();
    return {
      issuer,
      authorization_endpoint: `${process.env.FRONTEND_URL}/oauth/authorize?client=federation`,
      token_endpoint: `${issuer}/federation/token`,
      userinfo_endpoint: `${issuer}/federation/userinfo`,
      jwks_uri: `${issuer}/federation/jwks`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      id_token_signing_alg_values_supported: ['RS256'],
      subject_types_supported: ['public'],
      scopes_supported: [...FEDERATION_SCOPES],
      claims_supported: ['sub', 'name', 'picture', 'email', 'email_verified', 'org'],
      audience: FEDERATION_AUDIENCE,
    };
  }

  validateAuthorizeRequest(redirectUri?: string) {
    if (!redirectUri || !this.trustedRedirectUris().includes(redirectUri)) {
      throw new HttpException(
        {
          error: 'invalid_request',
          error_description: 'redirect_uri is not a trusted federation redirect',
        },
        HttpStatus.BAD_REQUEST
      );
    }
    return { redirectUri };
  }

  private sanitizeScope(scope?: string): FederationScope[] {
    const requested = (scope || FEDERATION_SCOPES.join(' '))
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const granted = requested.filter((s): s is FederationScope =>
      (FEDERATION_SCOPES as readonly string[]).includes(s)
    );
    if (!granted.length) {
      throw new HttpException(
        {
          error: 'invalid_scope',
          error_description: `scope must contain at least one of: ${FEDERATION_SCOPES.join(', ')}`,
        },
        HttpStatus.BAD_REQUEST
      );
    }
    return [...new Set(granted)];
  }

  async createAuthorizationCode(
    userId: string,
    organizationId: string,
    options: {
      redirectUri: string;
      codeChallenge?: string;
      codeChallengeMethod?: string;
      nonce?: string;
      scope?: string;
    }
  ) {
    this.validateAuthorizeRequest(options.redirectUri);

    // PKCE is mandatory, same rule as the MCP OAuth flow.
    if (!options.codeChallenge || options.codeChallengeMethod !== 'S256') {
      throw new HttpException(
        {
          error: 'invalid_request',
          error_description:
            'code_challenge with code_challenge_method=S256 is required',
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const scope = this.sanitizeScope(options.scope).join(' ');
    const code = makeId(32);
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this._federationRepository.upsertGrant({
      userId,
      organizationId,
      authorizationCode: this.lookupHash(code),
      codeExpiresAt,
      redirectUri: options.redirectUri,
      codeChallenge: options.codeChallenge,
      codeChallengeMethod: options.codeChallengeMethod || null,
      nonce: options.nonce,
      scope,
    });

    return code;
  }

  private roleKeyFor(grant: {
    organizationId: string;
    user: { organizations: { organizationId: string; roleRef?: { key: string } | null }[] };
  }) {
    return grant.user.organizations.find(
      (m) => m.organizationId === grant.organizationId
    )?.roleRef?.key;
  }

  private buildClaims(
    grant: {
      organizationId: string;
      scope: string | null;
      organization: { id: string; name: string };
      user: {
        id: string;
        email: string;
        activated: boolean;
        organizations: { organizationId: string; roleRef?: { key: string } | null }[];
        profile?: {
          name?: string | null;
          lastName?: string | null;
          avatarUrl?: string | null;
          picture?: { path: string } | null;
        } | null;
      };
    },
    scopes: FederationScope[]
  ) {
    const claims: Record<string, unknown> = { sub: grant.user.id };
    const profile = grant.user.profile;

    if (scopes.includes('profile')) {
      const fullName = [profile?.name, profile?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      claims.name = fullName || grant.user.email.split('@')[0];
      const picture = profile?.avatarUrl || profile?.picture?.path;
      if (picture) {
        claims.picture = picture;
      }
    }

    if (scopes.includes('email')) {
      claims.email = grant.user.email;
      claims.email_verified = grant.user.activated;
    }

    if (scopes.includes('org')) {
      claims.org = {
        id: grant.organization.id,
        name: grant.organization.name,
        role: this.roleKeyFor(grant),
      };
    }

    return claims;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier?: string
  ) {
    const grant = await this._federationRepository.findByCode(
      this.lookupHash(code)
    );
    if (!grant) {
      throw new HttpException(
        { error: 'invalid_grant' },
        HttpStatus.BAD_REQUEST
      );
    }

    if (!grant.codeExpiresAt || new Date() > grant.codeExpiresAt) {
      throw new HttpException(
        { error: 'invalid_grant', error_description: 'Code has expired' },
        HttpStatus.BAD_REQUEST
      );
    }

    if (grant.redirectUri !== redirectUri) {
      throw new HttpException(
        { error: 'invalid_grant', error_description: 'redirect_uri mismatch' },
        HttpStatus.BAD_REQUEST
      );
    }

    // PKCE verification is mandatory — codes are only created with an S256
    // challenge, so a row without one cannot legitimately exist.
    if (!grant.codeChallenge || grant.codeChallengeMethod !== 'S256') {
      throw new HttpException(
        {
          error: 'invalid_grant',
          error_description: 'Authorization code predates mandatory PKCE — restart the flow',
        },
        HttpStatus.BAD_REQUEST
      );
    }
    if (!codeVerifier) {
      throw new HttpException(
        { error: 'invalid_grant', error_description: 'code_verifier required' },
        HttpStatus.BAD_REQUEST
      );
    }
    const verifierHash = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url')
      .replace(/=+$/, '');
    if (verifierHash !== grant.codeChallenge) {
      throw new HttpException(
        { error: 'invalid_grant', error_description: 'code_verifier mismatch' },
        HttpStatus.BAD_REQUEST
      );
    }

    const accessToken = 'posf_' + makeId(40);
    const tokenExpiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour

    await this._federationRepository.markCodeExchanged(grant.id, {
      accessToken: this.lookupHash(accessToken),
      tokenExpiresAt,
    });

    const scopes = this.sanitizeScope(grant.scope || undefined);
    const { kid, privateKeyPem } = await this.getOrCreateIdentity();
    const idToken = sign(
      {
        ...this.buildClaims(grant, scopes),
        ...(grant.nonce ? { nonce: grant.nonce } : {}),
      },
      privateKeyPem,
      {
        algorithm: 'RS256',
        keyid: kid,
        issuer: this.issuer(),
        audience: FEDERATION_AUDIENCE,
        expiresIn: 3600,
      }
    );

    return {
      id_token: idToken,
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 3600,
      scope: scopes.join(' '),
    };
  }

  async getUserInfo(accessToken: string) {
    const grant = await this._federationRepository.findByAccessToken(
      this.lookupHash(accessToken)
    );
    if (!grant) {
      return null;
    }
    return this.buildClaims(grant, this.sanitizeScope(grant.scope || undefined));
  }

  async getGrantsForUser(userId: string) {
    const grants = await this._federationRepository.getGrantsForUser(userId);
    return grants.map((grant) => ({
      id: grant.id,
      client: {
        name: 'Postmill Template Store',
        audience: FEDERATION_AUDIENCE,
      },
      organization: grant.organization,
      scope: grant.scope,
      createdAt: grant.createdAt,
    }));
  }

  async revoke(userId: string, grantId: string) {
    await this._federationRepository.revoke(userId, grantId);
    return { success: true };
  }
}
