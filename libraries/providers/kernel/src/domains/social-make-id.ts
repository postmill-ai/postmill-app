import crypto from 'crypto';

export const makeId = (length: number) => {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
};

/**
 * OAuth `state` / capability-key generator — always 128-bit CSPRNG (32 hex chars).
 * Use this (never bare `makeId`) for OAuth `state`, PKCE `login:` keys, OIDC `nonce`,
 * and any Redis capability key (`organization:` / `login:`). `makeId(n)` yields only
 * n*4 bits and has shipped brute-forceable 24-bit states — do not use it for these.
 */
export const makeOauthState = (): string => {
  return crypto.randomBytes(16).toString('hex');
};
