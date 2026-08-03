import { snapToBaseline, type Grid } from './grid';

/**
 * A two-pass measure/arrange layout, the thing the six hard-coded templates
 * were standing in for.
 *
 * Every template in the old composer answered "where does the headline go" with
 * a constant tuned against one canvas. A box model answers it by asking the
 * headline how tall it is at the width it has been given, then stacking what
 * comes back. That is the whole difference between six layouts and any layout.
 *
 * MEASURE walks bottom-up: each node reports the height it needs for a given
 * width. ARRANGE walks top-down: each node is handed a box and distributes it
 * among its children. Doing it in one pass is the classic mistake — a stack
 * cannot centre its contents until it knows how tall they are, and it cannot
 * know that until they have been measured at the width the stack will give
 * them.
 */

export type Align = 'start' | 'center' | 'end' | 'stretch';
export type Justify = 'start' | 'center' | 'end' | 'space-between';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a leaf needs in order to report its height. */
export interface MeasureContext {
  grid: Grid;
  /**
   * Intrinsic height of a leaf at a given width, in px.
   *
   * Injected rather than imported so the engine stays pure and testable: real
   * text measurement needs a canvas and a loaded font, and a layout spec should
   * not need either to assert that a stack stacks.
   */
  measureLeaf(node: LeafNode, width: number): number;
}

export interface LeafNode {
  kind: 'leaf';
  /** The plan slot this box will be filled with. */
  slotId: string;
  /** Fixed aspect (width / height), for imagery that must not distort. */
  aspect?: number;
  /** Height as a share of the container, for bands and panels. */
  heightRatio?: number;
  /** Minimum height in baseline units. */
  minBaselines?: number;
  /** Do not shrink this node when a stack overflows. */
  rigid?: boolean;
  /**
   * Take whatever height the stack has left over instead of reporting an
   * intrinsic one — a hero image filling the space below the copy.
   *
   * Available on a leaf as well as a container because that is the common case.
   * A `fill` CONTAINER claims the leftover box and then lays its children out
   * inside it normally; it does not stretch them, and should not — a stack of a
   * headline and a CTA wants to be positioned within the space, not inflated to
   * fit it.
   */
  fill?: boolean;
}

export interface ContainerNode {
  kind: 'stack' | 'row' | 'overlay';
  children: LayoutNode[];
  /** Gap between children, in baseline units. */
  gap?: number;
  /** Padding on all sides, in baseline units. */
  padding?: number;
  align?: Align;
  justify?: Justify;
  /** Relative sizes of children along the main axis. Defaults to equal. */
  weights?: number[];
  /** Fills its parent rather than reporting an intrinsic height. */
  fill?: boolean;
}

export type LayoutNode = LeafNode | ContainerNode;

export interface Placement {
  slotId: string;
  box: Box;
}

const isLeaf = (n: LayoutNode): n is LeafNode => n.kind === 'leaf';

const px = (grid: Grid, baselines: number | undefined) =>
  (baselines ?? 0) * grid.baseline;

/**
 * MEASURE — the intrinsic height of a node laid out at `width`.
 *
 * A `fill` container reports 0: it has no opinion about its own height and
 * takes whatever is left. That is what lets a stack mix "as tall as its text"
 * with "everything that remains" without a second mechanism.
 */
export const measure = (
  node: LayoutNode,
  width: number,
  ctx: MeasureContext
): number => {
  if (isLeaf(node)) {
    if (node.fill) return 0;
    if (node.aspect) return width / node.aspect;
    const intrinsic = ctx.measureLeaf(node, width);
    const floor = px(ctx.grid, node.minBaselines);
    return Math.max(intrinsic, floor);
  }

  if (node.fill) return 0;

  const pad = px(ctx.grid, node.padding) * 2;
  const gap = px(ctx.grid, node.gap);
  const inner = Math.max(1, width - pad);

  if (node.kind === 'row') {
    // A row is as tall as its tallest child, each measured at its own share.
    const widths = distribute(inner, node.children.length, gap, node.weights);
    const heights = node.children.map((c, i) => measure(c, widths[i], ctx));
    return Math.max(0, ...heights) + pad;
  }

  if (node.kind === 'overlay') {
    // Children share the box, so the overlay is as tall as the tallest.
    const heights = node.children.map((c) => measure(c, inner, ctx));
    return Math.max(0, ...heights) + pad;
  }

  // stack
  const heights = node.children.map((c) => measure(c, inner, ctx));
  const gaps = Math.max(0, node.children.length - 1) * gap;
  return heights.reduce((a, b) => a + b, 0) + gaps + pad;
};

/**
 * Split `total` into `count` parts separated by `gap`, honouring `weights`.
 *
 * Weights are relative, so `[2, 1]` is two-thirds/one-third regardless of what
 * numbers are used — which is what lets a composition say "the image is twice
 * the copy" without knowing the canvas.
 */
export const distribute = (
  total: number,
  count: number,
  gap: number,
  weights?: number[]
): number[] => {
  if (count <= 0) return [];
  const available = Math.max(0, total - gap * (count - 1));
  const w =
    weights && weights.length === count && weights.every((n) => n > 0)
      ? weights
      : new Array(count).fill(1);
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((n) => (available * n) / sum);
};

/**
 * ARRANGE — hand a node a box and collect where every slot landed.
 *
 * Overflow is resolved by SHRINKING the flexible children proportionally
 * rather than by letting the stack run past its box. A layout that overflows
 * is not a layout; the old composer's answer was to shrink the type until it
 * fit, which is why its copy sizes were unpredictable.
 */
export const arrange = (
  node: LayoutNode,
  box: Box,
  ctx: MeasureContext
): Placement[] => {
  if (isLeaf(node)) return [{ slotId: node.slotId, box }];

  const pad = px(ctx.grid, node.padding);
  const gap = px(ctx.grid, node.gap);
  const inner: Box = {
    x: box.x + pad,
    y: box.y + pad,
    width: Math.max(1, box.width - pad * 2),
    height: Math.max(1, box.height - pad * 2),
  };

  if (node.kind === 'overlay') {
    return node.children.flatMap((c) => arrange(c, inner, ctx));
  }

  if (node.kind === 'row') {
    const widths = distribute(inner.width, node.children.length, gap, node.weights);
    const out: Placement[] = [];
    let x = inner.x;
    node.children.forEach((child, i) => {
      const h =
        node.align === 'stretch'
          ? inner.height
          : Math.min(inner.height, measure(child, widths[i], ctx) || inner.height);
      const y =
        node.align === 'center'
          ? inner.y + (inner.height - h) / 2
          : node.align === 'end'
            ? inner.y + inner.height - h
            : inner.y;
      out.push(...arrange(child, { x, y, width: widths[i], height: h }, ctx));
      x += widths[i] + gap;
    });
    return out;
  }

  // stack
  const heights = node.children.map((c) => {
    const h = measure(c, inner.width, ctx);
    // A `fill` child measured 0 claims what is left, below.
    return h;
  });
  const gaps = Math.max(0, node.children.length - 1) * gap;
  const intrinsic = heights.reduce((a, b) => a + b, 0);

  const fillIndices = node.children
    .map((c, i) => (c.fill ? i : -1))
    .filter((i) => i >= 0);

  let resolved = heights.slice();

  if (fillIndices.length) {
    // Give the leftovers to the fill children, evenly.
    const leftover = Math.max(0, inner.height - intrinsic - gaps);
    const share = leftover / fillIndices.length;
    for (const i of fillIndices) resolved[i] = share;
  } else if (intrinsic + gaps > inner.height) {
    // Overflow: shrink everything that is allowed to shrink, in proportion.
    const rigid = node.children.map((c) => isLeaf(c) && c.rigid);
    const rigidTotal = resolved.reduce((a, h, i) => a + (rigid[i] ? h : 0), 0);
    const flexTotal = resolved.reduce((a, h, i) => a + (rigid[i] ? 0 : h), 0);
    const budget = Math.max(0, inner.height - gaps - rigidTotal);
    const k = flexTotal > 0 ? Math.min(1, budget / flexTotal) : 1;
    resolved = resolved.map((h, i) => (rigid[i] ? h : h * k));
  }

  const used = resolved.reduce((a, b) => a + b, 0) + gaps;
  let y = inner.y;
  if (!fillIndices.length) {
    if (node.justify === 'center') y += (inner.height - used) / 2;
    else if (node.justify === 'end') y += inner.height - used;
  }

  const spread =
    node.justify === 'space-between' && node.children.length > 1 && !fillIndices.length
      ? Math.max(0, inner.height - used) / (node.children.length - 1)
      : 0;

  const out: Placement[] = [];
  node.children.forEach((child, i) => {
    const h = resolved[i];
    const w =
      node.align === 'stretch' || !isLeaf(child)
        ? inner.width
        : Math.min(inner.width, inner.width);
    const x =
      node.align === 'center'
        ? inner.x + (inner.width - w) / 2
        : node.align === 'end'
          ? inner.x + inner.width - w
          : inner.x;
    out.push(...arrange(child, { x, y, width: w, height: h }, ctx));
    y += h + gap + spread;
  });
  return out;
};

/**
 * Snap every placement's vertical edges to the grid's rhythm.
 *
 * Applied once at the end rather than inside `arrange`, because snapping
 * mid-tree accumulates: a stack of six boxes each rounded up by half a baseline
 * grows by three, and the last one falls out of the canvas.
 */
export const snapPlacements = (grid: Grid, placements: Placement[]): Placement[] =>
  placements.map((p) => ({
    ...p,
    box: {
      ...p.box,
      y: snapToBaseline(grid, p.box.y),
      height: Math.max(grid.baseline, snapToBaseline(grid, p.box.height)),
    },
  }));
