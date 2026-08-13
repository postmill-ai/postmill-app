import { describe, it, expect } from 'vitest';
import { fill, stroke, buildFillSource, type PixelBuffer } from './fill-stroke';

const buffer = (width: number, height: number, seed?: [number, number, number, number]): PixelBuffer => {
  const buf: PixelBuffer = {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
  if (seed) {
    for (let i = 0; i < buf.data.length; i += 4) {
      buf.data[i] = seed[0];
      buf.data[i + 1] = seed[1];
      buf.data[i + 2] = seed[2];
      buf.data[i + 3] = seed[3];
    }
  }
  return buf;
};

const px = (buf: PixelBuffer, x: number, y: number) => {
  const i = (y * buf.width + x) * 4;
  return [buf.data[i], buf.data[i + 1], buf.data[i + 2], buf.data[i + 3]];
};

const solid = (n: number) => {
  const c = new Uint8ClampedArray(n);
  c.fill(255);
  return c;
};

describe('fill', () => {
  it('paints the chosen colour where coverage says to', () => {
    const target = buffer(3, 1);
    const coverage = new Uint8ClampedArray([0, 255, 0]);
    fill(target, coverage, { contents: 'color', color: '#ff0000' });

    expect(px(target, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(px(target, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(px(target, 2, 0)).toEqual([0, 0, 0, 0]);
  });

  it('honours the fixed Contents entries', () => {
    const white = buffer(1, 1);
    fill(white, solid(1), { contents: 'white' });
    expect(px(white, 0, 0).slice(0, 3)).toEqual([255, 255, 255]);

    const gray = buffer(1, 1);
    fill(gray, solid(1), { contents: 'gray' });
    expect(px(gray, 0, 0).slice(0, 3)).toEqual([128, 128, 128]);
  });

  it('applies partial coverage as partial alpha, so a feathered edge stays soft', () => {
    const target = buffer(2, 1);
    fill(target, new Uint8ClampedArray([128, 255]), {
      contents: 'color',
      color: '#ffffff',
    });
    // Half coverage over transparent black lands halfway.
    expect(px(target, 0, 0)[3]).toBeLessThan(px(target, 1, 0)[3]);
    expect(px(target, 0, 0)[0]).toBeGreaterThan(0);
  });

  it('respects opacity', () => {
    const opaque = buffer(1, 1, [0, 0, 0, 255]);
    fill(opaque, solid(1), { contents: 'white', opacity: 0.5 });
    const [r] = px(opaque, 0, 0);
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(160);
  });

  it('preserves transparency when asked — a fill cannot square off a shape', () => {
    // Left pixel is opaque, right is empty.
    const target = buffer(2, 1);
    target.data[3] = 255;
    fill(target, solid(2), {
      contents: 'color',
      color: '#00ff00',
      preserveTransparency: true,
    });

    expect(px(target, 0, 0)).toEqual([0, 255, 0, 255]);
    // The empty pixel stays empty.
    expect(px(target, 1, 0)[3]).toBe(0);
  });

  it('leaves everything alone with empty coverage', () => {
    const target = buffer(4, 4, [10, 20, 30, 255]);
    const before = [...target.data];
    fill(target, new Uint8ClampedArray(16), { contents: 'white' });
    expect([...target.data]).toEqual(before);
  });

  it('blends rather than replacing when given a blend mode', () => {
    const target = buffer(1, 1, [200, 200, 200, 255]);
    fill(target, solid(1), {
      contents: 'gray',
      blendMode: 'multiply',
    });
    // 200 × 128/255 ≈ 100 — darker than either input, which is the point.
    expect(px(target, 0, 0)[0]).toBeLessThan(150);
  });
});

describe('buildFillSource', () => {
  it('tiles a pattern by wrapping', () => {
    const pattern: PixelBuffer = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]),
    };
    const src = buildFillSource(4, 1, solid(4), { contents: 'pattern', pattern });
    expect(px(src, 0, 0).slice(0, 3)).toEqual([255, 0, 0]);
    expect(px(src, 1, 0).slice(0, 3)).toEqual([0, 0, 255]);
    // Wraps at the tile width.
    expect(px(src, 2, 0).slice(0, 3)).toEqual([255, 0, 0]);
  });
});

describe('stroke', () => {
  it('paints only the band it is given', () => {
    const target = buffer(3, 1);
    stroke(target, new Uint8ClampedArray([255, 0, 255]), {
      color: '#0000ff',
      width: 1,
      location: 'inside',
    });
    expect(px(target, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(px(target, 1, 0)[3]).toBe(0);
    expect(px(target, 2, 0)).toEqual([0, 0, 255, 255]);
  });
});
