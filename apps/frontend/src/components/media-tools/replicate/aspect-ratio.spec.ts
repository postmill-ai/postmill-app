import { describe, it, expect } from 'vitest';
import { closestAspectRatio } from './aspect-ratio';

describe('closestAspectRatio', () => {
  it('maps common canvas dimensions to the matching W:H ratio', () => {
    expect(closestAspectRatio(1920, 1080)).toBe('16:9');
    expect(closestAspectRatio(1080, 1920)).toBe('9:16');
    expect(closestAspectRatio(1080, 1080)).toBe('1:1');
    expect(closestAspectRatio(1080, 1350)).toBe('4:5');
  });

  it('picks the closest ratio the schema enum allows', () => {
    // A wide canvas with a portrait-only/1:1 enum must seed 1:1, not 16:9.
    expect(closestAspectRatio(1920, 1080, ['1:1', '9:16'])).toBe('1:1');
    expect(closestAspectRatio(1080, 1920, ['16:9', '1:1', '9:16'])).toBe('9:16');
  });

  it('returns undefined for unusable dimensions or an unparsable enum', () => {
    expect(closestAspectRatio(0, 1080)).toBeUndefined();
    expect(closestAspectRatio(undefined, undefined)).toBeUndefined();
    expect(closestAspectRatio(1920, 1080, ['wide', 'tall'])).toBeUndefined();
    // An empty/absent enum is no constraint — the default ladder applies.
    expect(closestAspectRatio(1920, 1080, [])).toBe('16:9');
  });
});
