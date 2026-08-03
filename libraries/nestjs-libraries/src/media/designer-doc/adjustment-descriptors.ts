/**
 * What every adjustment layer is called and what you can set on it.
 *
 * `defaultAdjustmentValues` decides the neutral value of each scalar and
 * `applyAdjustment` reads them; this table adds the range, the step and the
 * human label so the inspector can be generated rather than hand-built sixteen
 * times. A spec ties the three together — a slider whose range disagrees with
 * what the op accepts is the failure this table exists to prevent.
 *
 * Ranges follow Photoshop's own dialogs where they exist, so muscle memory
 * transfers.
 */

import type { DesignerAdjustment, DesignerGradient } from './designer-doc.schema';
import { defaultAdjustmentValues } from './pixel-ops';

export interface AdjustmentParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Read from `defaultAdjustmentValues` — never stated twice. */
  default: number;
  suffix?: string;
  /** Rendered as a checkbox; stored as 0/1 because `values` is numeric. */
  boolean?: boolean;
}

export interface AdjustmentDescriptor {
  type: DesignerAdjustment['type'];
  label: string;
  /** Grouped in the New Adjustment Layer submenu and in the inspector. */
  params: AdjustmentParam[];
  /** Needs the curves editor (per-channel control points). */
  curves?: boolean;
  /** Needs a gradient ramp, and the ramp a new layer starts with. */
  gradient?: DesignerGradient;
  /** Needs a colour swatch, stored on `adjustment.color`. */
  color?: string;
  /** Shows the histogram of what sits beneath it. */
  histogram?: boolean;
}

const def = (type: DesignerAdjustment['type'], key: string): number =>
  defaultAdjustmentValues(type)[key] ?? 0;

const p = (
  type: DesignerAdjustment['type'],
  key: string,
  label: string,
  min: number,
  max: number,
  step = 1,
  suffix?: string
): AdjustmentParam => ({
  key,
  label,
  min,
  max,
  step,
  default: def(type, key),
  suffix,
});

export const ADJUSTMENT_DESCRIPTORS: AdjustmentDescriptor[] = [
  {
    type: 'vibrance',
    label: 'Color and Vibrance',
    params: [
      p('vibrance', 'vibrance', 'Vibrance', -100, 100, 1, '%'),
      p('vibrance', 'saturation', 'Saturation', -100, 100, 1, '%'),
    ],
  },
  {
    type: 'clarity-dehaze',
    label: 'Clarity and Dehaze',
    params: [
      p('clarity-dehaze', 'clarity', 'Clarity', -100, 100, 1, '%'),
      p('clarity-dehaze', 'dehaze', 'Dehaze', -100, 100, 1, '%'),
    ],
  },
  {
    type: 'brightness-contrast',
    label: 'Brightness/Contrast',
    params: [
      p('brightness-contrast', 'brightness', 'Brightness', -100, 100, 1),
      p('brightness-contrast', 'contrast', 'Contrast', -100, 100, 1),
    ],
  },
  {
    type: 'levels',
    label: 'Levels',
    histogram: true,
    params: [
      p('levels', 'black', 'Black point', 0, 254, 1),
      p('levels', 'gamma', 'Gamma', 0.1, 4, 0.01),
      p('levels', 'white', 'White point', 1, 255, 1),
    ],
  },
  {
    type: 'curves',
    label: 'Curves',
    curves: true,
    histogram: true,
    params: [],
  },
  {
    type: 'exposure',
    label: 'Exposure',
    params: [
      p('exposure', 'exposure', 'Exposure', -5, 5, 0.01, ' stops'),
      p('exposure', 'offset', 'Offset', -0.5, 0.5, 0.01),
    ],
  },
  {
    type: 'hue-saturation',
    label: 'Hue/Saturation',
    params: [
      p('hue-saturation', 'hue', 'Hue', -180, 180, 1, '°'),
      p('hue-saturation', 'saturation', 'Saturation', -100, 100, 1, '%'),
      p('hue-saturation', 'lightness', 'Lightness', -100, 100, 1, '%'),
    ],
  },
  {
    type: 'color-balance',
    label: 'Color Balance',
    params: [
      p('color-balance', 'red', 'Cyan — Red', -100, 100, 1),
      p('color-balance', 'green', 'Magenta — Green', -100, 100, 1),
      p('color-balance', 'blue', 'Yellow — Blue', -100, 100, 1),
    ],
  },
  {
    type: 'black-white',
    label: 'Black & White',
    params: [
      p('black-white', 'red', 'Reds', 0, 2, 0.01),
      p('black-white', 'green', 'Greens', 0, 2, 0.01),
      p('black-white', 'blue', 'Blues', 0, 2, 0.01),
    ],
  },
  {
    type: 'photo-filter',
    label: 'Photo Filter',
    color: '#ec8a00',
    params: [
      p('photo-filter', 'density', 'Density', 0, 100, 1, '%'),
      {
        ...p('photo-filter', 'preserveLuminosity', 'Preserve luminosity', 0, 1, 1),
        boolean: true,
      },
    ],
  },
  {
    type: 'channel-mixer',
    label: 'Channel Mixer',
    params: [
      p('channel-mixer', 'rr', 'Red ← Red', -200, 200, 1, '%'),
      p('channel-mixer', 'rg', 'Red ← Green', -200, 200, 1, '%'),
      p('channel-mixer', 'rb', 'Red ← Blue', -200, 200, 1, '%'),
      p('channel-mixer', 'gr', 'Green ← Red', -200, 200, 1, '%'),
      p('channel-mixer', 'gg', 'Green ← Green', -200, 200, 1, '%'),
      p('channel-mixer', 'gb', 'Green ← Blue', -200, 200, 1, '%'),
      p('channel-mixer', 'br', 'Blue ← Red', -200, 200, 1, '%'),
      p('channel-mixer', 'bg', 'Blue ← Green', -200, 200, 1, '%'),
      p('channel-mixer', 'bb', 'Blue ← Blue', -200, 200, 1, '%'),
    ],
  },
  {
    type: 'selective-color',
    label: 'Selective Color',
    params: [
      p('selective-color', 'cyan', 'Cyan', -100, 100, 1, '%'),
      p('selective-color', 'magenta', 'Magenta', -100, 100, 1, '%'),
      p('selective-color', 'yellow', 'Yellow', -100, 100, 1, '%'),
    ],
  },
  { type: 'invert', label: 'Invert', params: [] },
  {
    type: 'posterize',
    label: 'Posterize',
    params: [p('posterize', 'levels', 'Levels', 2, 255, 1)],
  },
  {
    type: 'threshold',
    label: 'Threshold',
    histogram: true,
    params: [p('threshold', 'level', 'Threshold level', 1, 255, 1)],
  },
  {
    type: 'gradient-map',
    label: 'Gradient Map',
    gradient: {
      type: 'linear',
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    },
    params: [],
  },
];

export const ADJUSTMENT_DESCRIPTOR_BY_TYPE: Record<
  DesignerAdjustment['type'],
  AdjustmentDescriptor
> = ADJUSTMENT_DESCRIPTORS.reduce(
  (acc, d) => {
    acc[d.type] = d;
    return acc;
  },
  {} as Record<DesignerAdjustment['type'], AdjustmentDescriptor>
);

/**
 * The default curve: a straight line from black to white, which `curveLut`
 * turns into an identity ramp. A Curves layer added and left alone is a no-op,
 * the rule every adjustment follows.
 */
export const IDENTITY_CURVE = [
  { x: 0, y: 0 },
  { x: 255, y: 255 },
];

export const CURVE_CHANNELS = ['rgb', 'r', 'g', 'b'] as const;
export type CurveChannel = (typeof CURVE_CHANNELS)[number];
