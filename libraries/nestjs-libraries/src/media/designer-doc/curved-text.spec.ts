import { describe, it, expect } from 'vitest';
import { arcBaselineY, arcGeometry, arcPathData } from './curved-text';

/**
 * The two renderers derived this arc independently and disagreed badly: the
 * canvas put the baseline a full radius below the element for a positive Arc
 * Angle (~773px off-artboard for a 400px box), and the server threw the sign
 * away so a negative angle bowed upward exactly like a positive one.
 */

describe('arcGeometry', () => {
  it('is null when there is no curve', () => {
    expect(arcGeometry(400, 0)).toBeNull();
    expect(arcGeometry(400, undefined)).toBeNull();
  });

  it('is null for a zero-width element', () => {
    expect(arcGeometry(0, 30)).toBeNull();
  });

  it('treats curve as the total subtended angle in degrees', () => {
    // A 90° arc on a 400px chord: r = (w/2) / sin(45°).
    const g = arcGeometry(400, 90)!;
    expect(g.radius).toBeCloseTo(200 / Math.sin(Math.PI / 4), 3);
  });

  it('bows up for a positive angle and down for a negative one', () => {
    expect(arcGeometry(400, 30)!.up).toBe(true);
    expect(arcGeometry(400, -30)!.up).toBe(false);
  });

  it('gives the same radius and sagitta either way — only the direction flips', () => {
    const up = arcGeometry(400, 30)!;
    const down = arcGeometry(400, -30)!;
    expect(up.radius).toBeCloseTo(down.radius, 6);
    expect(up.sagitta).toBeCloseTo(down.sagitta, 6);
  });
});

describe('arcBaselineY', () => {
  it('keeps an upward bow between 0 and the sagitta', () => {
    const g = arcGeometry(400, 30)!;
    const half = Math.asin(200 / g.radius);
    expect(arcBaselineY(g, 0)).toBeCloseTo(0, 6);
    expect(arcBaselineY(g, half)).toBeCloseTo(g.sagitta, 6);
    expect(arcBaselineY(g, -half)).toBeCloseTo(g.sagitta, 6);
  });

  it('mirrors it for a downward bow, still inside the box', () => {
    const g = arcGeometry(400, -30)!;
    const half = Math.asin(200 / g.radius);
    expect(arcBaselineY(g, 0)).toBeCloseTo(g.sagitta, 6);
    expect(arcBaselineY(g, half)).toBeCloseTo(0, 6);
  });

  it('never leaves the element box, which is the whole regression', () => {
    // The canvas used to place this at y = radius — three-quarters of a
    // thousand pixels below a 400px element.
    for (const curve of [5, 30, 60, 90, -5, -30, -90]) {
      const g = arcGeometry(400, curve)!;
      const half = Math.asin(200 / g.radius);
      for (const t of [-half, -half / 2, 0, half / 2, half]) {
        const y = arcBaselineY(g, t);
        expect(y).toBeGreaterThanOrEqual(-0.001);
        expect(y).toBeLessThanOrEqual(g.sagitta + 0.001);
      }
    }
  });
});

describe('arcPathData', () => {
  it('is null without a curve, so flat text stays flat', () => {
    expect(arcPathData(400, 0)).toBeNull();
  });

  it('starts and ends on the element edges', () => {
    const d = arcPathData(400, 30)!;
    expect(d.startsWith('M 0,')).toBe(true);
    expect(d).toContain('400,');
  });

  it('uses the sweep that actually bows the right way', () => {
    // Verified against Konva's own path parser — sweep 1 lifts the path as it
    // travels left to right in SVG's y-down space.
    expect(arcPathData(400, 30)).toContain('0 0,1');
    expect(arcPathData(400, -30)).toContain('0 0,0');
  });

  it('anchors an upward bow on the sagitta and a downward one on zero', () => {
    const g = arcGeometry(400, 30)!;
    expect(arcPathData(400, 30)!.startsWith(`M 0,${Math.round(g.sagitta * 1000) / 1000}`)).toBe(true);
    expect(arcPathData(400, -30)!.startsWith('M 0,0')).toBe(true);
  });
});
