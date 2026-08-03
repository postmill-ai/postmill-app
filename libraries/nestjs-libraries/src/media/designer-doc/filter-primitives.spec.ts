import { describe, it, expect } from 'vitest';
import {
  emptyBuffer,
  cloneBuffer,
  sampleClamped,
  sampleBilinear,
  boxBlur,
  gaussianBlur,
  convolve,
  remap,
  rankFilter,
  hashRandom,
  hashGaussian,
  nearestCellMap,
  luminance,
  type PixelBuffer,
} from './filter-primitives';

const fillBuf = (w: number, h: number, rgba: [number, number, number, number]): PixelBuffer => {
  const buf = emptyBuffer(w, h);
  for (let i = 0; i < buf.data.length; i += 4) {
    buf.data[i] = rgba[0];
    buf.data[i + 1] = rgba[1];
    buf.data[i + 2] = rgba[2];
    buf.data[i + 3] = rgba[3];
  }
  return buf;
};

const setPx = (buf: PixelBuffer, x: number, y: number, rgba: number[]) => {
  const i = (y * buf.width + x) * 4;
  buf.data.set(rgba, i);
};
const getPx = (buf: PixelBuffer, x: number, y: number) => {
  const i = (y * buf.width + x) * 4;
  return [buf.data[i], buf.data[i + 1], buf.data[i + 2], buf.data[i + 3]];
};

describe('sampling', () => {
  it('clamps reads outside the image to the edge pixel', () => {
    const buf = emptyBuffer(2, 2);
    setPx(buf, 0, 0, [10, 20, 30, 255]);
    const out = [0, 0, 0, 0];
    sampleClamped(buf, -5, -5, out);
    expect(out).toEqual([10, 20, 30, 255]);
  });

  it('interpolates between neighbours', () => {
    const buf = emptyBuffer(2, 1);
    setPx(buf, 0, 0, [0, 0, 0, 255]);
    setPx(buf, 1, 0, [100, 100, 100, 255]);
    const out = [0, 0, 0, 0];
    sampleBilinear(buf, 0.5, 0, out);
    expect(out[0]).toBeCloseTo(50, 0);
  });
});

describe('blur', () => {
  it('leaves a flat image untouched', () => {
    const buf = fillBuf(8, 8, [120, 130, 140, 255]);
    const before = [...buf.data];
    boxBlur(buf, 3);
    expect([...buf.data]).toEqual(before);
  });

  it('spreads a single bright pixel into its neighbours', () => {
    const buf = fillBuf(9, 9, [0, 0, 0, 255]);
    setPx(buf, 4, 4, [255, 255, 255, 255]);
    boxBlur(buf, 1);
    expect(getPx(buf, 4, 4)[0]).toBeLessThan(255);
    expect(getPx(buf, 3, 4)[0]).toBeGreaterThan(0);
  });

  it('conserves overall brightness', () => {
    const buf = fillBuf(16, 16, [0, 0, 0, 255]);
    setPx(buf, 8, 8, [255, 0, 0, 255]);
    const before = buf.data.reduce((sum, v, i) => (i % 4 === 0 ? sum + v : sum), 0);
    boxBlur(buf, 2);
    const after = buf.data.reduce((sum, v, i) => (i % 4 === 0 ? sum + v : sum), 0);
    expect(Math.abs(after - before)).toBeLessThan(before * 0.1 + 5);
  });

  it('gaussian at sigma 0 is a no-op', () => {
    const buf = fillBuf(4, 4, [10, 20, 30, 255]);
    setPx(buf, 1, 1, [200, 0, 0, 255]);
    const before = [...buf.data];
    gaussianBlur(buf, 0);
    expect([...buf.data]).toEqual(before);
  });

  it('a bigger sigma blurs more', () => {
    const make = () => {
      const b = fillBuf(21, 21, [0, 0, 0, 255]);
      setPx(b, 10, 10, [255, 255, 255, 255]);
      return b;
    };
    const light = make();
    const heavy = make();
    gaussianBlur(light, 1);
    gaussianBlur(heavy, 4);
    expect(getPx(heavy, 10, 10)[0]).toBeLessThan(getPx(light, 10, 10)[0]);
  });
});

describe('convolve', () => {
  it('an identity kernel changes nothing', () => {
    const buf = fillBuf(5, 5, [40, 80, 120, 255]);
    setPx(buf, 2, 2, [200, 10, 10, 255]);
    const before = [...buf.data];
    convolve(buf, [0, 0, 0, 0, 1, 0, 0, 0, 0], 3);
    expect([...buf.data]).toEqual(before);
  });

  it('leaves alpha alone by default', () => {
    const buf = fillBuf(5, 5, [100, 100, 100, 128]);
    convolve(buf, [-1, -1, -1, -1, 9, -1, -1, -1, -1], 3);
    expect(getPx(buf, 2, 2)[3]).toBe(128);
  });
});

describe('remap', () => {
  it('reading from a fixed point floods that colour', () => {
    const buf = emptyBuffer(4, 4);
    setPx(buf, 0, 0, [255, 0, 0, 255]);
    remap(buf, () => ({ x: 0, y: 0 }));
    expect(getPx(buf, 3, 3)).toEqual([255, 0, 0, 255]);
  });

  it('the identity map is a no-op', () => {
    const buf = fillBuf(6, 6, [1, 2, 3, 255]);
    setPx(buf, 2, 3, [9, 9, 9, 255]);
    const before = [...buf.data];
    remap(buf, (x, y) => ({ x, y }));
    expect([...buf.data]).toEqual(before);
  });

  it('wraps when asked', () => {
    const buf = emptyBuffer(4, 1);
    setPx(buf, 0, 0, [255, 0, 0, 255]);
    remap(buf, (x) => ({ x: x + 4, y: 0 }), true);
    expect(getPx(buf, 0, 0)).toEqual([255, 0, 0, 255]);
  });
});

describe('rankFilter', () => {
  it('median removes an isolated speck', () => {
    const buf = fillBuf(7, 7, [50, 50, 50, 255]);
    setPx(buf, 3, 3, [255, 255, 255, 255]);
    rankFilter(buf, 1, 0.5);
    expect(getPx(buf, 3, 3)[0]).toBe(50);
  });

  it('leaves a flat image alone', () => {
    const buf = fillBuf(6, 6, [77, 88, 99, 255]);
    const before = [...buf.data];
    rankFilter(buf, 2, 0.5);
    expect([...buf.data]).toEqual(before);
  });

  it('a threshold protects pixels close to the median', () => {
    const buf = fillBuf(7, 7, [50, 50, 50, 255]);
    setPx(buf, 3, 3, [60, 60, 60, 255]);
    rankFilter(buf, 1, 0.5, 32);
    // Only 10 away from its neighbours, so the threshold keeps it.
    expect(getPx(buf, 3, 3)[0]).toBe(60);
  });
});

describe('deterministic randomness', () => {
  it('is stable for the same seed', () => {
    expect(hashRandom(42)).toBe(hashRandom(42));
    expect(hashGaussian(7)).toBe(hashGaussian(7));
  });

  it('differs between seeds', () => {
    expect(hashRandom(1)).not.toBe(hashRandom(2));
  });

  it('stays in range', () => {
    for (let i = 0; i < 500; i++) {
      const v = hashRandom(i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('nearestCellMap', () => {
  it('assigns every pixel a cell', () => {
    const map = nearestCellMap(20, 20, 5);
    expect(map).toHaveLength(400);
    expect([...map].every((v) => v >= 0)).toBe(true);
  });

  it('is deterministic', () => {
    expect([...nearestCellMap(16, 16, 4, 3)]).toEqual([...nearestCellMap(16, 16, 4, 3)]);
  });

  it('groups neighbouring pixels into the same cell', () => {
    const map = nearestCellMap(40, 40, 10);
    const distinct = new Set([...map]);
    // Far fewer regions than pixels — that is the whole point of the field.
    expect(distinct.size).toBeLessThan(100);
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe('luminance', () => {
  it('weights green most heavily', () => {
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(255, 0, 0));
    expect(luminance(255, 0, 0)).toBeGreaterThan(luminance(0, 0, 255));
  });
});

describe('cloneBuffer', () => {
  it('copies rather than aliases', () => {
    const buf = fillBuf(2, 2, [1, 2, 3, 4]);
    const copy = cloneBuffer(buf);
    copy.data[0] = 99;
    expect(buf.data[0]).toBe(1);
  });
});
