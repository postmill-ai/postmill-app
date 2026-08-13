import { describe, it, expect } from 'vitest';
import { buildGrid } from './grid';
import {
  arrange,
  distribute,
  measure,
  snapPlacements,
  type ContainerNode,
  type LayoutNode,
  type LeafNode,
  type MeasureContext,
} from './box-model';

const grid = buildGrid({ width: 1080, height: 1080, formatId: 'ig-post' });

/** Deterministic stand-in for text measurement: taller when narrower. */
const ctx: MeasureContext = {
  grid,
  measureLeaf: (node, width) => (node.slotId === 'headline' ? 40000 / width : 50),
};

const leaf = (slotId: string, over: Partial<LeafNode> = {}): LeafNode => ({
  kind: 'leaf',
  slotId,
  ...over,
});

const box = { x: 0, y: 0, width: 900, height: 900 };
const at = (out: { slotId: string; box: { x: number; y: number; width: number; height: number } }[], id: string) =>
  out.find((p) => p.slotId === id)!.box;

describe('distribute', () => {
  it('splits evenly with no weights', () => {
    expect(distribute(100, 2, 0)).toEqual([50, 50]);
  });

  it('subtracts the gaps before splitting', () => {
    expect(distribute(100, 2, 20)).toEqual([40, 40]);
  });

  it('honours relative weights, not absolute ones', () => {
    // "the image is twice the copy" must not depend on the canvas.
    expect(distribute(90, 2, 0, [2, 1])).toEqual([60, 30]);
    expect(distribute(90, 2, 0, [200, 100])).toEqual([60, 30]);
  });

  it('falls back to even when weights are malformed', () => {
    expect(distribute(100, 2, 0, [1])).toEqual([50, 50]);
    expect(distribute(100, 2, 0, [0, 1])).toEqual([50, 50]);
  });

  it('never returns a negative width when the gaps exceed the space', () => {
    for (const w of distribute(10, 5, 100)) expect(w).toBeGreaterThanOrEqual(0);
  });
});

describe('measure', () => {
  it('asks a leaf for its height at the width it will actually get', () => {
    // The entire point of two passes: a headline is taller in a narrow column.
    expect(measure(leaf('headline'), 200, ctx)).toBeGreaterThan(
      measure(leaf('headline'), 800, ctx)
    );
  });

  it('derives height from aspect when one is given', () => {
    expect(measure(leaf('photo', { aspect: 2 }), 800, ctx)).toBe(400);
  });

  it('respects a minimum expressed in baselines', () => {
    const tall = leaf('legal', { minBaselines: 40 });
    expect(measure(tall, 800, ctx)).toBeCloseTo(40 * grid.baseline, 6);
  });

  it('sums a stack and its gaps', () => {
    const node: ContainerNode = {
      kind: 'stack',
      gap: 2,
      children: [leaf('a'), leaf('b')],
    };
    expect(measure(node, 800, ctx)).toBeCloseTo(50 + 50 + 2 * grid.baseline, 6);
  });

  it('takes the tallest child for a row', () => {
    const node: ContainerNode = {
      kind: 'row',
      children: [leaf('headline'), leaf('b')],
    };
    // headline at half-width is 40000/450 ≈ 88.9, taller than b's 50.
    expect(measure(node, 900, ctx)).toBeCloseTo(40000 / 450, 4);
  });

  it('takes the tallest child for an overlay', () => {
    const node: ContainerNode = {
      kind: 'overlay',
      children: [leaf('a'), leaf('headline')],
    };
    expect(measure(node, 400, ctx)).toBeCloseTo(100, 4);
  });

  it('counts padding on both sides', () => {
    const node: ContainerNode = { kind: 'stack', padding: 3, children: [leaf('a')] };
    expect(measure(node, 800, ctx)).toBeCloseTo(50 + 6 * grid.baseline, 6);
  });

  it('reports nothing for a fill container — it has no opinion', () => {
    expect(measure({ kind: 'stack', fill: true, children: [leaf('a')] }, 800, ctx)).toBe(0);
  });
});

describe('arrange', () => {
  it('stacks children top to bottom', () => {
    const node: ContainerNode = { kind: 'stack', children: [leaf('a'), leaf('b')] };
    const out = arrange(node, box, ctx);
    expect(at(out, 'a').y).toBeLessThan(at(out, 'b').y);
    expect(at(out, 'a').y + at(out, 'a').height).toBeCloseTo(at(out, 'b').y, 6);
  });

  it('lays a row left to right without overlapping', () => {
    const node: ContainerNode = { kind: 'row', gap: 2, children: [leaf('a'), leaf('b')] };
    const out = arrange(node, box, ctx);
    expect(at(out, 'a').x + at(out, 'a').width).toBeLessThanOrEqual(at(out, 'b').x + 0.001);
  });

  it('gives an overlay child the whole box, so things can sit on things', () => {
    const node: ContainerNode = { kind: 'overlay', children: [leaf('bg'), leaf('fg')] };
    const out = arrange(node, box, ctx);
    expect(at(out, 'bg')).toEqual(at(out, 'fg'));
  });

  it('gives the leftover height to a fill leaf', () => {
    // The hero-image case: copy takes what it needs, the picture takes the rest.
    const node: ContainerNode = {
      kind: 'stack',
      children: [leaf('a'), leaf('hero', { fill: true })],
    };
    const out = arrange(node, box, ctx);
    expect(at(out, 'hero').height).toBeCloseTo(900 - 50, 6);
  });

  it('gives a fill container the leftover without inflating its children', () => {
    // A fill container claims the space; a stack of a headline and a CTA inside
    // it should be POSITIONED in that space, not stretched to fill it.
    const node: ContainerNode = {
      kind: 'stack',
      children: [
        leaf('a'),
        { kind: 'stack', fill: true, justify: 'center', children: [leaf('rest')] },
      ],
    };
    const out = arrange(node, box, ctx);
    expect(at(out, 'rest').height).toBeCloseTo(50, 6);
    // Centred within the 850 it was handed, i.e. starting near 50 + 400.
    expect(at(out, 'rest').y).toBeCloseTo(50 + (850 - 50) / 2, 4);
  });

  it('centres a stack that does not fill its box', () => {
    const node: ContainerNode = {
      kind: 'stack',
      justify: 'center',
      children: [leaf('a'), leaf('b')],
    };
    const out = arrange(node, { ...box, height: 300 }, ctx);
    const top = at(out, 'a').y;
    const bottom = at(out, 'b').y + at(out, 'b').height;
    expect(top).toBeCloseTo(300 - bottom, 4);
  });

  it('shrinks proportionally rather than overflowing its box', () => {
    // A layout that runs past its box is not a layout. The old composer's
    // answer was to shrink type until it fit, which made copy sizes
    // unpredictable; here the boxes give way, and type is fitted into them.
    const node: ContainerNode = {
      kind: 'stack',
      children: [leaf('a'), leaf('b'), leaf('c')],
    };
    const out = arrange(node, { ...box, height: 75 }, ctx);
    const total = out.reduce((sum, p) => sum + p.box.height, 0);
    expect(total).toBeLessThanOrEqual(75.001);
    expect(at(out, 'a').height).toBeCloseTo(at(out, 'b').height, 6);
  });

  it('never shrinks a rigid child', () => {
    // A legal line that shrinks to nothing is a compliance problem, not a
    // layout one.
    const node: ContainerNode = {
      kind: 'stack',
      children: [leaf('a'), leaf('legal', { rigid: true })],
    };
    const out = arrange(node, { ...box, height: 60 }, ctx);
    expect(at(out, 'legal').height).toBeCloseTo(50, 6);
    expect(at(out, 'a').height).toBeLessThan(50);
  });

  it('spaces children apart with space-between', () => {
    const node: ContainerNode = {
      kind: 'stack',
      justify: 'space-between',
      children: [leaf('a'), leaf('b')],
    };
    const out = arrange(node, { ...box, height: 400 }, ctx);
    expect(at(out, 'a').y).toBeCloseTo(0, 6);
    expect(at(out, 'b').y + at(out, 'b').height).toBeCloseTo(400, 6);
  });

  it('applies padding before distributing', () => {
    const node: ContainerNode = { kind: 'stack', padding: 4, children: [leaf('a')] };
    const out = arrange(node, box, ctx);
    expect(at(out, 'a').x).toBeCloseTo(4 * grid.baseline, 6);
    expect(at(out, 'a').width).toBeCloseTo(900 - 8 * grid.baseline, 6);
  });

  it('weights a row so a composition can say "image twice the copy"', () => {
    const node: ContainerNode = {
      kind: 'row',
      weights: [2, 1],
      children: [leaf('img'), leaf('copy')],
    };
    const out = arrange(node, box, ctx);
    expect(at(out, 'img').width).toBeCloseTo(600, 6);
    expect(at(out, 'copy').width).toBeCloseTo(300, 6);
  });

  it('keeps every placement inside the box it was given', () => {
    const node: LayoutNode = {
      kind: 'stack',
      gap: 2,
      padding: 2,
      children: [
        leaf('headline'),
        { kind: 'row', gap: 1, children: [leaf('a'), leaf('b')] },
        leaf('cta'),
      ],
    };
    for (const p of arrange(node, box, ctx)) {
      expect(p.box.x).toBeGreaterThanOrEqual(box.x - 0.001);
      expect(p.box.x + p.box.width).toBeLessThanOrEqual(box.x + box.width + 0.001);
      expect(p.box.y).toBeGreaterThanOrEqual(box.y - 0.001);
    }
  });
});

describe('snapPlacements', () => {
  it('lands boxes on the vertical rhythm', () => {
    const snapped = snapPlacements(grid, [
      { slotId: 'a', box: { x: 0, y: grid.baseline * 2.4, width: 10, height: grid.baseline * 3.6 } },
    ]);
    expect(snapped[0].box.y / grid.baseline).toBeCloseTo(2, 6);
    expect(snapped[0].box.height / grid.baseline).toBeCloseTo(4, 6);
  });

  it('never snaps a box out of existence', () => {
    const snapped = snapPlacements(grid, [
      { slotId: 'a', box: { x: 0, y: 0, width: 10, height: 0.0001 } },
    ]);
    expect(snapped[0].box.height).toBeGreaterThan(0);
  });

  it('does not accumulate — snapping is applied once, at the end', () => {
    // Snapping inside `arrange` compounds: six boxes each rounded up by half a
    // baseline grow the stack by three, and the last falls off the canvas.
    const placements = Array.from({ length: 6 }, (_, i) => ({
      slotId: `s${i}`,
      box: { x: 0, y: i * grid.baseline * 1.5, width: 10, height: grid.baseline },
    }));
    const snapped = snapPlacements(grid, placements);
    const last = snapped[5].box.y;
    expect(last).toBeLessThanOrEqual(5 * grid.baseline * 1.5 + grid.baseline);
  });
});
