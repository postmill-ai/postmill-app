/**
 * What every layer style is called and what you can set on it.
 *
 * `layer-style-render` decides what each property *does*; this table adds the
 * range, the step and the human label so one generic editor covers all ten
 * effects rather than ten hand-built panels. A spec ties the two together — a
 * slider whose range disagrees with the schema is the failure this table exists
 * to prevent, and the schema's own bounds are tighter than they look
 * (`opacity` is 0–1, not 0–100).
 *
 * Two effects are deliberately simplified, identically on the canvas and on the
 * server rather than improved on one side only: **satin** renders as a second
 * inner shadow, and **bevel & emboss** draws only the highlight half. The
 * properties they ignore (`shadowColor`, `soften`, and the bevel `style`
 * variants) are therefore not listed here — showing a control that changes
 * nothing would be worse than not showing it.
 */

import type { DesignerLayerStyle } from './designer-doc.schema';

export interface LayerStyleParam {
  key: 'opacity' | 'angle' | 'distance' | 'spread' | 'size' | 'depth';
  label: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}

export interface LayerStyleDescriptor {
  type: DesignerLayerStyle['type'];
  label: string;
  params: LayerStyleParam[];
  /** Shows a colour swatch bound to `style.color`. */
  color?: boolean;
  /** Shows a colour swatch bound to `style.highlightColor`. */
  highlight?: boolean;
  /** Shows the gradient ramp bound to `style.gradient`. */
  gradient?: boolean;
  /** Shows the pattern picker bound to `style.pattern`. */
  pattern?: boolean;
  /** Shows the outside/inside/center placement control. */
  position?: boolean;
  /** Offers "use the document's global light" instead of a free angle. */
  globalLight?: boolean;
}

const OPACITY: LayerStyleParam = {
  key: 'opacity',
  label: 'Opacity',
  min: 0,
  max: 1,
  step: 0.01,
};
const ANGLE: LayerStyleParam = {
  key: 'angle',
  label: 'Angle',
  min: 0,
  max: 360,
  step: 1,
  suffix: '°',
};
const DISTANCE: LayerStyleParam = {
  key: 'distance',
  label: 'Distance',
  min: 0,
  max: 200,
  step: 1,
  suffix: 'px',
};
const SPREAD: LayerStyleParam = {
  key: 'spread',
  label: 'Spread',
  min: 0,
  max: 100,
  step: 1,
  suffix: '%',
};
const SIZE: LayerStyleParam = {
  key: 'size',
  label: 'Size',
  min: 0,
  max: 200,
  step: 1,
  suffix: 'px',
};

export const LAYER_STYLE_DESCRIPTORS: LayerStyleDescriptor[] = [
  {
    type: 'drop-shadow',
    label: 'Drop Shadow',
    params: [OPACITY, ANGLE, DISTANCE, SPREAD, SIZE],
    color: true,
    globalLight: true,
  },
  {
    type: 'inner-shadow',
    label: 'Inner Shadow',
    params: [OPACITY, ANGLE, DISTANCE, SPREAD, SIZE],
    color: true,
    globalLight: true,
  },
  {
    type: 'outer-glow',
    label: 'Outer Glow',
    params: [OPACITY, SPREAD, SIZE],
    color: true,
  },
  {
    type: 'inner-glow',
    label: 'Inner Glow',
    params: [OPACITY, SPREAD, SIZE],
    color: true,
  },
  {
    type: 'stroke',
    label: 'Stroke',
    params: [OPACITY, SIZE],
    color: true,
    position: true,
  },
  {
    type: 'bevel-emboss',
    label: 'Bevel & Emboss',
    params: [
      OPACITY,
      ANGLE,
      { key: 'depth', label: 'Depth', min: 0, max: 1000, step: 10 },
    ],
    highlight: true,
    globalLight: true,
  },
  {
    type: 'satin',
    label: 'Satin',
    params: [OPACITY, ANGLE, DISTANCE, SIZE],
    color: true,
  },
  {
    type: 'color-overlay',
    label: 'Color Overlay',
    params: [OPACITY],
    color: true,
  },
  {
    type: 'gradient-overlay',
    label: 'Gradient Overlay',
    // No ANGLE here: this effect's angle belongs to its GRADIENT, and the
    // gradient editor owns it. The generic slider wrote `style.angle`, which
    // only shadow geometry reads — so it stored a number nothing ever painted.
    params: [OPACITY],
    gradient: true,
  },
  {
    type: 'pattern-overlay',
    label: 'Pattern Overlay',
    params: [OPACITY],
    pattern: true,
  },
];

export const layerStyleDescriptor = (
  type: DesignerLayerStyle['type']
): LayerStyleDescriptor | undefined =>
  LAYER_STYLE_DESCRIPTORS.find((d) => d.type === type);
