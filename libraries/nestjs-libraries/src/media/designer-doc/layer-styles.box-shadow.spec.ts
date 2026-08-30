import { describe, it, expect } from 'vitest';
import { elementStyles, styleFromBoxShadow, styleOffset } from './layer-styles';

/**
 * `styleFromBoxShadow` is the WRITE path for the inspector's simple
 * x/y/blur shadow control (`shadow-section.tsx`): it stores that shadow as a
 * drop-shadow layer style, so the round-trip through `styleOffset` is what
 * keeps the sliders and the renderer in agreement.
 *
 * A stored `boxShadow` field on a document is NOT read anywhere — v1 ships
 * zero legacy support, so `elementStyles` is only the single chokepoint
 * through which renderers resolve a layer's effects.
 */

describe('styleFromBoxShadow', () => {
  it('round-trips offsets through styleOffset, which is the whole point', () => {
    for (const [x, y] of [[2, 2], [-10, 4], [0, 12], [-6, 0], [0, 0]]) {
      const offset = styleOffset(styleFromBoxShadow({ offsetX: x, offsetY: y }));
      expect(offset.x).toBeCloseTo(x, 6);
      expect(offset.y).toBeCloseTo(y, 6);
    }
  });

  it('carries colour and blur across', () => {
    const s = styleFromBoxShadow({ color: '#ff0000', blur: 12 });
    expect(s.type).toBe('drop-shadow');
    expect(s.color).toBe('#ff0000');
    expect(s.size).toBe(12);
    // Spread must be 0 or `styleBlur` would eat the blur.
    expect(s.spread).toBe(0);
  });
});

describe('elementStyles', () => {
  it('resolves to exactly the layer’s styles — nothing is synthesized', () => {
    const styles = [{ type: 'stroke' as const }];
    expect(elementStyles({ styles })).toBe(styles);
    expect(elementStyles({})).toBeUndefined();
  });

  it('ignores a stored boxShadow field rather than translating it', () => {
    const styles = [{ type: 'stroke' as const }];
    const out = elementStyles({ styles, boxShadow: { color: '#ff0000' } } as never);
    expect(out).toBe(styles);
  });
});
