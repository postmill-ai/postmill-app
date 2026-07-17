import { describe, it, expect } from 'vitest';
import { FacebookProvider } from './social.adapter';

describe('FacebookProvider.generateAuthUrl — OAuth state entropy (F11)', () => {
  it('emits a 128-bit state (32 hex chars) carried in the dialog URL', async () => {
    const provider = new FacebookProvider();
    const { url, state } = await provider.generateAuthUrl();

    // Representative adapter check: the state is the Redis capability key for
    // the connect flow — 32 hex chars = 128 bits, not the old makeId(6) 24-bit.
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(url).toContain(`&state=${state}`);
  });
});
