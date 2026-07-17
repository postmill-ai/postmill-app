import { describe, it, expect } from 'vitest';
import { PROVIDER_CAPABILITIES } from '../social-capabilities';

describe('PROVIDER_CAPABILITIES', () => {
  it('exposes the mastodon entry', () => {
    expect(PROVIDER_CAPABILITIES['mastodon']).toBeDefined();
  });

  it('does not advertise the orphaned mastodon-custom identifier (6.8)', () => {
    // No kernel module registers `mastodon-custom`, so it must not appear in the
    // capability matrix — advertising it would resolve to `undefined` at runtime.
    expect(
      (PROVIDER_CAPABILITIES as Record<string, unknown>)['mastodon-custom']
    ).toBeUndefined();
  });
});
