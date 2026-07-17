import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { CreateOAuthAppDto } from '@gitroom/nestjs-libraries/dtos/oauth/create-oauth-app.dto';
import { UpdateOAuthAppDto } from '@gitroom/nestjs-libraries/dtos/oauth/update-oauth-app.dto';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import crypto from 'crypto';

@Injectable()
export class OAuthService {
  constructor(private _oauthRepository: OAuthRepository) {}

  private lookupHash(value: string) {
    return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
  }

  private lookupCandidates(value: string) {
    return [
      this.lookupHash(value),
      AuthService.fixedEncryptionDeterministic(value),
    ];
  }

  private matchesStoredSecret(stored: string, plain: string) {
    if (stored === this.lookupHash(plain)) {
      return true;
    }

    try {
      return AuthService.fixedDecryption(stored) === plain;
    } catch {
      return stored === AuthService.fixedEncryptionDeterministic(plain);
    }
  }

  async getApp(orgId: string) {
    const app = await this._oauthRepository.getAppByOrgId(orgId);
    if (!app) return false;
    const { clientSecret, ...rest } = app;
    return rest;
  }

  async createApp(orgId: string, dto: CreateOAuthAppDto) {
    const existing = await this._oauthRepository.getAppByOrgId(orgId);
    if (existing) {
      throw new HttpException(
        'You can only have one OAuth application per organization',
        HttpStatus.BAD_REQUEST
      );
    }

    const clientId = 'pca_' + makeId(32);
    const clientSecret = 'pcs_' + makeId(48);
    const encryptedSecret = this.lookupHash(clientSecret);

    const app = await this._oauthRepository.createApp(orgId, {
      name: dto.name,
      description: dto.description,
      pictureId: dto.pictureId,
      redirectUrl: dto.redirectUrl,
      clientId,
      clientSecret: encryptedSecret,
    });

    return { ...app, clientSecret };
  }

  async updateApp(orgId: string, dto: UpdateOAuthAppDto) {
    return this._oauthRepository.updateApp(orgId, {
      ...(dto.name && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.pictureId !== undefined && { pictureId: dto.pictureId }),
      ...(dto.redirectUrl && { redirectUrl: dto.redirectUrl }),
    });
  }

  async deleteApp(orgId: string) {
    const app = await this._oauthRepository.getAppByOrgId(orgId);
    if (!app) {
      throw new HttpException('No OAuth app found', HttpStatus.NOT_FOUND);
    }
    await this._oauthRepository.revokeAllForApp(app.id);
    await this._oauthRepository.deleteApp(orgId);
    return { success: true };
  }

  async rotateSecret(orgId: string) {
    const app = await this._oauthRepository.getAppByOrgId(orgId);
    if (!app) {
      throw new HttpException('No OAuth app found', HttpStatus.NOT_FOUND);
    }

    const newSecret = 'pcs_' + makeId(48);
    const encrypted = this.lookupHash(newSecret);
    await this._oauthRepository.updateClientSecret(orgId, encrypted);
    return { clientSecret: newSecret };
  }

  async validateAuthorizationRequest(
    clientId: string,
    redirectUri?: string,
  ) {
    const app = await this._oauthRepository.getAppByClientId(clientId);
    if (!app) {
      throw new HttpException('Invalid client_id', HttpStatus.BAD_REQUEST);
    }

    // Exact redirect URI matching when supplied
    if (redirectUri && app.redirectUrl !== redirectUri) {
      throw new HttpException(
        { error: 'invalid_request', error_description: 'redirect_uri mismatch' },
        HttpStatus.BAD_REQUEST,
      );
    }

    return app;
  }

  async createAuthorizationCode(
    oauthAppId: string,
    userId: string,
    organizationId: string,
    options?: {
      redirectUri?: string;
      codeChallenge?: string;
      codeChallengeMethod?: string;
      scope?: string;
    },
  ) {
    const code = makeId(32);
    const encryptedCode = this.lookupHash(code);
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Validate PKCE: require S256 if code_challenge is provided
    if (options?.codeChallenge && options?.codeChallengeMethod !== 'S256') {
      throw new HttpException(
        { error: 'invalid_request', error_description: 'unsupported code_challenge_method' },
        HttpStatus.BAD_REQUEST,
      );
    }

    await this._oauthRepository.createAuthorization({
      oauthAppId,
      userId,
      organizationId,
      authorizationCode: encryptedCode,
      codeExpiresAt,
      redirectUri: options?.redirectUri,
      codeChallenge: options?.codeChallenge,
      codeChallengeMethod: options?.codeChallengeMethod || null,
      scope: options?.scope,
    });

    return code;
  }

  async exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret: string,
    options?: {
      redirectUri?: string;
      codeVerifier?: string;
      scope?: string;
    },
  ) {
    const app = await this._oauthRepository.getAppByClientId(clientId);
    if (!app) {
      throw new HttpException(
        { error: 'invalid_client' },
        HttpStatus.UNAUTHORIZED
      );
    }

    if (!this.matchesStoredSecret(app.clientSecret, clientSecret)) {
      throw new HttpException(
        { error: 'invalid_client' },
        HttpStatus.UNAUTHORIZED
      );
    }

    const encryptedCode = this.lookupCandidates(code);
    const auth = await this._oauthRepository.findByCode(encryptedCode);
    if (!auth || auth.oauthAppId !== app.id) {
      throw new HttpException(
        { error: 'invalid_grant' },
        HttpStatus.BAD_REQUEST
      );
    }

    if (!auth.codeExpiresAt || new Date() > auth.codeExpiresAt) {
      throw new HttpException(
        { error: 'invalid_grant', error_description: 'Code has expired' },
        HttpStatus.BAD_REQUEST
      );
    }

    // Validate redirect_uri if one was stored with the code
    if (auth.redirectUri && options?.redirectUri !== auth.redirectUri) {
      throw new HttpException(
        { error: 'invalid_grant', error_description: 'redirect_uri mismatch' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate PKCE code_verifier
    if (auth.codeChallenge && auth.codeChallengeMethod === 'S256') {
      if (!options?.codeVerifier) {
        throw new HttpException(
          { error: 'invalid_grant', error_description: 'code_verifier required' },
          HttpStatus.BAD_REQUEST,
        );
      }
      const verifierHash = crypto
        .createHash('sha256')
        .update(options.codeVerifier)
        .digest('base64url')
        .replace(/=+$/, '');
      if (verifierHash !== auth.codeChallenge) {
        throw new HttpException(
          { error: 'invalid_grant', error_description: 'code_verifier mismatch' },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const token = 'pos_' + makeId(40);
    const encryptedToken = this.lookupHash(token);
    const refreshToken = 'posr_' + makeId(48);
    const encryptedRefreshToken = this.lookupHash(refreshToken);
    const tokenExpiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour
    const refreshTokenExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000); // 30 days

    const {
      organizationId,
      organization: { paymentId },
    } = await this._oauthRepository.exchangeCodeForToken(
      auth.id,
      auth.organizationId,
      auth.userId,
      encryptedToken,
      {
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt,
        refreshTokenExpiresAt,
        scope: auth.scope || options?.scope,
      },
    );

    return {
      id: organizationId,
      cus: paymentId,
      access_token: token,
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: auth.scope || options?.scope,
    };
  }

  async refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string) {
    const app = await this._oauthRepository.getAppByClientId(clientId);
    if (!app) {
      throw new HttpException(
        { error: 'invalid_client' },
        HttpStatus.UNAUTHORIZED
      );
    }

    if (!this.matchesStoredSecret(app.clientSecret, clientSecret)) {
      throw new HttpException(
        { error: 'invalid_client' },
        HttpStatus.UNAUTHORIZED
      );
    }

    const encryptedRefresh = this.lookupCandidates(refreshToken);
    const auth = await this._oauthRepository.findByRefreshToken(encryptedRefresh);
    if (!auth || auth.oauthAppId !== app.id) {
      throw new HttpException(
        { error: 'invalid_grant' },
        HttpStatus.BAD_REQUEST
      );
    }

    if (auth.revokedAt || (auth.refreshTokenExpiresAt && new Date() > auth.refreshTokenExpiresAt)) {
      throw new HttpException(
        { error: 'invalid_grant', error_description: 'Refresh token expired or revoked' },
        HttpStatus.BAD_REQUEST
      );
    }

    // Rotate tokens
    const newToken = 'pos_' + makeId(40);
    const encryptedNewToken = this.lookupHash(newToken);
    const newRefreshToken = 'posr_' + makeId(48);
    const encryptedNewRefresh = this.lookupHash(newRefreshToken);
    const tokenExpiresAt = new Date(Date.now() + 3600 * 1000);
    const refreshTokenExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);

    await this._oauthRepository.updateTokens(auth.id, auth.organizationId, auth.userId, {
      accessToken: encryptedNewToken,
      refreshToken: encryptedNewRefresh,
      tokenExpiresAt,
      refreshTokenExpiresAt,
    });

    return {
      access_token: newToken,
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: newRefreshToken,
    };
  }

  async getOrgByOAuthToken(token: string) {
    const encrypted = this.lookupCandidates(token);
    return this._oauthRepository.findByAccessToken(encrypted);
  }

  async getApprovedApps(userId: string) {
    return this._oauthRepository.getApprovedApps(userId);
  }

  async revokeApp(userId: string, authId: string) {
    await this._oauthRepository.revokeAuthorization(userId, authId);
    return { success: true };
  }
}
