import { describe, it, expect } from 'vitest';
import { elementStyles, styleFromBoxShadow, styleOffset } from './layer-styles';

/**
 * `boxShadow` was a four-control inspector section on images and shapes that no
 * renderer ever read — the toggle, the colour, the blur and both offsets all
 * changed a stored field and nothing on screen. It is now translated into the
 * drop-shadow effect it always described, which is what these assert.
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
  it('leaves an element without a legacy shadow alone', () => {
    const styles = [{ type: 'stroke' as const }];
    expect(elementStyles({ styles })).toBe(styles);
    expect(elementStyles({})).toBeUndefined();
  });

  it('appends the translated shadow to whatever effects exist', () => {
    const out = elementStyles({
      styles: [{ type: 'stroke' }],
      boxShadow: { color: '#123456', blur: 4, offsetX: 2, offsetY: 2 },
    })!;
    expect(out.map((s) => s.type)).toEqual(['stroke', 'drop-shadow']);
    expect(out[1].color).toBe('#123456');
  });

  it('lets a real drop-shadow effect win, so the visible control is the truth', () => {
    const styles = [{ type: 'drop-shadow' as const, color: '#00ff00' }];
    const out = elementStyles({ styles, boxShadow: { color: '#ff0000' } })!;
    expect(out).toHaveLength(1);
    expect(out[0].color).toBe('#00ff00');
  });

  it('still translates when the only drop-shadow effect is switched off', () => {
    const out = elementStyles({
      styles: [{ type: 'drop-shadow', enabled: false }],
      boxShadow: { color: '#ff0000' },
    })!;
    expect(out).toHaveLength(2);
    expect(out[1].color).toBe('#ff0000');
  });
});
