import { describe, it, expect } from 'vitest';
import { applyFilter, IMPLEMENTED_FILTERS } from './filter-ops';
import { emptyBuffer, type PixelBuffer } from './filter-primitives';
import {
  FILTER_DESCRIPTORS,
  defaultFilterParams,
  filterById,
  filtersInFamily,
  FILTER_FAMILY_ORDER,
} from './filter-descriptors';

/**
 * A deterministic test image with edges, gradients, texture and colour.
 *
 * Deliberately NOT two flat regions: an edge-preserving filter is correctly a
 * no-op on a two-tone image (every neighbour is either identical or beyond the
 * threshold), so a purely synthetic image would report Smart Blur and Surface
 * Blur as broken when they are working exactly as specified.
 */
const testImage = (w = 48, h = 48): PixelBuffer => {
  const buf = emptyBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inSquare = x > w / 4 && x < (w * 3) / 4 && y > h / 4 && y < (h * 3) / 4;
      // Gradient + a little deterministic texture, so smoothing has something
      // to smooth and sharpening has something to find.
      const ramp = (x / w) * 60;
      const grain = ((x * 7 + y * 13) % 11) * 3;
      buf.data[i] = clampByte((inSquare ? 200 : 40) + ramp + grain);
      buf.data[i + 1] = clampByte((inSquare ? 120 : 60) + ramp - grain);
      buf.data[i + 2] = clampByte((inSquare ? 60 : 190) - ramp + grain);
      buf.data[i + 3] = 255;
    }
  }
  return buf;
};

const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

const flat = (w = 16, h = 16, v = 128): PixelBuffer => {
  const buf = emptyBuffer(w, h);
  for (let i = 0; i < buf.data.length; i += 4) {
    buf.data[i] = v;
    buf.data[i + 1] = v;
    buf.data[i + 2] = v;
    buf.data[i + 3] = 255;
  }
  return buf;
};

const checksum = (buf: PixelBuffer) =>
  buf.data.reduce((a, v, i) => a + v * ((i % 7) + 1), 0);

describe('the filter catalogue', () => {
  it('describes exactly the 47 filters the menu promises', () => {
    expect(FILTER_DESCRIPTORS).toHaveLength(47);
  });

  it('has the right shape per family', () => {
    expect(filtersInFamily('blur')).toHaveLength(10);
    expect(filtersInFamily('distort')).toHaveLength(9);
    expect(filtersInFamily('noise')).toHaveLength(5);
    expect(filtersInFamily('pixelate')).toHaveLength(7);
    expect(filtersInFamily('sharpen')).toHaveLength(5);
    expect(filtersInFamily('stylize')).toHaveLength(9);
    expect(filtersInFamily('video')).toHaveLength(2);
  });

  it('covers every family in the menu order', () => {
    const described = new Set(FILTER_DESCRIPTORS.map((f) => f.family));
    expect([...described].sort()).toEqual([...FILTER_FAMILY_ORDER].sort());
  });

  it('has a unique id for every filter', () => {
    const ids = FILTER_DESCRIPTORS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('implements every filter it describes, and describes every one it implements', () => {
    // The two lists drifting apart is how a menu item becomes a silent no-op.
    const described = FILTER_DESCRIPTORS.map((f) => f.id).sort();
    expect([...IMPLEMENTED_FILTERS].sort()).toEqual(described);
  });

  it('gives every parameter a default inside its own range', () => {
    for (const f of FILTER_DESCRIPTORS) {
      for (const p of f.params) {
        if (p.type === 'number' || p.type === 'angle') {
          expect(typeof p.default, `${f.id}.${p.key}`).toBe('number');
          if (p.min !== undefined) expect(p.default as number).toBeGreaterThanOrEqual(p.min);
          if (p.max !== undefined) expect(p.default as number).toBeLessThanOrEqual(p.max);
        }
        if (p.type === 'select') {
          const values = (p.options || []).map((o) => o.value);
          expect(values, `${f.id}.${p.key}`).toContain(p.default as string);
        }
      }
    }
  });

  it('marks a filter immediate only when it has nothing to configure', () => {
    for (const f of FILTER_DESCRIPTORS) {
      if (f.immediate) expect(f.params, f.id).toHaveLength(0);
    }
  });
});

describe('every filter, at its defaults', () => {
  for (const descriptor of FILTER_DESCRIPTORS) {
    describe(descriptor.label, () => {
      it('runs and leaves the buffer the same size', () => {
        const buf = testImage();
        const before = buf.data.length;
        applyFilter(buf, descriptor.id, defaultFilterParams(descriptor.id));
        expect(buf.data.length).toBe(before);
      });

      it('keeps every channel in range', () => {
        const buf = testImage();
        applyFilter(buf, descriptor.id, defaultFilterParams(descriptor.id));
        for (const v of buf.data) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
        }
      });

      it('is deterministic — the same input twice gives the same pixels', () => {
        // Anything using randomness must be seeded, or an export would stop
        // matching the canvas that produced it.
        const a = testImage();
        const b = testImage();
        applyFilter(a, descriptor.id, defaultFilterParams(descriptor.id));
        applyFilter(b, descriptor.id, defaultFilterParams(descriptor.id));
        expect([...a.data]).toEqual([...b.data]);
      });

      it('actually does something', () => {
        // A filter that never changes a pixel is a bug, not a feature.
        const buf = testImage();
        const before = checksum(buf);
        applyFilter(buf, descriptor.id, defaultFilterParams(descriptor.id));
        expect(checksum(buf)).not.toBe(before);
      });
    });
  }
});

describe('blur behaviour', () => {
  it('leaves a flat image flat', () => {
    for (const id of ['blur', 'blur-more', 'box-blur', 'gaussian-blur', 'median', 'despeckle']) {
      const buf = flat();
      applyFilter(buf, id, defaultFilterParams(id));
      const values = new Set([...buf.data].filter((_, i) => i % 4 === 0));
      expect(values.size, id).toBe(1);
    }
  });

  it('gaussian at radius 0 changes nothing', () => {
    const buf = testImage();
    const before = [...buf.data];
    applyFilter(buf, 'gaussian-blur', { radius: 0 });
    expect([...buf.data]).toEqual(before);
  });

  it('a larger radius blurs harder', () => {
    const contrast = (buf: PixelBuffer) => {
      let min = 255;
      let max = 0;
      for (let i = 0; i < buf.data.length; i += 4) {
        min = Math.min(min, buf.data[i]);
        max = Math.max(max, buf.data[i]);
      }
      return max - min;
    };
    const light = testImage();
    const heavy = testImage();
    applyFilter(light, 'gaussian-blur', { radius: 1 });
    applyFilter(heavy, 'gaussian-blur', { radius: 6 });
    expect(contrast(heavy)).toBeLessThan(contrast(light));
  });

  it('smart and surface blur keep edges that a plain blur would soften', () => {
    const edgeStrength = (buf: PixelBuffer) => {
      let total = 0;
      for (let y = 0; y < buf.height; y++) {
        for (let x = 1; x < buf.width; x++) {
          const i = (y * buf.width + x) * 4;
          total += Math.abs(buf.data[i] - buf.data[i - 4]);
        }
      }
      return total;
    };
    const plain = testImage();
    const smart = testImage();
    applyFilter(plain, 'gaussian-blur', { radius: 4 });
    applyFilter(smart, 'surface-blur', { radius: 4, threshold: 15 });
    expect(edgeStrength(smart)).toBeGreaterThan(edgeStrength(plain));
  });
});

describe('distort behaviour', () => {
  it('twirl at 0° is a no-op', () => {
    const buf = testImage();
    const before = [...buf.data];
    applyFilter(buf, 'twirl', { angle: 0 });
    expect([...buf.data]).toEqual(before);
  });

  it('pinch and spherize at 0 leave the image alone', () => {
    for (const id of ['pinch', 'spherize']) {
      const buf = testImage();
      const before = [...buf.data];
      applyFilter(buf, id, { amount: 0 });
      expect([...buf.data], id).toEqual(before);
    }
  });

  it('polar coordinates round-trips back towards the original', () => {
    const original = testImage(32, 32);
    const buf = testImage(32, 32);
    applyFilter(buf, 'polar-coordinates', { mode: 'rect-to-polar' });
    applyFilter(buf, 'polar-coordinates', { mode: 'polar-to-rect' });
    // Resampling twice loses precision, so this is a similarity check, not
    // equality — but a broken transform lands nowhere near.
    let diff = 0;
    for (let i = 0; i < buf.data.length; i += 4) {
      diff += Math.abs(buf.data[i] - original.data[i]);
    }
    expect(diff / (buf.data.length / 4)).toBeLessThan
      (120);
  });
});

describe('noise behaviour', () => {
  it('monochromatic noise shifts every channel equally', () => {
    const buf = flat(8, 8, 128);
    applyFilter(buf, 'add-noise', { amount: 40, distribution: 'uniform', monochromatic: true });
    for (let i = 0; i < buf.data.length; i += 4) {
      expect(buf.data[i]).toBe(buf.data[i + 1]);
      expect(buf.data[i + 1]).toBe(buf.data[i + 2]);
    }
  });

  it('colour noise does not', () => {
    const buf = flat(8, 8, 128);
    applyFilter(buf, 'add-noise', { amount: 40, distribution: 'uniform', monochromatic: false });
    let differing = 0;
    for (let i = 0; i < buf.data.length; i += 4) {
      if (buf.data[i] !== buf.data[i + 1]) differing++;
    }
    expect(differing).toBeGreaterThan(0);
  });

  it('never touches alpha', () => {
    const buf = testImage();
    applyFilter(buf, 'add-noise', defaultFilterParams('add-noise'));
    for (let i = 3; i < buf.data.length; i += 4) expect(buf.data[i]).toBe(255);
  });
});

describe('sharpen behaviour', () => {
  it('unsharp mask at amount 0 changes nothing', () => {
    const buf = testImage();
    const before = [...buf.data];
    applyFilter(buf, 'unsharp-mask', { amount: 0, radius: 2, threshold: 0 });
    expect([...buf.data]).toEqual(before);
  });

  it('a high threshold suppresses the effect', () => {
    const gentle = testImage();
    const forceful = testImage();
    applyFilter(gentle, 'unsharp-mask', { amount: 200, radius: 2, threshold: 255 });
    applyFilter(forceful, 'unsharp-mask', { amount: 200, radius: 2, threshold: 0 });
    expect(checksum(gentle)).not.toBe(checksum(forceful));
  });

  it('increases local contrast', () => {
    const edgeStrength = (buf: PixelBuffer) => {
      let total = 0;
      for (let y = 0; y < buf.height; y++) {
        for (let x = 1; x < buf.width; x++) {
          const i = (y * buf.width + x) * 4;
          total += Math.abs(buf.data[i] - buf.data[i - 4]);
        }
      }
      return total;
    };
    const original = testImage();
    const sharpened = testImage();
    applyFilter(sharpened, 'sharpen', {});
    expect(edgeStrength(sharpened)).toBeGreaterThan(edgeStrength(original));
  });
});

describe('stylize behaviour', () => {
  it('solarize inverts only the bright half', () => {
    const buf = emptyBuffer(2, 1);
    buf.data.set([50, 50, 50, 255, 200, 200, 200, 255]);
    applyFilter(buf, 'solarize', {});
    expect(buf.data[0]).toBe(50);
    expect(buf.data[4]).toBe(55);
  });

  it('solarize is its own inverse for the dark half', () => {
    const buf = emptyBuffer(1, 1);
    buf.data.set([10, 10, 10, 255]);
    applyFilter(buf, 'solarize', {});
    applyFilter(buf, 'solarize', {});
    expect(buf.data[0]).toBe(10);
  });

  it('find edges turns flat areas white', () => {
    const buf = flat(8, 8, 90);
    applyFilter(buf, 'find-edges', {});
    expect(buf.data[0]).toBe(255);
  });

  it('emboss turns a flat area mid-grey', () => {
    const buf = flat(8, 8, 200);
    applyFilter(buf, 'emboss', defaultFilterParams('emboss'));
    expect(buf.data[0]).toBe(128);
  });
});

describe('video behaviour', () => {
  it('NTSC clamps into the broadcast-safe range', () => {
    const buf = emptyBuffer(2, 1);
    buf.data.set([0, 0, 0, 255, 255, 255, 255, 255]);
    applyFilter(buf, 'ntsc-colors', {});
    expect(buf.data[0]).toBeGreaterThanOrEqual(16);
    expect(buf.data[4]).toBeLessThanOrEqual(235);
  });

  it('de-interlace replaces the chosen field', () => {
    const buf = emptyBuffer(2, 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 2; x++) {
        const i = (y * 2 + x) * 4;
        const v = y % 2 === 1 ? 255 : 0;
        buf.data.set([v, v, v, 255], i);
      }
    }
    applyFilter(buf, 'de-interlace', { eliminate: 'odd', create: 'interpolation' });
    // Row 1 was 255 and sits between two 0 rows, so it becomes 0.
    expect(buf.data[(1 * 2 + 0) * 4]).toBe(0);
    expect(buf.data[(0 * 2 + 0) * 4]).toBe(0);
  });
});

describe('unknown filters', () => {
  it('are a no-op rather than a throw', () => {
    const buf = testImage();
    const before = [...buf.data];
    expect(() => applyFilter(buf, 'not-a-real-filter', {})).not.toThrow();
    expect([...buf.data]).toEqual(before);
  });
});

describe('filterById', () => {
  it('finds a descriptor', () => {
    expect(filterById('gaussian-blur')?.label).toBe('Gaussian Blur');
  });

  it('is undefined for an unknown id', () => {
    expect(filterById('nope')).toBeUndefined();
  });
});
