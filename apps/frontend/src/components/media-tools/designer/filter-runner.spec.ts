import { describe, it, expect } from 'vitest';
import { blendThroughCoverage } from './filter-runner';

// jsdom has no `ImageData` constructor, and the function is structural.
const image = (w: number, h: number, v: number) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { width: w, height: h, data };
};

describe('blendThroughCoverage', () => {
  it('leaves pixels outside the selection BYTE-identical', () => {
    // The whole point of a selection: a filter must not touch what is not
    // selected, not even by a rounding error.
    const target = image(4, 1, 10);
    const filtered = image(4, 1, 250);
    const coverage = new Uint8ClampedArray([0, 255, 0, 0]);

    blendThroughCoverage(target, filtered, coverage);

    expect(target.data[0]).toBe(10);
    expect(target.data[8]).toBe(10);
    expect(target.data[12]).toBe(10);
    expect(target.data[4]).toBe(250);
  });

  it('replaces fully-covered pixels exactly', () => {
    const target = image(2, 1, 0);
    const filtered = image(2, 1, 123);
    blendThroughCoverage(target, filtered, new Uint8ClampedArray([255, 255]));
    expect([...target.data.slice(0, 4)]).toEqual([123, 123, 123, 255]);
  });

  it('blends partial coverage instead of stepping', () => {
    const target = image(1, 1, 0);
    const filtered = image(1, 1, 200);
    blendThroughCoverage(target, filtered, new Uint8ClampedArray([128]));
    expect(target.data[0]).toBeGreaterThan(90);
    expect(target.data[0]).toBeLessThan(110);
  });

  it('does nothing at all with empty coverage', () => {
    const target = image(3, 3, 42);
    const before = [...target.data];
    blendThroughCoverage(target, image(3, 3, 255), new Uint8ClampedArray(9));
    expect([...target.data]).toEqual(before);
  });

  it('carries alpha through', () => {
    const target = image(1, 1, 0);
    const filtered = image(1, 1, 0);
    filtered.data[3] = 0;
    blendThroughCoverage(target, filtered, new Uint8ClampedArray([255]));
    expect(target.data[3]).toBe(0);
  });

  it('is a full replacement when everything is selected', () => {
    const target = image(4, 4, 5);
    const filtered = image(4, 4, 77);
    const coverage = new Uint8ClampedArray(16);
    coverage.fill(255);
    blendThroughCoverage(target, filtered, coverage);
    expect([...target.data]).toEqual([...filtered.data]);
  });
});
