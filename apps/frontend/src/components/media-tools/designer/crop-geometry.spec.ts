import {
  cropFromBoxFraction,
  normaliseFraction,
  parseCropRatio,
  constrainFractionToRatio,
} from './crop-geometry';

const el = { x: 100, y: 200, width: 400, height: 300 };
const natural = { width: 800, height: 600 };

describe('normaliseFraction', () => {
  it('clamps to the box', () => {
    expect(normaliseFraction({ x: -0.5, y: 0, width: 2, height: 2 })).toEqual({
      x: 0, y: 0, width: 1, height: 1,
    });
  });

  it('normalises a rect dragged up and to the left', () => {
    const f = normaliseFraction({ x: 0.8, y: 0.8, width: -0.3, height: -0.3 });
    expect(f.x).toBeCloseTo(0.5);
    expect(f.y).toBeCloseTo(0.5);
    expect(f.width).toBeCloseTo(0.3);
    expect(f.height).toBeCloseTo(0.3);
  });
});

describe('cropFromBoxFraction', () => {
  it('insets the element box by the fraction', () => {
    const r = cropFromBoxFraction(el, natural, { x: 0.25, y: 0.5, width: 0.5, height: 0.5 });
    expect(r.x).toBe(200);   // 100 + 0.25*400
    expect(r.y).toBe(350);   // 200 + 0.5*300
    expect(r.width).toBe(200);
    expect(r.height).toBe(150);
  });

  it('maps the fraction into source pixels for an uncropped image', () => {
    const r = cropFromBoxFraction(el, natural, { x: 0.25, y: 0.5, width: 0.5, height: 0.5 });
    expect(r.crop).toEqual({ x: 200, y: 300, width: 400, height: 300 });
  });

  it('COMPOSES onto an existing crop rather than replacing it', () => {
    // The element already shows the right half of the source; cropping to the
    // right half again must land in the far-right quarter, not the middle.
    const cropped = { ...el, crop: { x: 400, y: 0, width: 400, height: 600 } };
    const r = cropFromBoxFraction(cropped, natural, { x: 0.5, y: 0, width: 0.5, height: 1 });
    expect(r.crop).toEqual({ x: 600, y: 0, width: 200, height: 600 });
  });

  it('resizes the box but emits no crop when there is no natural size', () => {
    const r = cropFromBoxFraction(el, null, { x: 0, y: 0, width: 0.5, height: 0.5 });
    expect(r.width).toBe(200);
    expect(r.crop).toBeUndefined();
  });

  it('never produces a zero-size box or crop', () => {
    const r = cropFromBoxFraction(el, natural, { x: 0, y: 0, width: 0, height: 0 });
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    expect(r.crop!.width).toBeGreaterThan(0);
  });
});

describe('parseCropRatio', () => {
  it('returns null for free and malformed values', () => {
    expect(parseCropRatio('free')).toBeNull();
    expect(parseCropRatio(undefined)).toBeNull();
    expect(parseCropRatio('nonsense')).toBeNull();
    expect(parseCropRatio('0:5')).toBeNull();
  });

  it('parses w:h', () => {
    expect(parseCropRatio('1:1')).toBe(1);
    expect(parseCropRatio('16:9')).toBeCloseTo(16 / 9);
    expect(parseCropRatio('9:16')).toBeCloseTo(9 / 16);
  });
});

describe('constrainFractionToRatio', () => {
  const full = { x: 0, y: 0, width: 1, height: 1 };

  it('is a no-op for a free ratio', () => {
    expect(constrainFractionToRatio(full, null, 400, 300)).toEqual(full);
  });

  it('enforces the ratio in canvas space, not fraction space', () => {
    // A square crop of a 400x300 box must be 300x300 px => 0.75 x 1.0 fraction.
    const f = constrainFractionToRatio(full, 1, 400, 300);
    expect(f.width * 400).toBeCloseTo(300);
    expect(f.height * 300).toBeCloseTo(300);
  });

  it('shrinks rather than growing past the box edge', () => {
    const f = constrainFractionToRatio(full, 16 / 9, 400, 300);
    expect(f.width).toBeLessThanOrEqual(1);
    expect(f.height).toBeLessThanOrEqual(1);
    expect((f.width * 400) / (f.height * 300)).toBeCloseTo(16 / 9);
  });
});
