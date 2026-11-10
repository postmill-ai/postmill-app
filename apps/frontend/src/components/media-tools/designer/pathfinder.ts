'use client';

import {
  booleanPolygons,
  flattenPath,
  pointInPolygon,
  polygonArea,
  polygonToNodes,
  type BooleanOp,
  type Point,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/path-boolean';
import { offsetPolygon, roundCorners } from '@postmill-ai/nestjs-libraries/media/designer-doc/path-offset';
import { pathContours } from '@postmill-ai/nestjs-libraries/media/designer-doc/path-geometry';
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

const uniteRegions = (input: Point[][]): Point[][] => {
  const regions = [...input];
  let index = 0;
  while (index < regions.length) {
    let merged = false;
    for (let other = index + 1; other < regions.length; other++) {
      const united = booleanPolygons(regions[index], regions[other], 'unite').polygons;
      if (united.length !== 1) continue;
      regions[index] = united[0];
      regions.splice(other, 1);
      merged = true;
      break;
    }
    index = merged ? 0 : index + 1;
  }
  return regions;
};

const divideRegions = (regions: Point[][], clip: Point[]): Point[][] => {
  const pieces = regions.flatMap((region) => [
    ...booleanPolygons(region, clip, 'subtract').polygons,
    ...booleanPolygons(region, clip, 'intersect').polygons,
  ]);
  let remainder = [clip];
  for (const region of regions) {
    remainder = remainder.flatMap((part) =>
      booleanPolygons(part, region, 'subtract').polygons
    );
  }
  return [...pieces, ...remainder];
};

const representativePoint = (polygon: Point[]): Point => {
  const box = bounds([polygon])!;
  const candidates = [
    { x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length, y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  ];
  for (let y = 1; y < 20; y++) {
    for (let x = 1; x < 20; x++) {
      candidates.push({ x: box.x + (box.width * x) / 20, y: box.y + (box.height * y) / 20 });
    }
  }
  return candidates.find((point) => pointInPolygon(point, polygon)) || polygon[0];
};

const elementOutlines = (element: DesignerElement): Point[][] =>
  pathContours(element).map((nodes) => elementOutline({ ...element, nodes }));

const groupRegions = (regions: Point[][]): Point[][][] => {
  const ordered = [...regions].sort((a, b) =>
    Math.abs(polygonArea(b)) - Math.abs(polygonArea(a))
  );
  const groups: Point[][][] = [];
  for (const region of ordered) {
    const container = groups.find((group) =>
      region.length > 0 && region.every((point) => pointInPolygon(point, group[0]))
    );
    if (container) container.push(region);
    else groups.push([region]);
  }
  return groups;
};

export const pathfinderMany = (
  elements: DesignerElement[],
  op: BooleanOp
): PathfinderResult | null => {
  const [subject, ...clips] = elements;
  if (!subject || !clips.length) return null;
  let regions = elementOutlines(subject);

  if (op === 'outline') {
    regions.push(...clips.flatMap(elementOutlines));
  } else {
    for (const clip of clips.flatMap(elementOutlines)) {
      if (op === 'unite') regions = uniteRegions([...regions, clip]);
      if (op === 'subtract') {
        regions = regions.flatMap((region) => booleanPolygons(region, clip, 'subtract').polygons);
      }
      if (op === 'intersect') {
        regions = regions.flatMap((region) => booleanPolygons(region, clip, 'intersect').polygons);
      }
      if (op === 'divide') regions = divideRegions(regions, clip);
      if (op === 'exclude') regions = divideRegions(regions, clip);
      if (!regions.length) return null;
    }
    if (op === 'exclude') {
      const outlines = elements.flatMap(elementOutlines);
      regions = regions.filter((region) => {
        const point = representativePoint(region);
        return outlines.filter((outline) => pointInPolygon(point, outline)).length % 2 === 1;
      });
    }
  }
  if (!regions.length) return null;

  const groups = op === 'outline' ? regions.map((region) => [region]) : groupRegions(regions);
  const toElement = (group: Point[][]): Partial<DesignerElement> | null => {
    const box = bounds(group);
    if (!box) return null;
    const localContours = group.map((polygon) =>
      polygonToNodes(polygon.map((point) => ({ x: point.x - box.x, y: point.y - box.y })))
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
      nodes: localContours[0],
      subpaths: localContours.length > 1 ? localContours : undefined,
      fillRule: localContours.length > 1 ? 'evenodd' : undefined,
      closed: true,
      fill: op === 'outline' ? 'transparent' : subject.fill,
      fillGradient: op === 'outline' ? undefined : subject.fillGradient,
      stroke: op === 'outline' ? subject.stroke || subject.fill : subject.stroke,
      strokeWidth: op === 'outline' ? subject.strokeWidth ?? 1 : subject.strokeWidth,
      strokeStyle: subject.strokeStyle,
      name: subject.name,
    };
  };
  const converted = groups.map(toElement);
  if (converted.some((element) => !element)) return null;
  const [element, ...extra] = converted as Partial<DesignerElement>[];
  return { element, extra };
};

export const pathfinder = (
  subject: DesignerElement,
  clip: DesignerElement,
  op: BooleanOp
): PathfinderResult | null => pathfinderMany([subject, clip], op);

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
