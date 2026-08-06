import { describe, it, expect } from 'vitest';
import { createCanvas } from 'canvas';
import {
  applyFilterTokens,
  applyFilterTokensToCanvas,
  blurFilterRadius,
  hasFilterEffect,
} from './filter-pixels';

/**
 * The server set `ctx.filter = 'grayscale(100%)…'`, which node-canvas accepts
 * and ignores, so every image filter vanished from every export. The client
 * mapped the same tokens onto Konva's filters, whose units are not CSS's, so a
 * 0.5 brightness *brightened*. These pin the one implementation that replaced
 * both — on real pixels, because the previous test asserted against a mocked
 * context and that is exactly how the bug survived.
 */

const pixel = (rgb: [number, number, number]): Uint8ClampedArray =>
  new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], 255]);

const rgb = (data: Uint8ClampedArray): number[] => [data[0], data[1], data[2]];

describe('applyFilterTokens', () => {
  it('grayscale collapses a colour to its luminance', () => {
    const d = pixel([255, 0, 0]);
    applyFilterTokens(d, ['grayscale']);
    // Spec luminance of pure red is 0.213 — the same value on every channel.
    expect(rgb(d)[0]).toBe(rgb(d)[1]);
    expect(rgb(d)[1]).toBe(rgb(d)[2]);
    expect(rgb(d)[0]).toBeCloseTo(255 * 0.213, -1);
  });

  it('brightness above 1 lightens and below 1 darkens', () => {
    // The whole point: Konva's Brighten was neutral at 0, so 0.5 used to
    // brighten. CSS brightness is a multiplier.
    const dark = pixel([100, 100, 100]);
    applyFilterTokens(dark, ['brightness:0.5']);
    expect(rgb(dark)[0]).toBe(50);

    const light = pixel([100, 100, 100]);
    applyFilterTokens(light, ['brightness:1.5']);
    expect(rgb(light)[0]).toBe(150);
  });

  it('brightness of 1 changes nothing', () => {
    const d = pixel([37, 111, 200]);
    applyFilterTokens(d, ['brightness:1']);
    expect(rgb(d)).toEqual([37, 111, 200]);
  });

  it('contrast pivots around mid grey', () => {
    const above = pixel([200, 200, 200]);
    const below = pixel([50, 50, 50]);
    applyFilterTokens(above, ['contrast:2']);
    applyFilterTokens(below, ['contrast:2']);
    expect(rgb(above)[0]).toBeGreaterThan(200);
    expect(rgb(below)[0]).toBeLessThan(50);

    // Mid grey is the fixed point — exactly 127.5, which no integer channel can
    // sit on, so it moves by at most a rounding step however hard it is pushed.
    const mid = pixel([128, 128, 128]);
    applyFilterTokens(mid, ['contrast:3']);
    expect(Math.abs(rgb(mid)[0] - 128)).toBeLessThanOrEqual(2);
  });

  it('saturate 0 is the same as grayscale', () => {
    const a = pixel([12, 200, 90]);
    const b = pixel([12, 200, 90]);
    applyFilterTokens(a, ['saturate:0']);
    applyFilterTokens(b, ['grayscale']);
    expect(rgb(a)).toEqual(rgb(b));
  });

  it('sepia warms the image', () => {
    const d = pixel([128, 128, 128]);
    applyFilterTokens(d, ['sepia']);
    const [r, g, b] = rgb(d);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('applies a stack in order', () => {
    const d = pixel([200, 100, 50]);
    applyFilterTokens(d, ['grayscale', 'brightness:0.5']);
    const [r, g, b] = rgb(d);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeLessThan(128);
  });

  it('ignores an unparseable token instead of throwing', () => {
    const d = pixel([10, 20, 30]);
    expect(() => applyFilterTokens(d, ['nonsense', 'brightness:'])).not.toThrow();
    expect(rgb(d)).toEqual([10, 20, 30]);
  });

  it('leaves alpha alone', () => {
    const d = new Uint8ClampedArray([200, 100, 50, 128]);
    applyFilterTokens(d, ['grayscale', 'contrast:2']);
    expect(d[3]).toBe(128);
  });
});

describe('blurFilterRadius', () => {
  it('reads the radius out of the token list', () => {
    expect(blurFilterRadius(['grayscale', 'blur:6'])).toBe(6);
  });

  it('is zero when there is no blur', () => {
    expect(blurFilterRadius(['grayscale'])).toBe(0);
    expect(blurFilterRadius(undefined)).toBe(0);
  });
});

describe('hasFilterEffect', () => {
  it('is false for an empty or unparseable list', () => {
    expect(hasFilterEffect(undefined)).toBe(false);
    expect(hasFilterEffect([])).toBe(false);
    expect(hasFilterEffect(['nope'])).toBe(false);
  });

  it('is true for a real token', () => {
    expect(hasFilterEffect(['sepia'])).toBe(true);
  });
});

describe('applyFilterTokensToCanvas', () => {
  const solid = (colour: string) => {
    const canvas = createCanvas(20, 20);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, 20, 20);
    return canvas;
  };
  const at = (canvas: any, x: number, y: number) => {
    const d = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2]];
  };

  it('actually changes pixels on a node-canvas surface', () => {
    // The regression that mattered: this used to be a no-op server-side.
    const canvas = solid('#ff0000');
    applyFilterTokensToCanvas(canvas, ['grayscale']);
    const [r, g, b] = at(canvas, 10, 10);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('blurs as part of the same stack', () => {
    const canvas = createCanvas(60, 60);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(20, 20, 20, 20);
    expect(at(canvas, 12, 30)[0]).toBe(0);
    const before = canvas.getContext('2d').getImageData(12, 30, 1, 1).data[3];
    applyFilterTokensToCanvas(canvas, ['blur:5']);
    const after = canvas.getContext('2d').getImageData(12, 30, 1, 1).data[3];
    expect(after).toBeGreaterThan(before);
  });

  it('does nothing for a list with no real tokens', () => {
    const canvas = solid('#123456');
    applyFilterTokensToCanvas(canvas, ['bogus']);
    expect(at(canvas, 5, 5)).toEqual([0x12, 0x34, 0x56]);
  });
});
