import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { isAllowedReturnUrl } from '@gitroom/nestjs-libraries/security/return-url.validator';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { OrgShortLinkSettingsService } from '@gitroom/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.service';

interface OAuthState {
  codeVerifier: string;
  redirectUri: string;
  identifier: string;
}

@Injectable()
export class ShortLinkOAuthService {
  constructor(
    private _orgShortLinkSettings: OrgShortLinkSettingsService,
  ) {}

  /**
   * Build an OAuth authorization URL for the given short-link provider.
   * Generates PKCE state/verifier/challenge, stores transient state in Redis,
   * and returns the URL + state.
   */
  async getOAuthUrl(
    orgId: string,
    identifier: string,
    redirectUri: string,
    version?: string,
  ): Promise<{ url: string; state: string }> {
    if (!isAllowedReturnUrl(redirectUri)) {
      throw new ForbiddenException('Invalid redirect URI');
    }

    const adapter = this._orgShortLinkSettings.requireAdapter(identifier, version);
    if (!adapter.oauth) {
      throw new ForbiddenException('Provider does not support OAuth');
    }

    // Resolve the same pinned version the org's config uses.
    const pinnedVersion =
      version ?? (await this._orgShortLinkSettings.getPinnedVersion(orgId, identifier));
    const resolvedAdapter = this._orgShortLinkSettings.requireAdapter(identifier, pinnedVersion);
    if (!resolvedAdapter.oauth) {
      throw new ForbiddenException('Provider does not support OAuth');
    }

    // B-1: load clientId/secret from extraConfig
    const cfg = await this._orgShortLinkSettings.getConfigForProvider(orgId, identifier);

    // CSPRNG state + PKCE verifier
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    // Store transient state in Redis, TTL 600s
    await ioRedis.set(
      `shortlink:oauth:${orgId}:${state}`,
      JSON.stringify({ codeVerifier, redirectUri, identifier }),
      'EX',
      600,
    );

    const url = resolvedAdapter.oauth.authorizeUrl(
      { orgId, credentials: {}, extraConfig: cfg?.extraConfig },
      state,
      redirectUri,
      codeChallenge,
    );

    return { url, state };
  }

  /**
   * Exchange an OAuth callback code for short-link credentials and persist them.
   * Validates state, redirect URI, and updates/creates the provider config.
   */
  async oauthCallback(
    orgId: string,
    identifier: string,
    code: string,
    state: string,
    redirectUri: string,
    version?: string,
  ): Promise<{ identifier: string; success: true }> {
    if (!isAllowedReturnUrl(redirectUri)) {
      throw new ForbiddenException('Invalid redirect URI');
    }

    const pinnedVersion =
      version ?? (await this._orgShortLinkSettings.getPinnedVersion(orgId, identifier));
    const adapter = this._orgShortLinkSettings.requireAdapter(identifier, pinnedVersion);
    if (!adapter.oauth) {
      throw new ForbiddenException('Provider does not support OAuth');
    }

    // Look up + delete the stored state (single-use)
    const key = `shortlink:oauth:${orgId}:${state}`;
    const storedRaw = await ioRedis.get(key);
    await ioRedis.del(key); // single-use
    if (!storedRaw) {
      throw new ForbiddenException('Invalid or expired OAuth state');
    }

    const stored = JSON.parse(storedRaw) as OAuthState;
    const { codeVerifier, redirectUri: storedRedirectUri, identifier: storedId } = stored;
    if (storedId !== identifier || storedRedirectUri !== redirectUri) {
      throw new ForbiddenException('OAuth state mismatch');
    }

    // B-1: load clientId/secret for exchange
    const cfg = await this._orgShortLinkSettings.getConfigForProvider(orgId, identifier);

    const credentials = await adapter.oauth.exchangeCode(
      code,
      redirectUri,
      { orgId, credentials: {}, extraConfig: cfg?.extraConfig },
      codeVerifier,
    );

    // 0.3: an OAuth re-connect of an existing config is a rotation — update the
    // (active-preferred) row in place, recomputing the fingerprint for the new
    // tokens. `updateById` keeps the row's pinned version, so re-authing a
    // deprecated-pinned config still works (1.4 in-place semantics); upsert stays
    // for the first-ever connect.
    const existingId = await this._orgShortLinkSettings.getExistingConfigId(
      orgId,
      identifier,
    );
    if (existingId) {
      await this._orgShortLinkSettings.updateById(
        orgId,
        existingId,
        {
          credentials,
          accountFingerprint: this._orgShortLinkSettings.computeAccountFingerprint(
            identifier,
            credentials,
          ),
        },
        identifier,
      );
      return { identifier, success: true };
    }

    await this._orgShortLinkSettings.upsert(orgId, identifier, {
      enabled: true,
      credentials,
      version: pinnedVersion,
    });

    return { identifier, success: true };
  }
}
