import { describe, it, expect } from 'vitest';
import {
  buildGrid,
  columnBox,
  columnSpan,
  columnX,
  columnsFor,
  snapToBaseline,
  canvasTypeBasis,
} from './grid';

/**
 * The grid every composition is measured against. Its job is to make one
 * composition land correctly on every canvas, so most of these are the same
 * assertion at three aspects.
 */

const SQUARE = { width: 1080, height: 1080, formatId: 'ig-post' };
const STORY = { width: 1080, height: 1920, formatId: 'ig-story' };
const BANNER = { width: 1200, height: 675, formatId: 'tw-post' };

describe('canvasTypeBasis', () => {
  it('tracks area, not the short side', () => {
    // The bug this replaces: `Math.min(w, h)` sized a 1200x675 banner's
    // headline for 675px, so every wide channel variant read as the square
    // design squashed. The mean gives a wider canvas genuinely larger type.
    expect(canvasTypeBasis(1200, 675)).toBeGreaterThan(675);
    expect(canvasTypeBasis(1200, 675)).toBeLessThan(1200);
  });

  it('is symmetric in its arguments', () => {
    expect(canvasTypeBasis(1080, 1920)).toBeCloseTo(canvasTypeBasis(1920, 1080), 6);
  });

  it('is the identity on a square', () => {
    expect(canvasTypeBasis(1080, 1080)).toBeCloseTo(1080, 6);
  });

  it('never returns zero for a degenerate canvas', () => {
    expect(canvasTypeBasis(0, 0)).toBeGreaterThan(0);
  });
});

describe('columnsFor', () => {
  it('gives a portrait canvas fewer columns than a landscape one', () => {
    // Twelve columns on a story are narrower than a word, and the engine then
    // spends its time merging them back together.
    expect(columnsFor(1080, 1920)).toBeLessThan(columnsFor(1200, 675));
  });

  it('is driven by aspect, not by pixel count', () => {
    expect(columnsFor(1080, 1080)).toBe(columnsFor(4320, 4320));
  });
});

describe('buildGrid', () => {
  it('never lets a margin intrude past a platform safe zone', () => {
    // Instagram Story declares a 140px CTA bar starting at y=1780, so nothing
    // may be placed below that however generous the margin would otherwise be.
    // (Read from the preset — Reel's bottom UI starts at 1720 and Story's does
    // not, and hardcoding the wrong sibling's number is an easy mistake.)
    const grid = buildGrid(STORY);
    expect(grid.bottom).toBeLessThanOrEqual(1780);
  });

  it('produces a usable box strictly inside the canvas', () => {
    for (const canvas of [SQUARE, STORY, BANNER]) {
      const grid = buildGrid(canvas);
      expect(grid.left).toBeGreaterThan(0);
      expect(grid.top).toBeGreaterThan(0);
      expect(grid.right).toBeLessThan(canvas.width);
      expect(grid.bottom).toBeLessThan(canvas.height);
      expect(grid.right).toBeGreaterThan(grid.left);
      expect(grid.bottom).toBeGreaterThan(grid.top);
    }
  });

  it('keeps the margin-to-type relationship constant where nothing else binds', () => {
    // What actually reads as "the same design at another size": the gap
    // between the type and the edge stays proportional to the type.
    //
    // Only holds where the DESIGN margin is the binding constraint. A platform
    // inset is allowed to win — that is the point of it — so this compares two
    // formats whose sides no safe zone touches, rather than asserting a
    // constancy the safe zones are entitled to break.
    const square = buildGrid(SQUARE);
    const story = buildGrid(STORY);
    expect(story.left / story.typeBasis).toBeCloseTo(square.left / square.typeBasis, 3);
  });

  it('never lets the design margin be squeezed below its ratio', () => {
    // The other half of the same rule: a safe zone may push content further in,
    // never let it drift closer to the edge than the design allows.
    for (const canvas of [SQUARE, STORY, BANNER]) {
      const grid = buildGrid(canvas);
      expect(grid.left).toBeGreaterThanOrEqual(grid.typeBasis * 0.055 - 0.001);
      expect(grid.top).toBeGreaterThanOrEqual(grid.typeBasis * 0.055 - 0.001);
    }
  });

  it('fills the usable width exactly with columns and gutters', () => {
    for (const canvas of [SQUARE, STORY, BANNER]) {
      const grid = buildGrid(canvas);
      const spanned =
        grid.columns * grid.columnWidth + (grid.columns - 1) * grid.gutter;
      expect(spanned).toBeCloseTo(grid.right - grid.left, 6);
    }
  });

  it('survives a canvas with no declared safe zones', () => {
    const grid = buildGrid({ width: 800, height: 800 });
    expect(grid.columnWidth).toBeGreaterThan(0);
    expect(Number.isFinite(grid.baseline)).toBe(true);
  });

  it('survives a degenerate canvas without producing NaN', () => {
    const grid = buildGrid({ width: 0, height: 0 });
    for (const [key, value] of Object.entries(grid)) {
      expect(Number.isFinite(value as number), `${key} is ${value}`).toBe(true);
    }
    expect(grid.columnWidth).toBeGreaterThan(0);
  });
});

describe('column geometry', () => {
  const grid = buildGrid(SQUARE);

  it('starts the first column at the left margin', () => {
    expect(columnX(grid, 0)).toBeCloseTo(grid.left, 6);
  });

  it('ends the last column at the right margin', () => {
    expect(columnX(grid, grid.columns - 1) + columnSpan(grid, 1)).toBeCloseTo(grid.right, 6);
  });

  it('includes the gutters inside a multi-column span', () => {
    // A span of two is two columns AND the gutter between them, not two
    // columns' worth of width — the difference is a visible misalignment.
    expect(columnSpan(grid, 2)).toBeCloseTo(grid.columnWidth * 2 + grid.gutter, 6);
  });

  it('clamps an out-of-range column instead of running off the canvas', () => {
    expect(columnX(grid, -5)).toBeCloseTo(grid.left, 6);
    expect(columnX(grid, 999)).toBeCloseTo(columnX(grid, grid.columns), 6);
    expect(columnSpan(grid, 999)).toBeCloseTo(grid.right - grid.left, 6);
    expect(columnSpan(grid, 0)).toBeCloseTo(grid.columnWidth, 6);
  });

  it('boxes a half-width column correctly', () => {
    const half = grid.columns / 2;
    const box = columnBox(grid, half, half);
    expect(box.x).toBeCloseTo(columnX(grid, half), 6);
    expect(box.x + box.width).toBeCloseTo(grid.right, 6);
    expect(box.height).toBeCloseTo(grid.bottom - grid.top, 6);
  });
});

describe('snapToBaseline', () => {
  const grid = buildGrid(SQUARE);

  it('lands values on the rhythm', () => {
    const snapped = snapToBaseline(grid, grid.baseline * 3.4);
    expect(snapped / grid.baseline).toBeCloseTo(3, 6);
  });

  it('is idempotent', () => {
    const once = snapToBaseline(grid, 137.2);
    expect(snapToBaseline(grid, once)).toBeCloseTo(once, 6);
  });
});
