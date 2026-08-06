import type { DesignerLayerStyle } from './designer-doc.schema';

/**
 * Layer-style geometry and ordering, shared by both renderers.
 *
 * The pixel work itself has to happen against a real canvas, so each renderer
 * owns its own drawing; what lives here is everything that must AGREE between
 * them — paint order, which effects sit under vs over the layer, the global
 * light angle, and the offset maths.
 */

/**
 * Photoshop's paint order. Effects below the layer are drawn first, then the
 * layer, then the ones on top. Getting this wrong is the most visible way two
 * renderers can disagree, so it is defined once.
 */
export const STYLE_ORDER: DesignerLayerStyle['type'][] = [
  // Beneath the layer:
  'drop-shadow',
  'outer-glow',
  // The layer itself is painted here.
  'color-overlay',
  'gradient-overlay',
  'pattern-overlay',
  'satin',
  'inner-glow',
  'inner-shadow',
  'bevel-emboss',
  'stroke',
];

/** Effects painted BEFORE the layer's own pixels. */
export const UNDER_STYLES: ReadonlySet<string> = new Set(['drop-shadow', 'outer-glow']);

/** The document-wide light angle a style follows when `useGlobalLight`. */
export const DEFAULT_GLOBAL_LIGHT = 120;

export const isStyleEnabled = (style: DesignerLayerStyle): boolean =>
  style.enabled !== false;

/** Sort a layer's styles into paint order, dropping disabled ones. */
export const orderedStyles = (
  styles: DesignerLayerStyle[] | undefined
): DesignerLayerStyle[] => {
  if (!styles?.length) return [];
  return styles
    .filter(isStyleEnabled)
    .slice()
    .sort(
      (a, b) => STYLE_ORDER.indexOf(a.type) - STYLE_ORDER.indexOf(b.type)
    );
};

export const splitStyles = (
  styles: DesignerLayerStyle[] | undefined
): { under: DesignerLayerStyle[]; over: DesignerLayerStyle[] } => {
  const ordered = orderedStyles(styles);
  return {
    under: ordered.filter((s) => UNDER_STYLES.has(s.type)),
    over: ordered.filter((s) => !UNDER_STYLES.has(s.type)),
  };
};

/**
 * The x/y offset a shadow-like style casts.
 *
 * Photoshop's angle is measured counter-clockwise from east and describes where
 * the LIGHT is, so the shadow falls the opposite way — hence the negated sine
 * and the flipped signs. Getting this wrong mirrors every shadow.
 */
export const styleOffset = (
  style: DesignerLayerStyle,
  globalLight = DEFAULT_GLOBAL_LIGHT
): { x: number; y: number } => {
  const angle = style.useGlobalLight ? globalLight : (style.angle ?? globalLight);
  const distance = style.distance ?? 0;
  const rad = (angle * Math.PI) / 180;
  return {
    x: -Math.cos(rad) * distance,
    y: Math.sin(rad) * distance,
  };
};

/** Blur radius for a shadow/glow, combining `size` and `spread`. */
export const styleBlur = (style: DesignerLayerStyle): number => {
  const size = style.size ?? 0;
  const spread = (style.spread ?? 0) / 100;
  // Spread trades blur for solidity, as Photoshop's does.
  return Math.max(0, size * (1 - spread));
};

/** How far a style extends past the layer box, for sizing offscreen buffers. */
export const stylePadding = (styles: DesignerLayerStyle[] | undefined): number => {
  let pad = 0;
  for (const s of orderedStyles(styles)) {
    const offset = styleOffset(s);
    const reach =
      Math.max(Math.abs(offset.x), Math.abs(offset.y)) + (s.size ?? 0) + (s.depth ?? 0) / 10;
    if (reach > pad) pad = reach;
  }
  return Math.ceil(pad);
};

/**
 * A layer's effects, including the legacy `boxShadow` that predates them.
 *
 * `boxShadow` was a full inspector section on images and shapes — colour, blur,
 * two offsets — that NO renderer ever read, sitting directly above an Effects
 * panel whose drop shadow works. Rather than teach a second shadow model to
 * four renderers, an old `boxShadow` is translated into the drop-shadow style
 * it always meant, so existing documents render what their inspector promised.
 *
 * An explicit drop-shadow effect wins: if a document has both, the one the user
 * can still see and edit is the effect.
 *
 * `offsetX/offsetY` are cartesian, while a style stores angle + distance and
 * casts the shadow AWAY from the light — hence the inverted vector (see
 * `styleOffset`, which this is the exact inverse of).
 */
export const elementStyles = (el: {
  styles?: DesignerLayerStyle[];
  boxShadow?: { color?: string; blur?: number; offsetX?: number; offsetY?: number };
}): DesignerLayerStyle[] | undefined => {
  const shadow = el.boxShadow;
  if (!shadow) return el.styles;
  if (el.styles?.some((s) => s.type === 'drop-shadow' && isStyleEnabled(s))) {
    return el.styles;
  }
  return [...(el.styles ?? []), styleFromBoxShadow(shadow)];
};

/** The exact inverse of `styleOffset`: cartesian offsets → angle + distance. */
export const styleFromBoxShadow = (shadow: {
  color?: string;
  blur?: number;
  offsetX?: number;
  offsetY?: number;
}): DesignerLayerStyle => {
  const dx = shadow.offsetX ?? 0;
  const dy = shadow.offsetY ?? 0;
  return {
    type: 'drop-shadow',
    color: shadow.color ?? '#000000',
    opacity: 1,
    distance: Math.hypot(dx, dy),
    angle: ((Math.atan2(dy, -dx) * 180) / Math.PI + 360) % 360,
    size: shadow.blur ?? 0,
    spread: 0,
  };
};
