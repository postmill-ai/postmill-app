import { describe, expect, it } from 'vitest';
import type { ProviderRow } from '../provider-surface.types';
import { mediaDescriptor } from './media.descriptor';

const hrefFor = (identifier: string) =>
  mediaDescriptor.getProviderHref?.({ identifier } as ProviderRow);

describe('media settings studio links', () => {
  it('opens canonical fal.ai and direct Kling AI studios', () => {
    expect(hrefFor('fal')).toBe('/media/fal');
    expect(hrefFor('kling')).toBe('/media/kling-ai');
  });

  it('keeps the Google route override', () => {
    expect(hrefFor('google')).toBe('/media/google-ai');
  });
});
