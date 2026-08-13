'use client';

import {
  booleanPolygons,
  flattenPath,
  pointInPolygon,
  polygonToNodes,
  type BooleanOp,
  type Point,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/path-boolean';
import { offsetPolygon, roundCorners } from '@postmill-ai/nestjs-libraries/media/designer-doc/path-offset';
import { pointsForShape } from '@postmill-ai/nestjs-libraries/media/designer-doc/shape-geometry';
import type { DesignerElement } from './designer.store';

/**
 * Pathfinder, Offset Path and Live Corners as document edits.
 *
 * The geometry is shared and pure; what lives here is the part that is specific
 * to this app — turning a `shape` into an outline, working in canvas rather
 * than element-local coordinates so two elements can be combined, and putting
 * the result back as a `path` element sized to its own bounds.
 */

/** A shape or path as a polygon in CANVAS coordinates. */
export const elementOutline = (el: DesignerElement): Point[] => {
  const local: Point[] = (() => {
    if (el.type === 'path') return flattenPath(el.nodes || []);
    if (el.shape === 'ellipse') {
      const pts: Point[] = [];
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        pts.push({
          x: el.width / 2 + (Math.cos(a) * el.width) / 2,
          y: el.height / 2 + (Math.sin(a) * el.height) / 2,
        });
      }
      return pts;
    }
    const shaped = pointsForShape(el.shape, el.width, el.height, el.sides, el.innerRatio);
    if (shaped) return shaped.map((p) => ({ x: p.x, y: p.y }));
    return [
      { x: 0, y: 0 },
      { x: el.width, y: 0 },
      { x: el.width, y: el.height },
      { x: 0, y: el.height },
    ];
  })();

  return local.map((p) => ({ x: p.x + el.x, y: p.y + el.y }));
};

const bounds = (polys: Point[][]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const p of poly) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
};

export interface PathfinderResult {
  /** The element to add, and the ids it replaces. */
  element: Partial<DesignerElement>;
  /**
   * Extra subpaths, when the operation produced more than one region.
   * `divide` is the common case — it returns each region as its own
   * element — but a disjoint unite/exclude lands here too.
   */
  extra: Partial<DesignerElement>[];
}

/**
 * Combine two elements.
 *
 * The result is always a `path`, because only a path can express an arbitrary
 * outline — a united pair of stars is not a star. Style is inherited from the
 * subject, which is the element the user selected first.
 */
export const pathfinder = (
  subject: DesignerElement,
  clip: DesignerElement,
  op: BooleanOp
): PathfinderResult | null => {
  const result = booleanPolygons(elementOutline(subject), elementOutline(clip), op);
  if (!result.polygons.length) return null;

  const toElement = (polys: Point[][]): Partial<DesignerElement> | null => {
    const box = bounds(polys);
    if (!box) return null;
    // A path's nodes are element-LOCAL, so the combined outline is re-based
    // onto its own bounding box.
    const nodes = polygonToNodes(
      polys[0].map((p) => ({ x: p.x - box.x, y: p.y - box.y }))
    );
    return {
      type: 'path',
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotation: 0,
      opacity: subject.opacity,
      locked: false,
      hidden: false,
      nodes,
      closed: true,
      fill: subject.fill,
      fillGradient: subject.fillGradient,
      stroke: subject.stroke,
      strokeWidth: subject.strokeWidth,
      strokeStyle: subject.strokeStyle,
      name: subject.name,
    };
  };

  // `divide` returns each region as its own element. Every other op yields one
  // outline — but a disjoint unite/exclude still produces several STANDALONE
  // regions, which must become their own elements or the shapes are silently
  // lost (the clip element is consumed by the caller either way).
  const separate = op === 'divide';
  const rings = result.polygons;
  if (!separate && rings.length > 1) {
    // A ring fully inside the first is a HOLE (subtract/exclude with the clip
    // contained in the subject). The single-ring path model cannot express
    // holes, so reject rather than render the hole solid — wrong pixels are
    // worse than no-op.
    const hole = rings
      .slice(1)
      .some((ring) => ring.length > 0 && pointInPolygon(ring[0], rings[0]));
    if (hole) return null;
  }
  const first = toElement([rings[0]]);
  if (!first) return null;

  const extra = rings
    .slice(1)
    .map((poly) => toElement([poly]))
    .filter((e): e is Partial<DesignerElement> => !!e);

  return { element: first, extra };
};

/** Offset Path, as an in-place edit of one element's own outline. */
export const offsetElement = (
  el: DesignerElement,
  distance: number
): Partial<DesignerElement> | null => {
  const offset = offsetPolygon(elementOutline(el), distance);
  const box = bounds([offset]);
  if (!box) return null;
  return {
    type: 'path',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    nodes: polygonToNodes(offset.map((p) => ({ x: p.x - box.x, y: p.y - box.y }))),
    closed: true,
  };
};

/** Live Corners, as an in-place edit. */
export const roundElementCorners = (
  el: DesignerElement,
  radius: number
): Partial<DesignerElement> | null => {
  const outline = elementOutline(el).map((p) => ({ x: p.x - el.x, y: p.y - el.y }));
  const rounded = roundCorners(polygonToNodes(outline), radius);
  if (!rounded.length) return null;
  return { type: 'path', nodes: rounded, closed: true };
};
