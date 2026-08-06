import type { DesignerElement, VideoClip } from './designer.store';
import {
  DEFAULT_POLYGON_SIDES,
  DEFAULT_STAR_POINTS,
  DEFAULT_STAR_INNER_RATIO,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/shape-geometry';
import { parseSvgPathData } from '@postmill-ai/nestjs-libraries/media/designer-doc/svg-path-parse';
import {
  normalisePathToBox,
  pathBounds,
  scalePathNodes,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/path-geometry';

/**
 * Geometry and element construction for drag-to-draw tools.
 *
 * Pure so the modifier-key rules can be unit-tested without a Konva stage —
 * the canvas supplies two document-space points and the modifier state.
 */

export interface DrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawModifiers {
  /** Constrain to a square / circle / 45° line. */
  shift?: boolean;
  /** Draw outward from the start point instead of corner-to-corner. */
  alt?: boolean;
}

/** Smallest drag that counts as a draw rather than a click. */
export const MIN_DRAW_SIZE = 4;

/** How long a shape drawn on a timeline lasts by default. */
const SHAPE_CLIP_MS = 4000;

/**
 * Turn a drag into a normalised rect, honouring Shift (constrain) and Alt
 * (from centre). Dragging up or left yields a positive-size rect, so callers
 * never have to handle inverted boxes.
 */
export const rectFromDrag = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  mods: DrawModifiers = {}
): DrawRect => {
  let dx = end.x - start.x;
  let dy = end.y - start.y;

  if (mods.shift) {
    // Constrain to a square, keeping the direction of each axis.
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * size;
    dy = Math.sign(dy || 1) * size;
  }

  if (mods.alt) {
    // Alt draws outward from the start point, so it becomes the centre.
    return {
      x: start.x - Math.abs(dx),
      y: start.y - Math.abs(dy),
      width: Math.abs(dx) * 2,
      height: Math.abs(dy) * 2,
    };
  }

  return {
    x: Math.min(start.x, start.x + dx),
    y: Math.min(start.y, start.y + dy),
    width: Math.abs(dx),
    height: Math.abs(dy),
  };
};

/** Did the user drag far enough to mean it? */
export const isMeaningfulDraw = (rect: DrawRect): boolean =>
  rect.width >= MIN_DRAW_SIZE || rect.height >= MIN_DRAW_SIZE;

/** Which `shape` value a shape-tool id produces. */
export const shapeForTool = (toolId: string): DesignerElement['shape'] => {
  switch (toolId) {
    case 'shape-ellipse':
      return 'ellipse';
    case 'shape-triangle':
      return 'triangle';
    case 'shape-polygon':
      return 'polygon';
    case 'shape-star':
      return 'star';
    case 'shape-line':
      return 'line';
    // Custom Shape yields a real `path` element when the options bar carries
    // path data (see `buildShapeElement`); an empty field still draws a rect.
    case 'shape-custom':
    case 'shape-rect':
    default:
      return 'rect';
  }
};

const DEFAULT_FILL = '#2B5CD3';

/**
 * An SVG `d` string as a `path` element scaled into `rect`.
 *
 * The largest contour wins, because a `path` element holds one — for a letter
 * or a ring that is the outer shape rather than its counter. Shared by the
 * Custom Shape tool and SVG import.
 */
export const pathElementFromData = (
  d: string,
  rect: DrawRect
): DesignerElement | null => {
  const subpaths = parseSvgPathData(d);
  if (!subpaths.length) return null;

  const biggest = subpaths
    .map((sub) => {
      const b = pathBounds(sub.nodes);
      return { sub, area: b ? (b.maxX - b.minX) * (b.maxY - b.minY) : 0 };
    })
    .sort((a, b) => b.area - a.area)[0].sub;

  const normalised = normalisePathToBox(biggest.nodes);
  if (!normalised) return null;

  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  return {
    id: '',
    type: 'path',
    x: rect.x,
    y: rect.y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    // Scaled to the drag, so the path fills the box the user drew.
    nodes: scalePathNodes(
      normalised.nodes,
      width / normalised.width,
      height / normalised.height
    ),
    closed: biggest.closed,
    fill: DEFAULT_FILL,
  } as DesignerElement;
};

/**
 * Build the element a shape tool should insert for a completed drag.
 * `options` comes from the tool's options-bar state.
 */
export const buildShapeElement = (
  toolId: string,
  rect: DrawRect,
  options: Record<string, unknown> = {}
): DesignerElement => {
  // A Custom Shape with path data is a PATH, not a shape — the parser turns
  // `d` into the same editable nodes the Pen tool writes, so it can be reshaped
  // afterwards rather than being a frozen preset.
  if (toolId === 'shape-custom' && typeof options.pathData === 'string' && options.pathData.trim()) {
    const path = pathElementFromData(options.pathData, rect);
    if (path) return path;
  }

  const shape = shapeForTool(toolId);
  const isLine = shape === 'line';
  const strokeWidth = Number(options.strokeWidth ?? (isLine ? 3 : 0)) || undefined;

  const el: DesignerElement = {
    id: '',
    type: 'shape',
    x: rect.x,
    y: rect.y,
    width: Math.max(1, Math.round(rect.width)),
    // A line is a diagonal across its box, so a purely horizontal drag would
    // otherwise collapse it to a zero-height box and become unselectable.
    height: Math.max(isLine ? 0 : 1, Math.round(rect.height)),
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    shape,
    fill: isLine ? undefined : DEFAULT_FILL,
    stroke: isLine ? DEFAULT_FILL : undefined,
    strokeWidth,
  };

  if (shape === 'polygon') {
    el.sides = Math.round(Number(options.sides ?? DEFAULT_POLYGON_SIDES));
  }
  if (shape === 'star') {
    el.sides = Math.round(Number(options.points ?? DEFAULT_STAR_POINTS));
    el.innerRatio =
      Number(options.innerRatio ?? DEFAULT_STAR_INNER_RATIO * 100) / 100;
  }
  if (shape === 'rect') {
    const radius = Number(options.cornerRadius ?? 0);
    if (radius > 0) el.borderRadius = radius;
  }

  return el;
};

/**
 * The same drag, expressed as a video CLIP.
 *
 * A shape is a shape whichever kind of document it lands in, so the geometry is
 * taken straight off the element builder and only the timing fields are added.
 * Deriving it rather than duplicating the option handling means the tool
 * options bar keeps working identically in both modes.
 */
export const buildShapeClip = (
  toolId: string,
  rect: DrawRect,
  playheadMs: number,
  durationMs: number,
  options: Record<string, unknown> = {}
): VideoClip => {
  const el = buildShapeElement(toolId, rect, options);
  const startMs = Math.max(0, Math.min(playheadMs, Math.max(0, durationMs - 1000)));

  return {
    id: '',
    startMs,
    endMs: Math.min(startMs + SHAPE_CLIP_MS, durationMs || startMs + SHAPE_CLIP_MS),
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rotation: 0,
    opacity: 1,
    shape: el.shape,
    sides: el.sides,
    innerRatio: el.innerRatio,
    fill: el.fill,
    stroke: el.stroke,
    strokeWidth: el.strokeWidth,
    borderRadius: el.borderRadius,
  };
};
