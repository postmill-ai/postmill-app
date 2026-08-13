import type { DesignerElement } from './designer.store';
import {
  type DesignerPathNode,
  normalisePathToBox,
  smoothPathNodes,
  simplifyPoints,
  translatePathNodes,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/path-geometry';

/**
 * Pure state machine for the Pen tool group.
 *
 * The canvas owns pointer plumbing; everything about what a click means to a
 * path lives here so it can be tested without Konva. Points arriving here are
 * in DOCUMENT space; the element is only built (and re-origined to local space)
 * when the path is finished.
 */

export interface PenDraft {
  /** Committed anchors, in document space. */
  nodes: DesignerPathNode[];
  closed: boolean;
}

export const emptyDraft = (): PenDraft => ({ nodes: [], closed: false });

/** How near the first anchor a click must land to close the path, in px. */
export const CLOSE_HIT_RADIUS = 8;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/**
 * A click with the standard Pen: append an anchor, or close the path when it
 * lands on the first one.
 */
export const penClick = (
  draft: PenDraft,
  point: { x: number; y: number },
  hitRadius = CLOSE_HIT_RADIUS
): { draft: PenDraft; finished: boolean } => {
  if (draft.nodes.length >= 2 && dist(point, draft.nodes[0]) <= hitRadius) {
    return { draft: { ...draft, closed: true }, finished: true };
  }
  return {
    draft: { ...draft, nodes: [...draft.nodes, { x: point.x, y: point.y }] },
    finished: false,
  };
};

/**
 * Dragging after placing an anchor pulls out its bezier handles. The handles
 * stay mirrored, which is what makes the standard Pen produce smooth curves.
 */
export const penDragHandle = (
  draft: PenDraft,
  point: { x: number; y: number }
): PenDraft => {
  if (!draft.nodes.length) return draft;
  const nodes = draft.nodes.slice();
  const last = nodes[nodes.length - 1];
  const dx = point.x - last.x;
  const dy = point.y - last.y;
  nodes[nodes.length - 1] = {
    ...last,
    outX: last.x + dx,
    outY: last.y + dy,
    inX: last.x - dx,
    inY: last.y - dy,
  };
  return { ...draft, nodes };
};

/** Curvature Pen: anchors only; handles are inferred on finish. */
export const curvatureFinish = (draft: PenDraft): PenDraft => ({
  ...draft,
  nodes: smoothPathNodes(draft.nodes, draft.closed),
});

/** Freeform Pen: simplify the pointer trail, then smooth it. */
export const freeformFinish = (
  points: { x: number; y: number }[],
  tolerance = 2.5
): PenDraft => {
  const simplified = simplifyPoints(points, tolerance);
  return { nodes: smoothPathNodes(simplified, false), closed: false };
};

/** Index of the anchor within `radius` of a point, or -1. */
export const findNodeAt = (
  nodes: DesignerPathNode[],
  point: { x: number; y: number },
  radius = CLOSE_HIT_RADIUS
): number => nodes.findIndex((n) => dist(n, point) <= radius);

/**
 * Insert an anchor on the segment nearest `point` (Add Anchor Point). Uses the
 * closest point on each straight chord as the proxy for the curve — accurate
 * enough to pick the right segment, which is all this needs to decide.
 */
export const addAnchorAt = (
  nodes: DesignerPathNode[],
  closed: boolean,
  point: { x: number; y: number }
): DesignerPathNode[] => {
  if (nodes.length < 2) return nodes;
  const segCount = closed ? nodes.length : nodes.length - 1;
  let best = { index: 0, d: Infinity };
  for (let i = 0; i < segCount; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2)) : 0;
    const d = dist(point, { x: a.x + dx * t, y: a.y + dy * t });
    if (d < best.d) best = { index: i, d };
  }
  const out = nodes.slice();
  out.splice(best.index + 1, 0, { x: point.x, y: point.y });
  return out;
};

/** Remove the anchor at `index`, refusing to drop below two. */
export const deleteAnchorAt = (
  nodes: DesignerPathNode[],
  index: number
): DesignerPathNode[] => {
  if (index < 0 || index >= nodes.length || nodes.length <= 2) return nodes;
  return nodes.filter((_, i) => i !== index);
};

/**
 * Convert Point: toggle an anchor between corner (no handles) and smooth
 * (mirrored handles derived from its neighbours).
 */
export const convertAnchorAt = (
  nodes: DesignerPathNode[],
  index: number,
  closed = false
): DesignerPathNode[] => {
  if (index < 0 || index >= nodes.length) return nodes;
  const n = nodes[index];
  const isSmooth =
    typeof n.inX === 'number' ||
    typeof n.outX === 'number';

  const out = nodes.slice();
  if (isSmooth) {
    out[index] = { x: n.x, y: n.y };
    return out;
  }
  // Smooth just this one by borrowing the neighbour-difference tangent.
  const smoothed = smoothPathNodes(nodes, closed);
  out[index] = smoothed[index];
  return out;
};

/**
 * A path is born with a stroke colour: both renderers draw nothing when
 * `stroke` is unset, so a colourless path would be an invisible layer. The
 * options bar offers this as its default too.
 */
export const PEN_DEFAULT_STROKE = '#000000';

/**
 * Turn a finished draft into a `path` element, re-origined so the stored nodes
 * are element-local and the box hugs the path.
 */
export const buildPathElement = (
  draft: PenDraft,
  options: Record<string, unknown> = {}
): DesignerElement | null => {
  if (draft.nodes.length < 2) return null;
  const box = normalisePathToBox(draft.nodes);
  if (!box) return null;

  return {
    id: '',
    type: 'path',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    nodes: box.nodes,
    closed: draft.closed,
    stroke: (options.stroke as string) || PEN_DEFAULT_STROKE,
    strokeWidth: Number(options.strokeWidth ?? 2),
    // Only a closed path gets a fill; an open one would fill its chord.
    fill: draft.closed ? ((options.fill as string) || undefined) : undefined,
  };
};

/**
 * Re-fit an edited node list back onto its element, keeping the path anchored
 * where the user left it. Direct Selection edits go through here so the element
 * box never drifts out of sync with the geometry it contains.
 */
export const refitPathElement = (
  el: DesignerElement,
  localNodes: DesignerPathNode[]
): Partial<DesignerElement> => {
  const docNodes = translatePathNodes(localNodes, el.x, el.y);
  const box = normalisePathToBox(docNodes);
  if (!box) return {};
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    nodes: box.nodes,
  };
};
