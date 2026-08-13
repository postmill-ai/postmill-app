import { describe, it, expect } from 'vitest';
import {
  along,
  arrowHeadPoints,
  arrowInset,
  arrowSize,
  endpointAngle,
  strokeEndpoints,
  strokeStyleSource,
  MIN_ARROW_SIZE,
} from './stroke-style';

describe('arrowSize', () => {
  it('scales with the stroke', () => {
    expect(arrowSize(10)).toBeGreaterThan(arrowSize(2));
  });

  it('never disappears on a hairline stroke', () => {
    expect(arrowSize(0)).toBe(MIN_ARROW_SIZE);
    expect(arrowSize(0.1)).toBe(MIN_ARROW_SIZE);
  });
});

describe('arrowHeadPoints', () => {
  const tip = { x: 100, y: 100 };

  it('draws nothing for none', () => {
    expect(arrowHeadPoints('none', tip, 0, 4)).toEqual([]);
  });

  it('puts the point of a triangle exactly on the endpoint', () => {
    const pts = arrowHeadPoints('triangle', tip, 0, 4);
    expect(pts[0]).toEqual(tip);
  });

  it('points along the given angle', () => {
    // Pointing right: the barbs trail to the LEFT of the tip.
    const right = arrowHeadPoints('triangle', tip, 0, 4);
    expect(right[1].x).toBeLessThan(tip.x);

    // Pointing down: the barbs trail ABOVE it.
    const down = arrowHeadPoints('triangle', tip, Math.PI / 2, 4);
    expect(down[1].y).toBeLessThan(tip.y);
  });

  it('gives the barbed arrow a notch the plain triangle does not have', () => {
    expect(arrowHeadPoints('arrow', tip, 0, 4)).toHaveLength(4);
    expect(arrowHeadPoints('triangle', tip, 0, 4)).toHaveLength(3);
  });

  it('returns a circle as a polygon, so every renderer just fills points', () => {
    const pts = arrowHeadPoints('circle', tip, 0, 4);
    expect(pts.length).toBeGreaterThan(8);
    for (const p of pts) {
      expect(Math.hypot(p.x - tip.x, p.y - tip.y)).toBeCloseTo(arrowSize(4) * 0.4, 5);
    }
  });

  it('straddles the endpoint for a bar', () => {
    const pts = arrowHeadPoints('bar', tip, 0, 4);
    expect(Math.min(...pts.map((p) => p.y))).toBeLessThan(tip.y);
    expect(Math.max(...pts.map((p) => p.y))).toBeGreaterThan(tip.y);
  });
});

describe('arrowInset', () => {
  it('pulls the shaft back behind a solid head', () => {
    expect(arrowInset('triangle', 4)).toBeGreaterThan(0);
    expect(arrowInset('arrow', 4)).toBeGreaterThan(0);
  });

  it('insets nothing for heads that straddle the endpoint', () => {
    // Trimming there would leave a visible gap in the line.
    expect(arrowInset('bar', 4)).toBe(0);
    expect(arrowInset('circle', 4)).toBe(0);
    expect(arrowInset('none', 4)).toBe(0);
  });
});

describe('strokeEndpoints', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];

  it('points the start head backwards along the line', () => {
    const e = strokeEndpoints(line)!;
    expect(e.startAngle).toBeCloseTo(Math.PI);
    expect(e.endAngle).toBeCloseTo(0);
  });

  it('has no answer for a single point', () => {
    expect(strokeEndpoints([{ x: 0, y: 0 }])).toBeNull();
  });

  it('has no answer for a zero-length line', () => {
    // An arrowhead with no direction would land at an arbitrary angle.
    expect(strokeEndpoints([{ x: 5, y: 5 }, { x: 5, y: 5 }])).toBeNull();
  });

  it('walks past duplicated points to find a real direction', () => {
    const e = strokeEndpoints([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 0, y: 50 },
    ])!;
    expect(e.endAngle).toBeCloseTo(Math.PI / 2);
  });

  it('uses the last SEGMENT of a polyline, not the overall direction', () => {
    const e = strokeEndpoints([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ])!;
    expect(e.endAngle).toBeCloseTo(Math.PI / 2);
  });
});

describe('along', () => {
  it('walks a point in the given direction', () => {
    const p = along({ x: 0, y: 0 }, 0, 10);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(0);
  });
});

describe('endpointAngle', () => {
  it('is zero along +x', () => {
    expect(endpointAngle({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0);
  });
});

describe('strokeStyleSource', () => {
  it('runs, and agrees with the imported functions', () => {
    const fn = new Function(
      `${strokeStyleSource()}
      return { arrowHeadPoints, strokeEndpoints };`
    ) as () => {
      arrowHeadPoints: typeof arrowHeadPoints;
      strokeEndpoints: typeof strokeEndpoints;
    };
    const injected = fn();
    expect(injected.arrowHeadPoints('arrow', { x: 3, y: 4 }, 1.2, 6)).toEqual(
      arrowHeadPoints('arrow', { x: 3, y: 4 }, 1.2, 6)
    );
    expect(injected.strokeEndpoints([{ x: 0, y: 0 }, { x: 2, y: 2 }])).toEqual(
      strokeEndpoints([{ x: 0, y: 0 }, { x: 2, y: 2 }])
    );
  });
});
