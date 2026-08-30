import { AuthService } from '@postmill-ai/helpers/auth/auth.service';

type TokenBearing = {
  token?: string | null;
  refreshToken?: string | null;
};

function decryptTokenValue(value?: string | null): string | null | undefined {
  // v1.0.0: no plaintext pass-through. Non-empty values are always v2:-encrypted
  // (the "legacy secret re-encryption" backfill step rewrites older rows at
  // boot); AuthService.fixedDecryption throws on anything else.
  if (!value) {
    return value;
  }
  return AuthService.fixedDecryption(value);
}

export function decryptIntegrationTokens<T extends TokenBearing | null | undefined>(
  integration: T
): T {
  if (!integration) {
    return integration;
  }

  integration.token = decryptTokenValue(integration.token) as any;
  integration.refreshToken = decryptTokenValue(integration.refreshToken) as any;
  return integration;
}

export function decryptPostIntegrationTokens<T extends { integration?: TokenBearing | null } | null | undefined>(
  post: T
): T {
  if (post?.integration) {
    decryptIntegrationTokens(post.integration);
  }
  return post;
}
