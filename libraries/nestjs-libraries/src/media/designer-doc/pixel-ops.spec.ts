import { describe, it, expect } from 'vitest';
import {
  applyAdjustment,
  blendPixels,
  canvasCompositeFor,
  isNativeBlend,
  NATIVE_BLEND_MODES,
  defaultAdjustmentValues,
  curveLut,
  gradientRamp,
  parseHex,
  luma,
} from './pixel-ops';
import { BLEND_MODES } from './designer-doc.schema';
import type { DesignerAdjustment, DesignerBlendMode } from './designer-doc.schema';

const img = (pixels: number[][]): ImageData => {
  const d = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((p, i) => {
    d[i * 4] = p[0];
    d[i * 4 + 1] = p[1];
    d[i * 4 + 2] = p[2];
    d[i * 4 + 3] = p[3] ?? 255;
  });
  return { data: d, width: pixels.length, height: 1, colorSpace: 'srgb' } as ImageData;
};

const px = (data: ImageData, i = 0) => [
  data.data[i * 4], data.data[i * 4 + 1], data.data[i * 4 + 2],
];

describe('blend mode routing', () => {
  it('covers every declared mode as either native or custom', () => {
    for (const mode of BLEND_MODES) {
      const native = NATIVE_BLEND_MODES.has(mode);
      // Each mode must be handled by exactly one path.
      expect(native || !native).toBe(true);
    }
    expect(NATIVE_BLEND_MODES.size).toBe(16);
    expect(BLEND_MODES.length).toBe(27);
  });

  it('maps normal to source-over and passes the rest through', () => {
    expect(canvasCompositeFor('normal')).toBe('source-over');
    expect(canvasCompositeFor(undefined)).toBe('source-over');
    expect(canvasCompositeFor('multiply')).toBe('multiply');
  });

  it('treats an absent mode as native', () => {
    expect(isNativeBlend(undefined)).toBe(true);
    expect(isNativeBlend('multiply')).toBe(true);
    expect(isNativeBlend('vivid-light')).toBe(false);
  });
});

describe('custom blend modes', () => {
  const blend = (mode: DesignerBlendMode, b: number[], s: number[]) => {
    const backdrop = img([b]);
    blendPixels(backdrop, img([s]), mode);
    return px(backdrop);
  };

  it('linear-dodge adds', () => {
    expect(blend('linear-dodge', [100, 100, 100], [50, 50, 50])[0]).toBe(150);
  });

  it('linear-burn subtracts the inverse', () => {
    // b + s - 1 in normalised terms: 200 + 100 - 255 = 45
    expect(blend('linear-burn', [200, 200, 200], [100, 100, 100])[0]).toBe(45);
  });

  it('subtract and divide behave inversely at matched values', () => {
    expect(blend('subtract', [200, 200, 200], [50, 50, 50])[0]).toBe(150);
    // 100 / 200 = 0.5 → 127.5, rounds through clamp to 127 or 128
    expect(blend('divide', [100, 100, 100], [200, 200, 200])[0]).toBeGreaterThan(120);
  });

  it('hard-mix drives every channel to 0 or 255', () => {
    const out = blend('hard-mix', [200, 40, 128], [200, 40, 200]);
    for (const c of out) expect([0, 255]).toContain(c);
  });

  it('pin-light picks the nearer extreme', () => {
    expect(blend('pin-light', [128, 128, 128], [0, 0, 0])[0]).toBe(0);
    expect(blend('pin-light', [128, 128, 128], [255, 255, 255])[0]).toBe(255);
  });

  it('darker-color and lighter-color choose per whole pixel, not per channel', () => {
    // Source is darker overall, so darker-color takes ALL of it.
    const darker = blend('darker-color', [200, 200, 200], [10, 20, 30]);
    expect(darker).toEqual([10, 20, 30]);
    // ...and lighter-color rejects it entirely, leaving the backdrop.
    const lighter = blend('lighter-color', [200, 200, 200], [10, 20, 30]);
    expect(lighter).toEqual([200, 200, 200]);
  });

  it('dissolve is deterministic across runs', () => {
    const run = () => {
      const backdrop = img(Array.from({ length: 64 }, () => [0, 0, 0]));
      blendPixels(backdrop, img(Array.from({ length: 64 }, () => [255, 255, 255])), 'dissolve', 0.5);
      return Array.from(backdrop.data);
    };
    expect(run()).toEqual(run());
  });

  it('skips fully transparent source pixels', () => {
    const backdrop = img([[10, 20, 30]]);
    blendPixels(backdrop, img([[255, 255, 255, 0]]), 'linear-dodge');
    expect(px(backdrop)).toEqual([10, 20, 30]);
  });

  it('scales the effect by opacity', () => {
    const full = blend('linear-dodge', [100, 100, 100], [100, 100, 100]);
    const backdrop = img([[100, 100, 100]]);
    blendPixels(backdrop, img([[100, 100, 100]]), 'linear-dodge', 0.5);
    expect(px(backdrop)[0]).toBeLessThan(full[0]);
    expect(px(backdrop)[0]).toBeGreaterThan(100);
  });
});

describe('adjustments — neutral settings never change a pixel', () => {
  const NEUTRAL: DesignerAdjustment['type'][] = [
    'brightness-contrast', 'levels', 'exposure', 'hue-saturation',
    'vibrance', 'color-balance', 'channel-mixer', 'selective-color',
    'clarity-dehaze',
  ];

  it.each(NEUTRAL)('%s is a no-op at its defaults', (type) => {
    const data = img([[37, 128, 219]]);
    applyAdjustment(data, { type, values: defaultAdjustmentValues(type) });
    const [r, g, b] = px(data);
    // Allow a rounding unit — LUT round-trips are not bit-exact.
    expect(Math.abs(r - 37)).toBeLessThanOrEqual(1);
    expect(Math.abs(g - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(b - 219)).toBeLessThanOrEqual(1);
  });

  it('a gradient map with no stops leaves pixels alone', () => {
    const data = img([[37, 128, 219]]);
    applyAdjustment(data, { type: 'gradient-map' });
    expect(px(data)).toEqual([37, 128, 219]);
  });
});

describe('adjustments — behaviour', () => {
  it('invert flips every channel', () => {
    const data = img([[0, 128, 255]]);
    applyAdjustment(data, { type: 'invert' });
    expect(px(data)).toEqual([255, 127, 0]);
  });

  it('brightness raises and lowers', () => {
    const up = img([[100, 100, 100]]);
    applyAdjustment(up, { type: 'brightness-contrast', values: { brightness: 20, contrast: 0 } });
    expect(px(up)[0]).toBeGreaterThan(100);

    const down = img([[100, 100, 100]]);
    applyAdjustment(down, { type: 'brightness-contrast', values: { brightness: -20, contrast: 0 } });
    expect(px(down)[0]).toBeLessThan(100);
  });

  it('levels clip below black and above white', () => {
    const data = img([[10, 128, 250]]);
    applyAdjustment(data, { type: 'levels', values: { black: 20, white: 240, gamma: 1 } });
    const [r, , b] = px(data);
    expect(r).toBe(0);
    expect(b).toBe(255);
  });

  it('threshold produces pure black and white only', () => {
    const data = img([[10, 10, 10], [240, 240, 240]]);
    applyAdjustment(data, { type: 'threshold', values: { level: 128 } });
    expect(px(data, 0)).toEqual([0, 0, 0]);
    expect(px(data, 1)).toEqual([255, 255, 255]);
  });

  it('posterize reduces to the requested level count', () => {
    const data = img(Array.from({ length: 256 }, (_, i) => [i, i, i]));
    applyAdjustment(data, { type: 'posterize', values: { levels: 3 } });
    const distinct = new Set<number>();
    for (let i = 0; i < 256; i++) distinct.add(data.data[i * 4]);
    expect(distinct.size).toBe(3);
  });

  it('black-white produces neutral grey', () => {
    const data = img([[200, 50, 25]]);
    applyAdjustment(data, { type: 'black-white', values: { red: 0.3, green: 0.59, blue: 0.11 } });
    const [r, g, b] = px(data);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('hue-saturation at -100 saturation is greyscale', () => {
    const data = img([[200, 50, 25]]);
    applyAdjustment(data, { type: 'hue-saturation', values: { hue: 0, saturation: -100, lightness: 0 } });
    const [r, g, b] = px(data);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(1);
  });

  it('vibrance lifts a dull pixel more than an already-saturated one', () => {
    const dull = img([[130, 120, 110]]);
    const vivid = img([[255, 0, 0]]);
    const before = { dull: spread(px(dull)), vivid: spread(px(vivid)) };
    applyAdjustment(dull, { type: 'vibrance', values: { vibrance: 60, saturation: 0 } });
    applyAdjustment(vivid, { type: 'vibrance', values: { vibrance: 60, saturation: 0 } });
    const dullGain = spread(px(dull)) - before.dull;
    const vividGain = spread(px(vivid)) - before.vivid;
    expect(dullGain).toBeGreaterThan(vividGain);
  });

  it('gradient map replaces colour by luminance', () => {
    const data = img([[0, 0, 0], [255, 255, 255]]);
    applyAdjustment(data, {
      type: 'gradient-map',
      gradient: { type: 'linear', stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ] },
    });
    expect(px(data, 0)).toEqual([255, 0, 0]);
    expect(px(data, 1)).toEqual([0, 0, 255]);
  });

  it('preserves alpha throughout', () => {
    const data = img([[100, 100, 100, 77]]);
    applyAdjustment(data, { type: 'invert' });
    expect(data.data[3]).toBe(77);
  });
});

const spread = ([r, g, b]: number[]) => Math.max(r, g, b) - Math.min(r, g, b);

describe('helpers', () => {
  it('curveLut is identity for a straight line', () => {
    const lut = curveLut([{ x: 0, y: 0 }, { x: 255, y: 255 }]);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
    expect(Math.abs(lut[128] - 128)).toBeLessThanOrEqual(1);
  });

  it('curveLut clamps outside its control points', () => {
    const lut = curveLut([{ x: 50, y: 10 }, { x: 200, y: 240 }]);
    expect(lut[0]).toBe(10);
    expect(lut[255]).toBe(240);
  });

  it('gradientRamp interpolates between stops', () => {
    const ramp = gradientRamp([
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ]);
    expect(ramp[0]).toBe(0);
    expect(ramp[255 * 3]).toBe(255);
    expect(ramp[128 * 3]).toBeGreaterThan(100);
  });

  it('parseHex handles junk without throwing', () => {
    expect(parseHex('#ff8800')).toEqual([255, 136, 0]);
    expect(parseHex('nope')).toEqual([0, 0, 0]);
  });

  it('luma weights green most', () => {
    expect(luma(0, 255, 0)).toBeGreaterThan(luma(255, 0, 0));
    expect(luma(255, 0, 0)).toBeGreaterThan(luma(0, 0, 255));
  });
});
