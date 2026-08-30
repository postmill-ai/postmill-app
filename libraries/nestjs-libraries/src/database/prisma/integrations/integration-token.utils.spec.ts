import { describe, it, expect, vi } from 'vitest';
import {
  decryptIntegrationTokens,
  decryptPostIntegrationTokens,
} from './integration-token.utils';

vi.mock('@postmill-ai/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedDecryption: vi.fn((value: string) => {
      if (!value.startsWith('v2:')) {
        throw new Error(
          'AuthService.fixedDecryption: refusing to decrypt a value that is not `v2:`-encrypted'
        );
      }
      return `decrypted:${value.slice(3)}`;
    }),
  },
}));

describe('integration-token.utils (v1.0.0 — no plaintext pass-through)', () => {
  it('decrypts v2: token and refreshToken in place', () => {
    const integration = { token: 'v2:abc', refreshToken: 'v2:def' };
    decryptIntegrationTokens(integration);
    expect(integration.token).toBe('decrypted:abc');
    expect(integration.refreshToken).toBe('decrypted:def');
  });

  it('passes null/undefined/empty values through untouched', () => {
    const integration = { token: '', refreshToken: null };
    decryptIntegrationTokens(integration);
    expect(integration.token).toBe('');
    expect(integration.refreshToken).toBeNull();
    expect(decryptIntegrationTokens(null)).toBeNull();
    expect(decryptIntegrationTokens(undefined)).toBeUndefined();
  });

  it('throws on a non-v2: token (legacy plaintext no longer passes through)', () => {
    expect(() =>
      decryptIntegrationTokens({ token: 'plain-raw-token' })
    ).toThrow(/v2:/);
  });

  it('decrypts the nested integration of a post', () => {
    const post = { id: 'p1', integration: { token: 'v2:xyz' } };
    decryptPostIntegrationTokens(post);
    expect(post.integration.token).toBe('decrypted:xyz');
    expect(decryptPostIntegrationTokens(null)).toBeNull();
  });
});
