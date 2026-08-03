import { describe, it, expect } from 'vitest';
import {
  STYLE_ORDER,
  UNDER_STYLES,
  orderedStyles,
  splitStyles,
  styleOffset,
  styleBlur,
  stylePadding,
  isStyleEnabled,
  DEFAULT_GLOBAL_LIGHT,
} from './layer-styles';
import type { DesignerLayerStyle } from './designer-doc.schema';

const style = (over: Partial<DesignerLayerStyle> & { type: DesignerLayerStyle['type'] }) =>
  over as DesignerLayerStyle;

describe('paint order', () => {
  it('lists every effect exactly once', () => {
    expect(new Set(STYLE_ORDER).size).toBe(STYLE_ORDER.length);
    expect(STYLE_ORDER).toHaveLength(10);
  });

  it('puts shadow and outer glow beneath the layer, stroke last', () => {
    expect(UNDER_STYLES.has('drop-shadow')).toBe(true);
    expect(UNDER_STYLES.has('outer-glow')).toBe(true);
    expect(UNDER_STYLES.has('stroke')).toBe(false);
    expect(STYLE_ORDER[STYLE_ORDER.length - 1]).toBe('stroke');
  });

  it('sorts an arbitrary style list into canonical order', () => {
    const sorted = orderedStyles([
      style({ type: 'stroke' }),
      style({ type: 'drop-shadow' }),
      style({ type: 'color-overlay' }),
    ]);
    expect(sorted.map((s) => s.type)).toEqual(['drop-shadow', 'color-overlay', 'stroke']);
  });

  it('drops disabled styles', () => {
    const sorted = orderedStyles([
      style({ type: 'stroke', enabled: false }),
      style({ type: 'drop-shadow' }),
    ]);
    expect(sorted.map((s) => s.type)).toEqual(['drop-shadow']);
  });

  it('treats a missing enabled flag as on', () => {
    expect(isStyleEnabled(style({ type: 'stroke' }))).toBe(true);
    expect(isStyleEnabled(style({ type: 'stroke', enabled: false }))).toBe(false);
  });

  it('splits under and over correctly', () => {
    const { under, over } = splitStyles([
      style({ type: 'stroke' }),
      style({ type: 'drop-shadow' }),
      style({ type: 'inner-glow' }),
      style({ type: 'outer-glow' }),
    ]);
    expect(under.map((s) => s.type)).toEqual(['drop-shadow', 'outer-glow']);
    expect(over.map((s) => s.type)).toEqual(['inner-glow', 'stroke']);
  });

  it('handles no styles', () => {
    expect(orderedStyles(undefined)).toEqual([]);
    expect(splitStyles(undefined)).toEqual({ under: [], over: [] });
  });
});

describe('styleOffset', () => {
  it('casts the shadow OPPOSITE the light, not toward it', () => {
    // Photoshop's angle says where the light is; 0° = light from the east, so
    // the shadow falls west (negative x). Getting this backwards mirrors every
    // shadow in the document.
    const at0 = styleOffset(style({ type: 'drop-shadow', angle: 0, distance: 10 }));
    expect(at0.x).toBeCloseTo(-10);
    expect(at0.y).toBeCloseTo(0);
  });

  it('points down-right for the 120° default', () => {
    const o = styleOffset(style({ type: 'drop-shadow', angle: 120, distance: 10 }));
    expect(o.x).toBeGreaterThan(0);
    expect(o.y).toBeGreaterThan(0);
  });

  it('follows the global light when asked', () => {
    const followed = styleOffset(
      style({ type: 'drop-shadow', useGlobalLight: true, angle: 0, distance: 10 }),
      90
    );
    const explicit = styleOffset(style({ type: 'drop-shadow', angle: 90, distance: 10 }));
    expect(followed).toEqual(explicit);
  });

  it('defaults to the standard light angle', () => {
    const o = styleOffset(style({ type: 'drop-shadow', distance: 10 }));
    const expected = styleOffset(
      style({ type: 'drop-shadow', angle: DEFAULT_GLOBAL_LIGHT, distance: 10 })
    );
    expect(o).toEqual(expected);
  });

  it('is zero with no distance', () => {
    expect(styleOffset(style({ type: 'drop-shadow', angle: 45 }))).toEqual({ x: -0, y: 0 });
  });
});

describe('styleBlur', () => {
  it('is the size when spread is zero', () => {
    expect(styleBlur(style({ type: 'outer-glow', size: 12 }))).toBe(12);
  });

  it('trades blur for solidity as spread rises', () => {
    expect(styleBlur(style({ type: 'outer-glow', size: 10, spread: 50 }))).toBeCloseTo(5);
    expect(styleBlur(style({ type: 'outer-glow', size: 10, spread: 100 }))).toBe(0);
  });

  it('never goes negative', () => {
    expect(styleBlur(style({ type: 'outer-glow', size: 0, spread: 100 }))).toBe(0);
  });
});

describe('stylePadding', () => {
  it('is zero without styles', () => {
    expect(stylePadding(undefined)).toBe(0);
    expect(stylePadding([])).toBe(0);
  });

  it('covers the furthest-reaching effect', () => {
    const pad = stylePadding([
      style({ type: 'drop-shadow', distance: 10, size: 8, angle: 180 }),
      style({ type: 'outer-glow', size: 4 }),
    ]);
    expect(pad).toBeGreaterThanOrEqual(18);
  });

  it('ignores disabled effects', () => {
    expect(
      stylePadding([style({ type: 'drop-shadow', distance: 100, size: 50, enabled: false })])
    ).toBe(0);
  });
});
