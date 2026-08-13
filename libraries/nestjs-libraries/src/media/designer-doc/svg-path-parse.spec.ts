import { describe, it, expect } from 'vitest';
import { parseSvgPathData } from './svg-path-parse';
import { pathBounds } from './path-geometry';

/**
 * There was no `d` parser anywhere in the repo — the only other SVG path code
 * flattens to sample points for text-on-path, throwing the control points away.
 * That one gap is why SVG import produced a bitmap and the Custom Shape tool
 * drew a rounded rectangle.
 */

describe('parseSvgPathData', () => {
  it('reads a plain polygon', () => {
    const [sub] = parseSvgPathData('M 0 0 L 100 0 L 100 100 L 0 100 Z');
    expect(sub.closed).toBe(true);
    expect(sub.nodes).toHaveLength(4);
    expect(sub.nodes[2]).toMatchObject({ x: 100, y: 100 });
  });

  it('accepts SVG\'s permissive grammar — no separators, exponents, implicit repeats', () => {
    const tight = parseSvgPathData('M0,0L1 1L2,2')[0];
    const spaced = parseSvgPathData('M 0 0 L 1 1 L 2 2')[0];
    expect(tight.nodes).toEqual(spaced.nodes);

    // A repeated L argument list repeats the command.
    const repeated = parseSvgPathData('M0 0 L1 1 2 2')[0];
    expect(repeated.nodes).toHaveLength(3);

    // A repeated M list means lineto, per the spec.
    const implied = parseSvgPathData('M0 0 10 10')[0];
    expect(implied.nodes).toHaveLength(2);
    expect(implied.nodes[1]).toMatchObject({ x: 10, y: 10 });

    expect(parseSvgPathData('M0 0 L1e2 1E2')[0].nodes[1]).toMatchObject({ x: 100, y: 100 });
  });

  it('handles relative commands and H/V', () => {
    const [sub] = parseSvgPathData('M 10 10 h 20 v 20 l -20 0 z');
    expect(sub.nodes.map((n) => [n.x, n.y])).toEqual([
      [10, 10],
      [30, 10],
      [30, 30],
      [10, 30],
    ]);
  });

  it('keeps cubic control points, which is what makes the path EDITABLE', () => {
    const [sub] = parseSvgPathData('M 0 0 C 10 0 20 10 20 20');
    expect(sub.nodes[0]).toMatchObject({ outX: 10, outY: 0 });
    expect(sub.nodes[1]).toMatchObject({ x: 20, y: 20, inX: 20, inY: 10 });
  });

  it('mirrors the previous control for S', () => {
    const [sub] = parseSvgPathData('M 0 0 C 10 0 20 10 20 20 S 40 40 50 20');
    // The reflected control is 2*anchor - previous control = (20,30).
    expect(sub.nodes[1].outX).toBe(20);
    expect(sub.nodes[1].outY).toBe(30);
  });

  it('elevates a quadratic to a cubic rather than adding a second curve type', () => {
    const [sub] = parseSvgPathData('M 0 0 Q 50 0 100 0');
    // Control points at 2/3 of the way to the quadratic control.
    expect(sub.nodes[0].outX).toBeCloseTo(33.333, 2);
    expect(sub.nodes[1].inX).toBeCloseTo(66.667, 2);
  });

  it('converts an arc to cubics that actually land on the endpoint', () => {
    const [sub] = parseSvgPathData('M 0 50 A 50 50 0 0 1 100 50');
    const last = sub.nodes[sub.nodes.length - 1];
    expect(last.x).toBeCloseTo(100, 3);
    expect(last.y).toBeCloseTo(50, 3);
    // A semicircle needs more than one cubic to stay accurate.
    expect(sub.nodes.length).toBeGreaterThan(2);
    const bounds = pathBounds(sub.nodes)!;
    // Bows upward (sweep 1, y-down), so it reaches y = 0.
    expect(bounds.minY).toBeLessThan(10);
  });

  it('scales radii up when the arc is too small to span its endpoints', () => {
    const [sub] = parseSvgPathData('M 0 0 A 1 1 0 0 1 100 0');
    const last = sub.nodes[sub.nodes.length - 1];
    expect(last.x).toBeCloseTo(100, 3);
    expect(last.y).toBeCloseTo(0, 3);
  });

  it('splits on M, because a real icon is several contours', () => {
    const subs = parseSvgPathData('M0 0 L10 0 L10 10 Z M20 20 L30 20 L30 30 Z');
    expect(subs).toHaveLength(2);
    expect(subs.every((s) => s.closed)).toBe(true);
  });

  it('drops the duplicate anchor a Z-to-start leaves behind', () => {
    const [sub] = parseSvgPathData('M 0 0 L 10 0 L 10 10 L 0 0 Z');
    expect(sub.nodes).toHaveLength(3);
  });

  it('returns nothing for junk rather than throwing', () => {
    expect(parseSvgPathData('')).toEqual([]);
    expect(parseSvgPathData('not a path')).toEqual([]);
    expect(parseSvgPathData('M 0 0')).toEqual([]);
    expect(() => parseSvgPathData('C 1 2 3')).not.toThrow();
  });
});
