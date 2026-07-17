import { AuthService } from '@gitroom/helpers/auth/auth.service';

type TokenBearing = {
  token?: string | null;
  refreshToken?: string | null;
};

function decryptTokenValue(value?: string | null): string | null | undefined {
  if (!value || !value.startsWith('v2:')) {
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
