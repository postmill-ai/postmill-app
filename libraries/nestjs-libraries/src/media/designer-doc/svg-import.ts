/**
 * An SVG document → editable `path` elements.
 *
 * Dropping an SVG on the Designer produced a raster: it was uploaded, loaded as
 * an `<img>` and placed as an `image` element, so a vector arrived as pixels
 * and could not be recoloured or reshaped. With a `d` parser (`svg-path-parse`)
 * the shapes can come in as real paths instead.
 *
 * Deliberately a SHAPE importer, not an SVG renderer: `path`, `rect`, `circle`,
 * `ellipse`, `line`, `polyline` and `polygon` become paths; gradients, filters,
 * clip paths, text and embedded images do not, and the caller is told how many
 * elements were skipped rather than being handed a silently wrong drawing.
 *
 * Parsing is done with regular expressions rather than a DOM: this module is
 * imported by the browser and by the server, and the server has no DOMParser.
 * The input is a file the user chose, and nothing here executes or fetches
 * anything — every match is read as geometry.
 */

import { parseSvgPathData } from './svg-path-parse';
import {
  normalisePathToBox,
  pathBounds,
  scalePathNodes,
  translatePathNodes,
  type DesignerPathNode,
} from './path-geometry';

export interface ImportedShape {
  nodes: DesignerPathNode[];
  closed: boolean;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface SvgImportResult {
  shapes: ImportedShape[];
  /** The source viewBox, or the width/height attributes, or null. */
  viewBox: { width: number; height: number } | null;
  /** Tags that carry visible content this importer cannot express. */
  skipped: string[];
}

/** Elements that draw something we deliberately do not translate. */
const UNSUPPORTED = ['text', 'image', 'use', 'foreignObject', 'symbol'];

const attr = (tag: string, name: string): string | undefined => {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`).exec(tag);
  return match ? (match[1] ?? match[2]) : undefined;
};

const numAttr = (tag: string, name: string, fallback = 0): number => {
  const raw = attr(tag, name);
  const value = raw === undefined ? NaN : parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
};

/**
 * A paint attribute, or undefined when it should not be painted.
 *
 * SVG's default fill is black and `none` means no paint at all — treating the
 * two the same would flood every stroked outline with black.
 */
const paint = (tag: string, name: string): string | undefined => {
  const raw = attr(tag, name)?.trim();
  if (!raw || raw === 'none' || raw.startsWith('url(')) return undefined;
  return raw;
};

/** `points="0,0 10,0 10,10"` as a path-data string. */
const pointsToPathData = (points: string, close: boolean): string => {
  const numbers = points.trim().split(/[\s,]+/).map(parseFloat).filter(Number.isFinite);
  if (numbers.length < 4) return '';
  let d = `M${numbers[0]},${numbers[1]}`;
  for (let i = 2; i + 1 < numbers.length; i += 2) d += ` L${numbers[i]},${numbers[i + 1]}`;
  return close ? `${d} Z` : d;
};

/** A rounded rect as path data, so one code path covers every primitive. */
const rectPathData = (tag: string): string => {
  const x = numAttr(tag, 'x');
  const y = numAttr(tag, 'y');
  const w = numAttr(tag, 'width');
  const h = numAttr(tag, 'height');
  if (!(w > 0) || !(h > 0)) return '';
  const rx = Math.min(numAttr(tag, 'rx', numAttr(tag, 'ry')), w / 2);
  const ry = Math.min(numAttr(tag, 'ry', rx), h / 2);
  if (!(rx > 0) && !(ry > 0)) {
    return `M${x},${y} H${x + w} V${y + h} H${x} Z`;
  }
  return (
    `M${x + rx},${y} H${x + w - rx} A${rx},${ry} 0 0 1 ${x + w},${y + ry}` +
    ` V${y + h - ry} A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}` +
    ` H${x + rx} A${rx},${ry} 0 0 1 ${x},${y + h - ry}` +
    ` V${y + ry} A${rx},${ry} 0 0 1 ${x + rx},${y} Z`
  );
};

/** An ellipse as two arcs — one `A` cannot describe a full ellipse. */
const ellipsePathData = (cx: number, cy: number, rx: number, ry: number): string =>
  !(rx > 0) || !(ry > 0)
    ? ''
    : `M${cx - rx},${cy} A${rx},${ry} 0 1 0 ${cx + rx},${cy} A${rx},${ry} 0 1 0 ${cx - rx},${cy} Z`;

/** Path data for one element tag, or '' when it draws nothing translatable. */
const tagPathData = (name: string, tag: string): string => {
  switch (name) {
    case 'path':
      return attr(tag, 'd') || '';
    case 'rect':
      return rectPathData(tag);
    case 'circle': {
      const r = numAttr(tag, 'r');
      return ellipsePathData(numAttr(tag, 'cx'), numAttr(tag, 'cy'), r, r);
    }
    case 'ellipse':
      return ellipsePathData(
        numAttr(tag, 'cx'),
        numAttr(tag, 'cy'),
        numAttr(tag, 'rx'),
        numAttr(tag, 'ry')
      );
    case 'line':
      return `M${numAttr(tag, 'x1')},${numAttr(tag, 'y1')} L${numAttr(tag, 'x2')},${numAttr(tag, 'y2')}`;
    case 'polyline':
      return pointsToPathData(attr(tag, 'points') || '', false);
    case 'polygon':
      return pointsToPathData(attr(tag, 'points') || '', true);
    default:
      return '';
  }
};

/** Parse an SVG document into shapes, in the source's own coordinate space. */
export const parseSvgDocument = (svg: string): SvgImportResult => {
  const shapes: ImportedShape[] = [];
  const skipped: string[] = [];

  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] || '';
  const viewBoxRaw = attr(root, 'viewBox');
  let viewBox: SvgImportResult['viewBox'] = null;
  if (viewBoxRaw) {
    const parts = viewBoxRaw.trim().split(/[\s,]+/).map(parseFloat);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      viewBox = { width: parts[2], height: parts[3] };
    }
  }
  if (!viewBox) {
    const w = numAttr(root, 'width');
    const h = numAttr(root, 'height');
    if (w > 0 && h > 0) viewBox = { width: w, height: h };
  }

  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(svg)) !== null) {
    const name = match[1].toLowerCase();
    const tag = match[0];

    if (UNSUPPORTED.includes(name)) {
      if (!skipped.includes(name)) skipped.push(name);
      continue;
    }

    const d = tagPathData(name, tag);
    if (!d) continue;

    for (const sub of parseSvgPathData(d)) {
      shapes.push({
        nodes: sub.nodes,
        closed: sub.closed,
        // SVG's initial fill is black; only an explicit `none` means unfilled.
        fill: attr(tag, 'fill') === undefined ? '#000000' : paint(tag, 'fill'),
        stroke: paint(tag, 'stroke'),
        strokeWidth: attr(tag, 'stroke-width') ? numAttr(tag, 'stroke-width') : undefined,
      });
    }
  }

  return { shapes, viewBox, skipped };
};

export interface ImportedPathElement {
  type: 'path';
  x: number;
  y: number;
  width: number;
  height: number;
  nodes: DesignerPathNode[];
  closed: boolean;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

/**
 * Every shape in an SVG as `path` elements, laid out inside `box`.
 *
 * Positions are preserved RELATIVE TO EACH OTHER — the whole drawing is scaled
 * as one, so a logo's parts stay where they belong instead of each shape being
 * normalised into the same box.
 */
export const svgToPathElements = (
  svg: string,
  box: { x: number; y: number; width: number; height: number }
): { elements: ImportedPathElement[]; skipped: string[] } => {
  const { shapes, viewBox, skipped } = parseSvgDocument(svg);
  if (!shapes.length) return { elements: [], skipped };

  // Source extent: the viewBox when there is one, otherwise the union of the
  // shapes — a hand-written SVG often has neither viewBox nor dimensions.
  let sourceWidth = viewBox?.width ?? 0;
  let sourceHeight = viewBox?.height ?? 0;
  let originX = 0;
  let originY = 0;
  if (!sourceWidth || !sourceHeight) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const shape of shapes) {
      const b = pathBounds(shape.nodes);
      if (!b) continue;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    if (!Number.isFinite(minX)) return { elements: [], skipped };
    originX = minX;
    originY = minY;
    sourceWidth = Math.max(1, maxX - minX);
    sourceHeight = Math.max(1, maxY - minY);
  }

  // Uniform, so nothing is distorted; centred in the box like a `contain` fit.
  const scale = Math.min(box.width / sourceWidth, box.height / sourceHeight);
  const offsetX = box.x + (box.width - sourceWidth * scale) / 2;
  const offsetY = box.y + (box.height - sourceHeight * scale) / 2;

  const elements: ImportedPathElement[] = [];
  for (const shape of shapes) {
    const placed = scalePathNodes(
      translatePathNodes(shape.nodes, -originX, -originY),
      scale,
      scale
    );
    const normalised = normalisePathToBox(placed);
    if (!normalised) continue;
    elements.push({
      type: 'path',
      x: offsetX + normalised.x,
      y: offsetY + normalised.y,
      width: normalised.width,
      height: normalised.height,
      nodes: normalised.nodes,
      closed: shape.closed,
      fill: shape.fill,
      stroke: shape.stroke,
      strokeWidth: shape.strokeWidth ? shape.strokeWidth * scale : undefined,
    });
  }

  return { elements, skipped };
};
