import {
  cropFromBoxFraction,
  cropFromSourceRect,
  cropDisplayBox,
  currentSourceWindow,
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
  it('starts from the focal cover window for a landscape source', () => {
    const covered = {
      ...el,
      height: 400,
      fitMode: 'cover' as const,
      focalPoint: { x: 0.75, y: 0.5 },
    };
    expect(currentSourceWindow(covered, natural)).toEqual({
      x: 150, y: 0, width: 600, height: 600,
    });
    const r = cropFromBoxFraction(
      covered,
      natural,
      { x: 0.5, y: 0, width: 0.5, height: 1 },
      'right'
    );
    expect(r.crop).toEqual({ x: 450, y: 0, width: 300, height: 600 });
    expect(r).toMatchObject({ x: 300, y: 200, width: 200, height: 400 });
  });

  it('starts from the focal cover window for a portrait source', () => {
    const portrait = { width: 600, height: 800 };
    const covered = {
      ...el,
      fitMode: 'cover' as const,
      focalPoint: { x: 0.5, y: 0.25 },
    };
    expect(currentSourceWindow(covered, portrait)).toEqual({
      x: 0, y: 87.5, width: 600, height: 450,
    });
  });

  it.each(['contain', 'fill'] as const)('uses the full source for %s before an explicit crop', (fitMode) => {
    expect(currentSourceWindow({ ...el, fitMode }, natural)).toEqual({
      x: 0, y: 0, width: 800, height: 600,
    });
  });

  it('crops within the visible contain box and composes repeated crops', () => {
    const contained = { ...el, width: 200, height: 400, fitMode: 'contain' as const };
    expect(cropDisplayBox(contained, natural)).toEqual({ x: 100, y: 325, width: 200, height: 150 });
    const first = cropFromBoxFraction(
      contained,
      natural,
      { x: 0, y: 1 / 6, width: 1, height: 2 / 3 }
    );
    expect(first).toEqual({
      x: 100,
      y: 350,
      width: 200,
      height: 100,
      crop: { x: 0, y: 100, width: 800, height: 400 },
    });
    const second = cropFromBoxFraction(
      { ...el, ...first },
      natural,
      { x: 0.5, y: 0, width: 0.5, height: 1 }
    );
    expect(second).toEqual({
      x: 200,
      y: 350,
      width: 100,
      height: 100,
      crop: { x: 400, y: 100, width: 400, height: 400 },
    });
  });

  it('preserves aspect and the opposite edge on a repeated crop', () => {
    const first = cropFromBoxFraction(
      { ...el, fitMode: 'cover' as const, focalPoint: { x: 0.75, y: 0.5 } },
      natural,
      { x: 0.25, y: 0, width: 0.75, height: 1 },
      'left'
    );
    expect(first.width / first.height).toBeCloseTo(first.crop!.width / first.crop!.height, 10);

    const second = cropFromBoxFraction(
      { ...el, ...first },
      natural,
      { x: 0.5, y: 0.25, width: 0.5, height: 0.75 },
      'bottom-right'
    );
    expect(second.width / second.height).toBeCloseTo(second.crop!.width / second.crop!.height, 10);
    expect(second.x).toBeCloseTo(first.x + first.width * 0.5, 10);
    expect(second.y).toBeCloseTo(first.y + first.height * 0.25, 10);
    expect(second.crop!.x).toBeGreaterThanOrEqual(first.crop!.x);
    expect(second.crop!.y).toBeGreaterThanOrEqual(first.crop!.y);
  });
});

describe('Inspector crop geometry', () => {
  it('uses the same aspect-preserving helper for asymmetric insets', () => {
    const r = cropFromSourceRect(
      el,
      { x: 200, y: 50, width: 400, height: 450 },
      undefined,
      'left'
    );
    expect(r.width / r.height).toBeCloseTo(400 / 450, 10);
    expect(r.x + r.width).toBeCloseTo(el.x + el.width, 10);
    expect(r.y).toBe(el.y);
    expect(r.crop).toEqual({ x: 200, y: 50, width: 400, height: 450 });
  });

  it('keeps the left edge anchored for a right-side slider', () => {
    const r = cropFromSourceRect(
      el,
      { x: 0, y: 0, width: 600, height: 600 },
      undefined,
      'right'
    );
    expect(r).toMatchObject({ x: el.x, y: el.y, width: 300, height: 300 });
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
