import { describe, it, expect } from 'vitest';
import { distribute, findEqualSpacing, type Box } from './align-distribute';

const box = (id: string, x: number, y: number, w = 10, h = 10): Box => ({
  id,
  x,
  y,
  width: w,
  height: h,
});

describe('distribute', () => {
  it('has nothing to do with fewer than three boxes', () => {
    expect(distribute([box('a', 0, 0), box('b', 50, 0)], 'horizontal-centers')).toEqual({});
  });

  it('spaces centres evenly', () => {
    const r = distribute(
      [box('a', 0, 0), box('b', 13, 0), box('c', 100, 0)],
      'horizontal-centers'
    );
    // Centres run 5 … 55 … 105, so the middle box lands at x = 50.
    expect(r.b.x).toBeCloseTo(50);
  });

  it('leaves the two outermost boxes where they are', () => {
    const r = distribute(
      [box('a', 0, 0), box('b', 13, 0), box('c', 100, 0)],
      'horizontal-centers'
    );
    expect(r.a.x).toBeCloseTo(0);
    expect(r.c.x).toBeCloseTo(100);
  });

  it('spaces gaps evenly, which differs from centres for unequal sizes', () => {
    // Deliberately asymmetric: with equal outer widths the two modes coincide.
    const boxes = [box('a', 0, 0, 10), box('b', 20, 0, 40), box('c', 100, 0, 30)];
    const centres = distribute(boxes, 'horizontal-centers');
    const gaps = distribute(boxes, 'horizontal-gaps');
    expect(gaps.b.x).not.toBeCloseTo(centres.b.x!);
    // Gap mode: span 0…130 minus (10+40+30) of boxes = 50, shared over two gaps.
    expect(gaps.b.x).toBeCloseTo(35);
    expect(centres.b.x).toBeCloseTo(40);
  });

  it('works vertically too', () => {
    const r = distribute(
      [box('a', 0, 0), box('b', 0, 7), box('c', 0, 100)],
      'vertical-centers'
    );
    expect(r.b.y).toBeCloseTo(50);
    expect(r.b.x).toBeUndefined();
  });

  it('does not depend on the order it was given', () => {
    const boxes = [box('c', 100, 0), box('a', 0, 0), box('b', 13, 0)];
    expect(distribute(boxes, 'horizontal-centers').b.x).toBeCloseTo(50);
  });
});

describe('findEqualSpacing', () => {
  const a = box('a', 0, 0, 10, 10);
  const c = box('c', 100, 0, 10, 10);

  it('spots a box sitting midway between two others', () => {
    const guide = findEqualSpacing(box('m', 50, 0), [a, c])!;
    expect(guide.axis).toBe('x');
    expect(guide.gap).toBeCloseTo(40);
    expect(guide.spans).toHaveLength(2);
  });

  it('finds nothing when the gaps differ', () => {
    expect(findEqualSpacing(box('m', 20, 0), [a, c])).toBeNull();
  });

  it('tolerates being a pixel or two off', () => {
    expect(findEqualSpacing(box('m', 51, 0), [a, c])).toBeTruthy();
  });

  it('ignores boxes in a different row — they are not in line', () => {
    // A distant element in a corner would otherwise produce a nonsense guide.
    expect(findEqualSpacing(box('m', 50, 0), [a, box('c', 100, 500)])).toBeNull();
  });

  it('needs at least two others to compare against', () => {
    expect(findEqualSpacing(box('m', 50, 0), [a])).toBeNull();
  });

  it('matches the run’s spacing when the moving box is on the end', () => {
    const row = [box('a', 0, 0), box('b', 50, 0), box('c', 100, 0)];
    const guide = findEqualSpacing(box('m', 150, 0), row)!;
    expect(guide.gap).toBeCloseTo(40);
  });

  it('works on the vertical axis', () => {
    const guide = findEqualSpacing(box('m', 0, 50), [box('a', 0, 0), box('c', 0, 100)])!;
    expect(guide.axis).toBe('y');
    expect(guide.gap).toBeCloseTo(40);
  });
});
