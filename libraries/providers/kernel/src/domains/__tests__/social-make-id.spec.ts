import { describe, it, expect } from 'vitest';
import { makeId, makeOauthState } from '../social-make-id';

describe('makeOauthState (F11 — OAuth state entropy)', () => {
  it('returns 32 lowercase hex chars = 128 bits of CSPRNG entropy', () => {
    const state = makeOauthState();

    // The OAuth `state` doubles as the CSRF token and the Redis capability key
    // (`organization:` / `login:`) binding a connect flow to an org, so it must
    // never fall below the 128-bit norm. 32 hex chars * 4 bits = 128 bits.
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(state.length * 4).toBe(128);
  });

  it('generates distinct values across calls', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => makeOauthState()));
    expect(seen.size).toBe(1000);
  });

  it('documents why bare makeId was not acceptable for state (makeId(6) = 24 bits)', () => {
    // Regression pin for the old behaviour the F11 fix replaced: makeId(n)
    // yields only n*4 bits — makeId(6) was a brute-forceable 24-bit state.
    // makeId stays exported for non-security ID fallbacks only.
    expect(makeId(6)).toMatch(/^[0-9a-f]{6}$/);
  });
});
