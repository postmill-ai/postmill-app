import { describe, it, expect } from 'vitest';
import {
  alignToCapHeight,
  capHeightTrim,
  closeAwkwardGaps,
  isAwkwardGap,
  opticalOverhang,
  opticallyCentre,
} from './optical';

const container = { x: 0, y: 0, width: 1000, height: 1000 };

describe('opticallyCentre', () => {
  it('sits a block above the geometric centre', () => {
    // The eye reads a frame's centre as higher than it is, so a geometrically
    // centred block looks like it has slipped down.
    const box = { x: 0, y: 0, width: 100, height: 200 };
    const centred = opticallyCentre(box, container);
    expect(centred.y).toBeLessThan((1000 - 200) / 2);
  });

  it('leaves a block that already fills its container alone', () => {
    const box = { x: 0, y: 0, width: 100, height: 1000 };
    expect(opticallyCentre(box, container)).toEqual(box);
  });

  it('leaves an oversized block alone rather than lifting it further out', () => {
    const box = { x: 0, y: 0, width: 100, height: 1200 };
    expect(opticallyCentre(box, container).y).toBe(0);
  });

  it('caps the lift so a tiny block does not fly to the top', () => {
    // With almost all the container as slack, an uncapped proportional lift
    // would put a small block near the top edge rather than near the centre.
    const box = { x: 0, y: 0, width: 100, height: 10 };
    const centred = opticallyCentre(box, container);
    const geometric = (1000 - 10) / 2;
    expect(geometric - centred.y).toBeLessThanOrEqual(1000 * 0.08 + 0.001);
    expect(centred.y).toBeGreaterThan(300);
  });
});

describe('opticalOverhang', () => {
  it('hangs an opening quote into the margin', () => {
    // A line starting with a quote looks indented, because the glyph is mostly
    // whitespace.
    expect(opticalOverhang('“Great product”', 100)).toBeGreaterThan(0);
  });

  it('hangs a straight quote too', () => {
    expect(opticalOverhang('"Great"', 100)).toBeGreaterThan(0);
  });

  it('barely moves a flat-sided letter', () => {
    expect(opticalOverhang('Hello', 100)).toBe(0);
    expect(opticalOverhang('Type', 100)).toBeLessThan(opticalOverhang('“Type', 100));
  });

  it('scales with the font size, since it is an optical share not a constant', () => {
    expect(opticalOverhang('“x', 200)).toBeCloseTo(opticalOverhang('“x', 100) * 2, 6);
  });

  it('ignores leading whitespace when deciding', () => {
    expect(opticalOverhang('   “x', 100)).toBe(opticalOverhang('“x', 100));
  });

  it('handles empty copy', () => {
    expect(opticalOverhang('', 100)).toBe(0);
    expect(opticalOverhang('   ', 100)).toBe(0);
  });
});

describe('capHeightTrim', () => {
  it('reserves more above than below, as fonts do', () => {
    const trim = capHeightTrim(100);
    expect(trim.top).toBeGreaterThan(trim.bottom);
  });

  it('lifts a box so its cap height, not its line box, sits on the edge', () => {
    const box = { x: 0, y: 100, width: 10, height: 10 };
    expect(alignToCapHeight(box, 100).y).toBeLessThan(100);
  });
});

describe('awkward gaps', () => {
  it('flags a gap too small to read as deliberate', () => {
    expect(isAwkwardGap(2, 10)).toBe(true);
  });

  it('does not flag flush edges', () => {
    expect(isAwkwardGap(0, 10)).toBe(false);
  });

  it('does not flag a real space', () => {
    expect(isAwkwardGap(8, 10)).toBe(false);
  });

  it('closes an awkward gap to flush', () => {
    const boxes = [
      { x: 0, y: 0, width: 10, height: 100 },
      { x: 0, y: 102, width: 10, height: 100 },
    ];
    expect(closeAwkwardGaps(boxes, 10)[1].y).toBe(100);
  });

  it('leaves deliberate spacing untouched', () => {
    const boxes = [
      { x: 0, y: 0, width: 10, height: 100 },
      { x: 0, y: 140, width: 10, height: 100 },
    ];
    expect(closeAwkwardGaps(boxes, 10)[1].y).toBe(140);
  });

  it('returns boxes in their original order, not sorted', () => {
    // The caller matches these back to slots positionally; re-ordering them
    // would silently assign every box to the wrong element.
    const boxes = [
      { x: 0, y: 200, width: 10, height: 10 },
      { x: 0, y: 0, width: 10, height: 10 },
    ];
    const out = closeAwkwardGaps(boxes, 10);
    expect(out[0].y).toBe(200);
    expect(out[1].y).toBe(0);
  });
});
