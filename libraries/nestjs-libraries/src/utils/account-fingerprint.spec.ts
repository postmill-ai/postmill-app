import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { accountFingerprint } from './account-fingerprint';

describe('accountFingerprint', () => {
  it('returns a 64-char hex sha256 digest', () => {
    const fp = accountFingerprint('openai', 'acct-1');
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable: the same inputs always produce the same fingerprint', () => {
    const a = accountFingerprint('openai', 'acct-1', 'us-east');
    const b = accountFingerprint('openai', 'acct-1', 'us-east');
    expect(a).toBe(b);
  });

  it('matches the sha256 of the pipe-joined parts', () => {
    const expected = createHash('sha256')
      .update('openai|acct-1')
      .digest('hex');
    expect(accountFingerprint('openai', 'acct-1')).toBe(expected);
  });

  it('produces different fingerprints for different accounts', () => {
    expect(accountFingerprint('openai', 'acct-1')).not.toBe(
      accountFingerprint('openai', 'acct-2')
    );
    expect(accountFingerprint('openai', 'acct-1')).not.toBe(
      accountFingerprint('anthropic', 'acct-1')
    );
  });

  it('is order-sensitive (parts are positional, not keyed)', () => {
    expect(accountFingerprint('a', 'b')).not.toBe(accountFingerprint('b', 'a'));
  });

  it('skips null and undefined parts identically', () => {
    const withNull = accountFingerprint('a', null, 'b');
    const withUndefined = accountFingerprint('a', undefined, 'b');
    const without = accountFingerprint('a', 'b');
    expect(withNull).toBe(without);
    expect(withUndefined).toBe(without);
  });

  it('does not treat empty string as a skipped part', () => {
    // '' is joined (producing 'a||b'), unlike null/undefined which are filtered.
    expect(accountFingerprint('a', '', 'b')).not.toBe(
      accountFingerprint('a', 'b')
    );
  });
});
