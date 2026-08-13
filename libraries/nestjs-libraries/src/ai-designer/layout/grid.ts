import { canvasMarginPx, getSafeZoneInset } from '../../media/designer-doc/reflow';

/**
 * The modular grid a composition is laid out on.
 *
 * The composer currently derives every position from per-layout magic constants
 * — a copy-band ratio here, a stack-balance shift there — which is why the six
 * layouts cannot be varied and why a seventh means another table of numbers.
 * A grid replaces all of that with one set of rules a composition can reference
 * by name: columns, a gutter, margins, and a baseline unit that vertical
 * rhythm snaps to.
 *
 * Everything is derived from the canvas and its platform safe zones, so the
 * same composition lands correctly on a 1080 square and a 1080x1920 story
 * without a second set of numbers.
 */

export interface Grid {
  /** Canvas. */
  width: number;
  height: number;
  /** The usable box, inset for platform chrome. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Column geometry inside the usable box. */
  columns: number;
  gutter: number;
  columnWidth: number;
  /** Vertical rhythm unit. Type sizes and gaps are multiples of this. */
  baseline: number;
  /** The reference length type scales from. */
  typeBasis: number;
}

/**
 * How many columns a canvas gets.
 *
 * Aspect-driven rather than width-driven: a 1080x1920 story is not a "wide"
 * canvas just because it has as many pixels across as a square. Twelve columns
 * on a portrait canvas produces columns too narrow to hold a word, and the
 * layout engine then spends its time merging them back.
 */
export const columnsFor = (width: number, height: number): number => {
  const aspect = width / height;
  if (aspect >= 1.6) return 12;
  if (aspect >= 0.9) return 8;
  return 6;
};

/**
 * The length type scales from.
 *
 * NOT called `typeBasisPx` — `reflow.ts` exports a function of that name which
 * takes a `typeBudget` and means something different. Two functions with one
 * name, one of which is the source of the squashed-variant bug, is exactly how
 * the wrong one gets imported.
 *
 * The geometric mean of the two sides, NOT `Math.min(width, height)`. The min
 * rule is what made a 1200x675 banner size its headline for 675px — type
 * scaled for the short axis on a canvas whose whole character is the long one —
 * and it is the root cause of the squashed channel variants. The mean tracks
 * area, so a wider canvas genuinely gets larger type instead of the same type
 * with more empty space beside it.
 */
export const canvasTypeBasis = (width: number, height: number): number =>
  Math.sqrt(Math.max(1, width) * Math.max(1, height));

export const buildGrid = (canvas: {
  width: number;
  height: number;
  formatId?: string;
}): Grid => {
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const typeBasis = canvasTypeBasis(width, height);

  // Two independent constraints on the usable box: the designer's margin, and
  // the platform's own chrome. Take whichever is more conservative on each
  // edge — a story's bottom 200px belongs to the caption UI whatever the
  // margin says.
  const safe = getSafeZoneInset(canvas.formatId || '', width, height);
  // `canvasMarginPx`, NOT a margin of the engine's own. The composer has always
  // used it, every element the factories place is measured against it, and its
  // own assertions pin copy to it — an engine margin a few pixels away from the
  // established one puts every ported layout marginally out of true against the
  // half of the design it does not yet own.
  const margin = canvasMarginPx(width, height);

  const left = Math.max(margin, safe.left);
  const top = Math.max(margin, safe.top);
  const right = Math.min(width - margin, safe.right);
  const bottom = Math.min(height - margin, safe.bottom);

  const columns = columnsFor(width, height);
  const usableWidth = Math.max(1, right - left);
  const gutter = typeBasis * 0.02;
  const columnWidth = Math.max(1, (usableWidth - gutter * (columns - 1)) / columns);

  return {
    width,
    height,
    left,
    top,
    right,
    bottom,
    columns,
    gutter,
    columnWidth,
    // A quarter of the body size. Small enough that real type sizes land on it,
    // large enough that snapping to it is visible as rhythm rather than noise.
    baseline: typeBasis * 0.01,
    typeBasis,
  };
};

/** The x of a column edge, 0-indexed. `col === columns` is the right edge. */
export const columnX = (grid: Grid, col: number): number => {
  const c = Math.max(0, Math.min(grid.columns, col));
  return grid.left + c * (grid.columnWidth + grid.gutter);
};

/** The width spanned by `span` columns, including the gutters between them. */
export const columnSpan = (grid: Grid, span: number): number => {
  const s = Math.max(1, Math.min(grid.columns, span));
  return s * grid.columnWidth + (s - 1) * grid.gutter;
};

/** A box covering `span` columns starting at `col`, full usable height. */
export const columnBox = (
  grid: Grid,
  col: number,
  span: number
): { x: number; y: number; width: number; height: number } => ({
  x: columnX(grid, col),
  y: grid.top,
  width: columnSpan(grid, span),
  height: Math.max(1, grid.bottom - grid.top),
});

/** Snap a length to the vertical rhythm. */
export const snapToBaseline = (grid: Grid, value: number): number =>
  Math.round(value / grid.baseline) * grid.baseline;
