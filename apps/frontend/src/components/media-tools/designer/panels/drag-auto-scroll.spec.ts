import { describe, it, expect } from 'vitest';
import { dragScrollDelta } from './drag-auto-scroll';

// A 200px-tall scrollbox starting at y=100.
const TOP = 100;
const BOTTOM = 300;

describe('dragScrollDelta', () => {
  it('is 0 in the comfortable middle of the container', () => {
    expect(dragScrollDelta(TOP, BOTTOM, 200)).toBe(0);
    expect(dragScrollDelta(TOP, BOTTOM, TOP + 28)).toBe(0);
    expect(dragScrollDelta(TOP, BOTTOM, BOTTOM - 28)).toBe(0);
  });

  it('is 0 when the pointer is outside the container', () => {
    expect(dragScrollDelta(TOP, BOTTOM, TOP - 1)).toBe(0);
    expect(dragScrollDelta(TOP, BOTTOM, BOTTOM + 1)).toBe(0);
  });

  it('scrolls up (negative) near the top edge, fastest at the very edge', () => {
    const atEdge = dragScrollDelta(TOP, BOTTOM, TOP);
    const halfway = dragScrollDelta(TOP, BOTTOM, TOP + 14);
    expect(atEdge).toBeLessThan(0);
    expect(halfway).toBeLessThan(0);
    expect(Math.abs(atEdge)).toBeGreaterThan(Math.abs(halfway));
    expect(atEdge).toBe(-8);
  });

  it('scrolls down (positive) near the bottom edge, symmetric with the top', () => {
    const atEdge = dragScrollDelta(TOP, BOTTOM, BOTTOM);
    expect(atEdge).toBe(8);
    expect(dragScrollDelta(TOP, BOTTOM, BOTTOM - 14)).toBe(
      -dragScrollDelta(TOP, BOTTOM, TOP + 14)
    );
  });

  it('never returns a sub-1 speed inside the edge zone (a stalled scroll)', () => {
    expect(dragScrollDelta(TOP, BOTTOM, TOP + 27)).toBe(-1);
    expect(dragScrollDelta(TOP, BOTTOM, BOTTOM - 27)).toBe(1);
  });
});
