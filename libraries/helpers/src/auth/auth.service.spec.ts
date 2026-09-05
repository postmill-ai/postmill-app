import { describe, it, expect } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService.fixedDecryption', () => {
  it('throws a distinct error for empty values (not the legacy-CBC message)', () => {
    expect(() => AuthService.fixedDecryption('')).toThrow(
      'AuthService.fixedDecryption: cannot decrypt an empty value'
    );
    expect(() => AuthService.fixedDecryption(undefined as any)).toThrow(
      'AuthService.fixedDecryption: cannot decrypt an empty value'
    );
    expect(() => AuthService.fixedDecryption(null as any)).toThrow(
      'AuthService.fixedDecryption: cannot decrypt an empty value'
    );
  });

  it('refuses non-v2: values', () => {
    expect(() => AuthService.fixedDecryption('legacy-cbc-value')).toThrow(
      'refusing to decrypt a value that is not `v2:`-encrypted'
    );
  });

  it('round-trips fixedEncryption -> fixedDecryption', () => {
    const secret = 'super-secret-token';
    const encrypted = AuthService.fixedEncryption(secret);
    expect(encrypted.startsWith('v2:')).toBe(true);
    expect(AuthService.fixedDecryption(encrypted)).toBe(secret);
  });
});
