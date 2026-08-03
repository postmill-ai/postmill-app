/**
 * Sole source of truth for the DesignerDoc contract.
 *
 * Frontend: `import type` only. The runtime schema is backend-only; the client
 * bundle must not depend on zod.
 *
 * This module intentionally resolves the drift between the frontend store copy
 * and the former server-side mirror in design-render.types.ts.
 */

import { z } from 'zod';
import { parseDesignerFilterToken } from '../design-render/filter-tokens';
import { MAX_MOTION_BLUR_SAMPLES } from './motion-blur';
import {
  DESIGNER_DOC_VERSION,
  MAX_CLIPS_PER_TRACK,
  MAX_DIMENSION,
  MAX_ELEMENTS_PER_OUTPUT,
  MAX_FILTERS_PER_ELEMENT,
  MAX_FONT_SIZE,
  MAX_LAYER_STYLES,
  MAX_SMART_FILTERS,
  MAX_OPS_PER_REQUEST,
  MAX_OUTPUTS,
  MAX_PATH_NODES,
  MAX_TEXT_LEN,
  MAX_TRACKS,
  MAX_VIDEO_DURATION_MS,
} from './designer-doc.limits';

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), max);

const strictNum = (min: number, max: number) =>
  z.number().finite().min(min).max(max);

const lenientNum = (min: number, max: number, fallback: number) =>
  z.number().finite().catch(fallback).transform((v) => clamp(v, min, max));

const dualObject = <S extends z.ZodRawShape, L extends z.ZodRawShape>(
  strictShape: S,
  lenientShape: L
) => ({
  strict: z.object(strictShape).strict(),
  lenient: z.object(lenientShape).passthrough(),
});

export const MAX_OPS_PER_REQUEST_SCHEMA = z
  .array(z.any())
  .max(MAX_OPS_PER_REQUEST);

export const ColorSchema = z.string().max(64);

export const SrcSchema = z
  .string()
  .max(2048)
  .refine(
    (s) => s.startsWith('data:') || /^https?:\/\//.test(s),
    'src must be a data: or http(s) URL'
  );

export const DesignerFilterStringSchema = z
  .string()
  .max(32)
  .refine(
    (s) => parseDesignerFilterToken(s) !== null,
    'invalid filter token'
  );

const FiltersSchema = z
  .array(DesignerFilterStringSchema)
  .max(MAX_FILTERS_PER_ELEMENT)
  .optional();


/** Symbol definitions live on the doc, referenced by every instance. */
const symbolDefinitionShape = (element: z.ZodTypeAny) =>
  z.object({
    id: z.string().max(200),
    name: z.string().max(200),
    width: z.number().finite().min(1).max(MAX_DIMENSION),
    height: z.number().finite().min(1).max(MAX_DIMENSION),
    children: z.array(element).max(MAX_ELEMENTS_PER_OUTPUT),
  });

const SymbolOverridesSchema = z
  .record(
    z.string().max(200),
    z.object({
      text: z.string().max(MAX_TEXT_LEN).optional(),
      src: SrcSchema.optional(),
      fileId: z.string().max(200).optional(),
      fill: ColorSchema.optional(),
    })
  )
  .optional();

const SlotSchema = z
  .object({
    name: z.string().max(120),
    kind: z.enum(['text', 'image', 'color']),
    order: z.number().finite().min(0).max(10000).optional(),
  })
  .optional();

const CaptionStyleSchema = z
  .object({
    preset: z
      .enum(['plain', 'karaoke', 'word-pop', 'bold-highlight', 'box-highlight'])
      .optional(),
    activeColor: ColorSchema.optional(),
    inactiveColor: ColorSchema.optional(),
    spokenColor: ColorSchema.optional(),
    highlightColor: ColorSchema.optional(),
  })
  .optional();

const BeatsSchema = z
  .array(z.number().finite().min(0).max(MAX_VIDEO_DURATION_MS))
  .max(4000)
  .optional();

/** One definition for the element and clip stroke options alike. */
const StrokeStyleSchema = z
  .object({
    dash: z.array(z.number().finite().min(0).max(1000)).max(8).optional(),
    dashOffset: z.number().finite().optional(),
    lineCap: z.enum(['butt', 'round', 'square']).optional(),
    lineJoin: z.enum(['miter', 'round', 'bevel']).optional(),
    miterLimit: z.number().finite().min(1).max(100).optional(),
    arrowStart: z.enum(['none', 'arrow', 'triangle', 'circle', 'square', 'bar']).optional(),
    arrowEnd: z.enum(['none', 'arrow', 'triangle', 'circle', 'square', 'bar']).optional(),
  })
  .optional();

/** One definition, shared by layers and clips — they carry the same stack. */
const SmartFilterStackSchema = z
  .array(
    z.object({
      id: z.string().max(60),
      params: z
        .record(
          z.string().max(40),
          z.union([z.number(), z.string().max(200), z.boolean()])
        )
        .optional(),
      enabled: z.boolean().optional(),
    })
  )
  .max(MAX_SMART_FILTERS)
  .optional();

// ---------------------------------------------------------------------------
// Explicit TypeScript contract
// ---------------------------------------------------------------------------
// The project's tsconfig has `strictNullChecks: false`. Under that setting
// zod's `z.infer` marks every object field as optional, which would break the
// frontend store and renderer that depend on required fields (e.g.
// `output.width`). The runtime schema remains the sole validation authority;
// the explicit interfaces below are the compile-time source of truth.
// ---------------------------------------------------------------------------

export interface TextRun {
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fill?: string;
  underline?: boolean;
}

export interface DesignerTextShadow {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

export interface DesignerTextStroke {
  color: string;
  width: number;
}

// The path node shape lives with the tracing code it belongs to; re-exported
// here so `DesignerElement` consumers get it from the one contract module (see
// designer-doc.drift.spec.ts).
export type { DesignerPathNode } from './path-geometry';
export type { KeyframeEase, EaseHandles, EasePreset } from './keyframes';
export type { MotionBlur } from './motion-blur';
export type { StrokeStyle, ArrowHead, LineCap, LineJoin } from './stroke-style';
export type { CaptionStyle, CaptionPreset } from './caption-styles';
export type { SymbolDefinition, SymbolOverrides, SlotDefinition } from './symbols';
import type { SymbolDefinition, SymbolOverrides, SlotDefinition } from './symbols';
import type { CaptionStyle } from './caption-styles';
import type { StrokeStyle } from './stroke-style';
import type { MotionBlur } from './motion-blur';
import type { KeyframeEase } from './keyframes';
import type { DesignerPathNode } from './path-geometry';

export interface DesignerCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignerMask {
  type: 'shape' | 'text';
  shape?: 'ellipse' | 'rounded-rect' | 'triangle' | 'star' | 'hexagon' | 'heart';
  cornerRadius?: number;
  text?: string;
  fontFamily?: string;
  fontWeight?: number;
}

export interface DesignerGradientStop {
  offset: number;
  color: string;
}

export interface DesignerGradient {
  type: 'linear' | 'radial';
  angle?: number;
  stops: DesignerGradientStop[];
}

export interface DesignerBackground {
  type: 'color' | 'gradient' | 'image';
  color?: string;
  gradient?: DesignerGradient;
  src?: string;
  fileId?: string;
  /** Cover-crop anchor (0–1) for image backgrounds; defaults to center. */
  focalPoint?: { x: number; y: number };
  /**
   * Subject centroid in SOURCE-image space (0–1) behind `focalPoint`, plus the
   * intrinsic size needed to convert it. Same contract as the image ELEMENT
   * fields: `focalPoint` is only valid for the box aspect it was computed
   * against, so a seeded output re-derives it from these.
   */
  subjectPoint?: { x: number; y: number };
  naturalWidth?: number;
  naturalHeight?: number;
}

/**
 * Photoshop's blend modes. The first 16 map straight to canvas
 * `globalCompositeOperation`; the rest are evaluated by `pixel-ops` on both the
 * client and the server so they render identically.
 */
export type DesignerBlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light'
  | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity'
  | 'dissolve' | 'linear-burn' | 'linear-dodge' | 'vivid-light' | 'linear-light'
  | 'pin-light' | 'hard-mix' | 'subtract' | 'divide'
  | 'darker-color' | 'lighter-color';

/** One layer style (effect). `enabled: false` keeps settings while hiding it. */
export interface DesignerLayerStyle {
  type:
    | 'drop-shadow' | 'inner-shadow' | 'outer-glow' | 'inner-glow'
    | 'stroke' | 'bevel-emboss' | 'satin'
    | 'color-overlay' | 'gradient-overlay' | 'pattern-overlay';
  enabled?: boolean;
  color?: string;
  opacity?: number;
  blendMode?: DesignerBlendMode;
  /** Shadow/glow geometry. Angle is degrees; `useGlobalLight` follows the doc. */
  angle?: number;
  useGlobalLight?: boolean;
  distance?: number;
  spread?: number;
  size?: number;
  /** Stroke placement. */
  position?: 'outside' | 'inside' | 'center';
  /** Bevel shape and depth. */
  style?: 'outer-bevel' | 'inner-bevel' | 'emboss' | 'pillow-emboss';
  depth?: number;
  soften?: number;
  highlightColor?: string;
  shadowColor?: string;
  gradient?: DesignerGradient;
  pattern?: DesignerPattern;
}

/** A pattern source — a built-in procedural one, or an uploaded image. */
export interface DesignerPattern {
  /** Built-in generators; omitted when `src`/`fileId` supply an image. */
  preset?: 'stripes' | 'dots' | 'grid' | 'checker' | 'noise';
  src?: string;
  fileId?: string;
  scale?: number;
  angle?: number;
  offsetX?: number;
  offsetY?: number;
  color?: string;
  background?: string;
}

/** What a `fill` layer paints across its box. */
export interface DesignerFillStyle {
  type: 'solid' | 'gradient' | 'pattern';
  color?: string;
  gradient?: DesignerGradient;
  pattern?: DesignerPattern;
}

/**
 * An `adjustment` layer's operation. It transforms the pixels of everything
 * beneath it (within its group, or just the layer below when `clipped`).
 */
export interface DesignerAdjustment {
  type:
    | 'brightness-contrast' | 'levels' | 'curves' | 'exposure'
    | 'hue-saturation' | 'color-balance' | 'black-white' | 'photo-filter'
    | 'channel-mixer' | 'selective-color' | 'invert' | 'posterize'
    | 'threshold' | 'gradient-map' | 'vibrance' | 'clarity-dehaze';
  /** Op-specific scalars, e.g. `{ brightness: 10, contrast: -5 }`. */
  values?: Record<string, number>;
  /** Photo Filter's tint. */
  color?: string;
  /** Gradient Map's ramp. */
  gradient?: DesignerGradient;
  /** Curves control points per channel, 0–255 in and out. */
  curves?: Record<string, { x: number; y: number }[]>;
}

/** One entry in a layer's non-destructive filter stack. */
export interface DesignerSmartFilter {
  /** A `FILTER_DESCRIPTORS` id. */
  id: string;
  params?: Record<string, number | string | boolean>;
  /** Default true; false keeps the entry but skips it when re-baking. */
  enabled?: boolean;
}

export interface DesignerElement {
  id: string;
  type:
    | 'text' | 'image' | 'shape' | 'icon' | 'path' | 'raster'
    // Added in doc v4 for Photoshop-parity layers.
    | 'group' | 'fill' | 'adjustment'
    // Added in doc v6: an instance of a reusable `symbol` definition.
    | 'symbol';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  name?: string;
  /**
   * The cross-format **reflow move-unit**: elements sharing a `groupId` travel
   * together when a design is re-fitted to a different canvas.
   *
   * NOT deprecated, and NOT superseded by `parentId` — an earlier version of
   * this comment claimed both, and that a v4 migration converted it. No such
   * migration exists (`designer-doc.migrate.ts` never touches the field), and
   * `groupLayers` deliberately writes BOTH: a Photoshop folder should also
   * travel as one unit. They answer different questions. `parentId` is "which
   * folder is this in"; `groupId` is "what must never be separated" — a CTA's
   * plate and its label are one move-unit whether or not anyone grouped them.
   */
  groupId?: string;
  /** The `group` element this layer belongs to. Undefined = top level. */
  parentId?: string;
  /** How this layer composites onto what is beneath it. Default `normal`. */
  blendMode?: DesignerBlendMode;
  /** Clipped to the layer directly below, Photoshop-style. */
  clipped?: boolean;
  /** Non-destructive effects, rendered in list order. */
  styles?: DesignerLayerStyle[];
  /** Group-only: collapsed in the layers panel (editor state, harmless to store). */
  collapsed?: boolean;
  /** `fill` layers only. */
  fillStyle?: DesignerFillStyle;
  /** `adjustment` layers only. */
  adjustment?: DesignerAdjustment;
  /** `symbol` instances: which definition on the doc this is an instance of. */
  symbolId?: string;
  /**
   * Per-instance content overrides, keyed by the id of the element INSIDE the
   * symbol. Content only — structure is shared, which is the rule that keeps
   * symbols comprehensible.
   */
  symbolOverrides?: SymbolOverrides;
  /** Marks this element as a template placeholder. */
  slot?: SlotDefinition;
  flipX?: boolean;
  flipY?: boolean;

  // text
  text?: string;
  richText?: TextRun[];
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fill?: string;
  align?: 'left' | 'center' | 'right';
  /** Vertical alignment of the wrapped text block inside the element box. */
  verticalAlign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  letterSpacing?: number;
  textShadow?: DesignerTextShadow;
  textStroke?: DesignerTextStroke;
  curve?: number;
  textPath?: string;

  // image
  src?: string;
  fileId?: string;
  crop?: DesignerCrop;
  filters?: string[];
  borderRadius?: number;
  fitMode?: 'contain' | 'cover' | 'fill';
  focalPoint?: { x: number; y: number };
  /**
   * Subject centroid in SOURCE-image space (0..1) behind `focalPoint`. Unlike
   * `focalPoint` — which is the crop window's position and therefore only
   * valid for the box aspect it was computed against — this survives a reflow,
   * so `smartReflow` can re-derive the focal point for the new box.
   */
  subjectPoint?: { x: number; y: number };
  mask?: DesignerMask;
  /**
   * A painted greyscale LAYER MASK — black hides, white reveals, grey is
   * partial. Distinct from `mask` above, which is a preset shape/text
   * silhouette; a layer can carry both.
   *
   * Stored as an uploaded bitmap so all three renderers can composite it with
   * `destination-in`, exactly as they already do for the text/shape stencil.
   */
  maskSrc?: string;
  maskFileId?: string;
  /** Shift-click the mask thumbnail to disable it without discarding it. */
  maskEnabled?: boolean;
  /**
   * A non-destructive filter stack, applied in list order.
   *
   * The recipe is stored; the pixels are not. Whenever the stack changes the
   * client re-runs it from `originalSrc` and uploads the result to `src`, so
   * all three renderers keep drawing a plain bitmap and need no filter code of
   * their own — the reason 47 filters can be editable-forever for the price of
   * one implementation.
   */
  smartFilters?: DesignerSmartFilter[];
  /**
   * The pre-filter pixels the stack is evaluated from. Written once, when the
   * first smart filter is added, and never overwritten — re-baking from the
   * already-baked bitmap would compound the effect on every edit.
   */
  originalSrc?: string;
  originalFileId?: string;
  alt?: string;
  naturalWidth?: number;
  naturalHeight?: number;

  // shape
  /**
   * Pen-tool path, in element-local coordinates. Paths stay vectors because
   * both renderers trace them identically (see `path-geometry`); painted
   * pixels, which cannot be, become a `raster` element instead.
   */
  nodes?: DesignerPathNode[];
  /** Whether the path's last node joins back to its first. */
  closed?: boolean;

  shape?: 'rect' | 'ellipse' | 'line' | 'star' | 'triangle' | 'polygon';
  /** Side count for `polygon`, point count for `star`. Defaults: 6 and 5. */
  sides?: number;
  /** Star inner-radius as a fraction of the outer radius (0–1). Default 0.5. */
  innerRatio?: number;
  fillGradient?: DesignerGradient;
  stroke?: string;
  strokeWidth?: number;
  /** Dash, cap, join and arrowheads — see `designer-doc/stroke-style`. */
  strokeStyle?: StrokeStyle;

  // reflow / linked-by-default
  originId?: string;
  anchor?:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'center-left'
    | 'center'
    | 'center-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right';

  // drift-resolved: boxShadow present in frontend, absent server copy
  boxShadow?: DesignerTextShadow;
}

export interface StickerFrame {
  url: string;
  durationMs: number;
}

export interface CaptionWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface VideoClip {
  id: string;
  startMs: number;
  endMs: number;
  trimInMs?: number;
  trimOutMs?: number;
  src?: string;
  fileId?: string;
  /**
   * A non-destructive filter stack, exactly as on a layer (see `smartFilters`
   * on `DesignerElement`). Only meaningful for clips whose pixels do not change
   * over their own duration — image, shape, text and sticker clips — because a
   * bake is one bitmap. A moving video keeps the native `filters` tokens, which
   * both renderers apply per frame.
   */
  smartFilters?: DesignerSmartFilter[];
  originalSrc?: string;
  originalFileId?: string;
  /**
   * Shutter-based motion blur, derived from this clip's own keyframes. Applied
   * by the frame renderer at export — the live preview draws one sample, the
   * same trade every editor makes.
   */
  motionBlur?: MotionBlur;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  // drift-resolved: fontWeight present in frontend, absent server copy
  fontWeight?: number;
  fill?: string;
  volume?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  keyframes?: {
    tMs: number;
    props: Record<string, number>;
    /**
     * A preset name, or bezier handles for the graph editor. A segment uses the
     * OUTgoing handle of the keyframe it leaves and the INcoming handle of the
     * one it arrives at; see `designer-doc/keyframes`.
     */
    ease?: KeyframeEase;
  }[];
  naturalWidth?: number;
  naturalHeight?: number;
  transitionIn?: {
    type: 'cut' | 'fade' | 'dissolve' | 'slide';
    durationMs: number;
    direction?: 'left' | 'right' | 'up' | 'down';
  };
  transitionOut?: {
    type: 'cut' | 'fade' | 'dissolve' | 'slide';
    durationMs: number;
    direction?: 'left' | 'right' | 'up' | 'down';
  };
  speed?: number;
  reverse?: boolean;
  freezeAtMs?: number;
  filters?: string[];
  frames?: StickerFrame[];
  words?: CaptionWord[];
  /**
   * Caption look — karaoke, word-pop and the rest. Resolved into per-word draw
   * state by `designer-doc/caption-styles`, which both renderers call.
   */
  captionStyle?: CaptionStyle;
  /**
   * Beats detected in this AUDIO clip, in ms from its own start. Stored so the
   * analysis runs once rather than on every drag, and so a saved project keeps
   * its grid.
   */
  beats?: number[];
  /**
   * Shape clips (doc v5). A shape track's clips carry the same geometry the
   * shape ELEMENTS use, so both renderers trace them through the shared
   * `shape-geometry` helper rather than reimplementing the maths.
   */
  shape?: 'rect' | 'ellipse' | 'line' | 'star' | 'triangle' | 'polygon';
  sides?: number;
  innerRatio?: number;
  stroke?: string;
  strokeWidth?: number;
  borderRadius?: number;
  /**
   * Explicit source-pixel crop (doc v5), same meaning as an element's — it wins
   * over `fitMode`'s automatic cover crop. Lets the Crop tool work on a clip.
   */
  crop?: DesignerCrop;
  fitMode?: 'contain' | 'cover' | 'fill';
  focalPoint?: { x: number; y: number };
}

export interface VideoTrack {
  id: string;
  type: 'video' | 'image' | 'text' | 'audio' | 'sticker' | 'caption' | 'shape' | 'raster';
  clips: VideoClip[];
  gain?: number;
  autoDuck?: boolean;
}

export interface VideoOutput {
  id: string;
  formatId: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  tracks: VideoTrack[];
}

export interface DesignerOutput {
  id: string;
  formatId: string;
  name: string;
  width: number;
  height: number;
  background: string;
  bg?: DesignerBackground;
  children: DesignerElement[];
  /**
   * Vertical budget of this design's copy stack, as a multiple of the canvas
   * height — see `designer-doc/reflow`'s `typeBasisPx`. Stamped by the AI
   * Designer's composer (it is the only writer that knows the layout) and
   * carried onto every seeded format so a re-fit measures both canvases with
   * the rule the primary was actually composed under. Absent on manually
   * authored docs, which fall back to the plain geometric-mean basis.
   */
  typeBudget?: number;
}

export interface DesignerAttribution {
  source?: string;
  url?: string;
  downloadLocation?: string;
  author?: string;
  authorUrl?: string;
}

export interface DesignerDoc {
  version: number;
  mode: 'image' | 'video';
  outputs: (DesignerOutput | VideoOutput)[];
  attribution?: DesignerAttribution;
  /**
   * Reusable symbol definitions, stored once for the whole document. Instances
   * reference them by id; editing one updates every instance.
   */
  symbols?: SymbolDefinition[];
}

/** Public aliases preserved from the former design-render.types.ts surface. */
export type DesignerPage = DesignerOutput;
export type DesignerPageBackground = DesignerBackground;

// ---------------------------------------------------------------------------
// TextRun
// ---------------------------------------------------------------------------
const textRunCommon = {
  text: z.string().max(MAX_TEXT_LEN),
  fontFamily: z.string().max(200).optional(),
  fontStyle: z.enum(['normal', 'italic']).optional(),
  fill: ColorSchema.optional(),
  underline: z.boolean().optional(),
};
const { strict: StrictTextRunSchema, lenient: LenientTextRunSchema } =
  dualObject(
    {
      ...textRunCommon,
      fontSize: strictNum(1, MAX_FONT_SIZE).optional(),
      fontWeight: strictNum(1, 1000).optional(),
    },
    {
      ...textRunCommon,
      fontSize: lenientNum(1, MAX_FONT_SIZE, 16),
      fontWeight: lenientNum(1, 1000, 400),
    }
  );

// ---------------------------------------------------------------------------
// DesignerTextShadow
// ---------------------------------------------------------------------------
const { strict: StrictDesignerTextShadowSchema, lenient: LenientDesignerTextShadowSchema } =
  dualObject(
    {
      color: ColorSchema,
      blur: strictNum(0, MAX_DIMENSION),
      offsetX: strictNum(-MAX_DIMENSION, MAX_DIMENSION),
      offsetY: strictNum(-MAX_DIMENSION, MAX_DIMENSION),
    },
    {
      color: ColorSchema,
      blur: lenientNum(0, MAX_DIMENSION, 0),
      offsetX: lenientNum(-MAX_DIMENSION, MAX_DIMENSION, 0),
      offsetY: lenientNum(-MAX_DIMENSION, MAX_DIMENSION, 0),
    }
  );

// ---------------------------------------------------------------------------
// DesignerTextStroke
// ---------------------------------------------------------------------------
const { strict: StrictDesignerTextStrokeSchema, lenient: LenientDesignerTextStrokeSchema } =
  dualObject(
    {
      color: ColorSchema,
      width: strictNum(0, MAX_DIMENSION),
    },
    {
      color: ColorSchema,
      width: lenientNum(0, MAX_DIMENSION, 0),
    }
  );

// ---------------------------------------------------------------------------
// DesignerCrop
// ---------------------------------------------------------------------------
const { strict: StrictDesignerCropSchema, lenient: LenientDesignerCropSchema } =
  dualObject(
    {
      x: strictNum(-MAX_DIMENSION, MAX_DIMENSION),
      y: strictNum(-MAX_DIMENSION, MAX_DIMENSION),
      width: strictNum(0, MAX_DIMENSION),
      height: strictNum(0, MAX_DIMENSION),
    },
    {
      x: lenientNum(-MAX_DIMENSION, MAX_DIMENSION, 0),
      y: lenientNum(-MAX_DIMENSION, MAX_DIMENSION, 0),
      width: lenientNum(0, MAX_DIMENSION, 0),
      height: lenientNum(0, MAX_DIMENSION, 0),
    }
  );

// ---------------------------------------------------------------------------
// DesignerMask
// ---------------------------------------------------------------------------
const maskCommon = {
  type: z.enum(['shape', 'text']),
  shape: z
    .enum(['ellipse', 'rounded-rect', 'triangle', 'star', 'hexagon', 'heart'])
    .optional(),
  text: z.string().max(MAX_TEXT_LEN).optional(),
  fontFamily: z.string().max(200).optional(),
};
const { strict: StrictDesignerMaskSchema, lenient: LenientDesignerMaskSchema } =
  dualObject(
    {
      ...maskCommon,
      cornerRadius: strictNum(0, MAX_DIMENSION).optional(),
      fontWeight: strictNum(1, 1000).optional(),
    },
    {
      ...maskCommon,
      cornerRadius: lenientNum(0, MAX_DIMENSION, 0),
      fontWeight: lenientNum(1, 1000, 400),
    }
  );

// ---------------------------------------------------------------------------
// DesignerGradientStop
// ---------------------------------------------------------------------------
const { strict: StrictDesignerGradientStopSchema, lenient: LenientDesignerGradientStopSchema } =
  dualObject(
    {
      offset: strictNum(0, 1),
      color: ColorSchema,
    },
    {
      offset: lenientNum(0, 1, 0),
      color: ColorSchema,
    }
  );

// ---------------------------------------------------------------------------
// DesignerGradient
// ---------------------------------------------------------------------------
const gradientCommon = {
  type: z.enum(['linear', 'radial']),
};
const { strict: StrictDesignerGradientSchema, lenient: LenientDesignerGradientSchema } =
  dualObject(
    {
      ...gradientCommon,
      angle: strictNum(-360, 360).optional(),
      stops: z.array(StrictDesignerGradientStopSchema).max(64),
    },
    {
      ...gradientCommon,
      angle: lenientNum(-360, 360, 0),
      stops: z.array(LenientDesignerGradientStopSchema).max(64),
    }
  );

// ---------------------------------------------------------------------------
// FocalPoint
// ---------------------------------------------------------------------------
const { strict: StrictFocalPointSchema, lenient: LenientFocalPointSchema } =
  dualObject(
    {
      x: strictNum(0, 1),
      y: strictNum(0, 1),
    },
    {
      x: lenientNum(0, 1, 0.5),
      y: lenientNum(0, 1, 0.5),
    }
  );

// ---------------------------------------------------------------------------
// DesignerBackground / DesignerPageBackground
// ---------------------------------------------------------------------------
const backgroundCommon = {
  type: z.enum(['color', 'gradient', 'image']),
  color: ColorSchema.optional(),
  src: SrcSchema.optional(),
  fileId: z.string().max(200).optional(),
};
const { strict: StrictDesignerBackgroundSchema, lenient: LenientDesignerBackgroundSchema } =
  dualObject(
    {
      ...backgroundCommon,
      gradient: StrictDesignerGradientSchema.optional(),
      // Cover-crop anchor for image backgrounds (renderer honors it, same as
      // image-element focalPoint), plus the centroid/intrinsic size a reflow
      // re-derives it from.
      focalPoint: StrictFocalPointSchema.optional(),
      subjectPoint: StrictFocalPointSchema.optional(),
      naturalWidth: strictNum(0, MAX_DIMENSION).optional(),
      naturalHeight: strictNum(0, MAX_DIMENSION).optional(),
    },
    {
      ...backgroundCommon,
      gradient: LenientDesignerGradientSchema.optional(),
      focalPoint: LenientFocalPointSchema.optional(),
      subjectPoint: LenientFocalPointSchema.optional(),
      naturalWidth: lenientNum(0, MAX_DIMENSION, 0).optional(),
      naturalHeight: lenientNum(0, MAX_DIMENSION, 0).optional(),
    }
  );

// ---------------------------------------------------------------------------
// Layer compositing (doc v4)
// ---------------------------------------------------------------------------

export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
  'dissolve', 'linear-burn', 'linear-dodge', 'vivid-light', 'linear-light',
  'pin-light', 'hard-mix', 'subtract', 'divide',
  'darker-color', 'lighter-color',
] as const;

const BlendModeSchema = z.enum(BLEND_MODES);

const PatternSchema = z.object({
  preset: z.enum(['stripes', 'dots', 'grid', 'checker', 'noise']).optional(),
  src: SrcSchema.optional(),
  fileId: z.string().max(200).optional(),
  scale: z.number().min(0.01).max(100).optional(),
  angle: z.number().optional(),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
  color: ColorSchema.optional(),
  background: ColorSchema.optional(),
});

const layerStyleShape = (gradient: z.ZodTypeAny) =>
  z.object({
    type: z.enum([
      'drop-shadow', 'inner-shadow', 'outer-glow', 'inner-glow',
      'stroke', 'bevel-emboss', 'satin',
      'color-overlay', 'gradient-overlay', 'pattern-overlay',
    ]),
    enabled: z.boolean().optional(),
    color: ColorSchema.optional(),
    opacity: z.number().min(0).max(1).optional(),
    blendMode: BlendModeSchema.optional(),
    angle: z.number().optional(),
    useGlobalLight: z.boolean().optional(),
    distance: z.number().min(0).max(MAX_DIMENSION).optional(),
    spread: z.number().min(0).max(100).optional(),
    size: z.number().min(0).max(MAX_DIMENSION).optional(),
    position: z.enum(['outside', 'inside', 'center']).optional(),
    style: z.enum(['outer-bevel', 'inner-bevel', 'emboss', 'pillow-emboss']).optional(),
    depth: z.number().min(0).max(1000).optional(),
    soften: z.number().min(0).max(100).optional(),
    highlightColor: ColorSchema.optional(),
    shadowColor: ColorSchema.optional(),
    gradient: gradient.optional(),
    pattern: PatternSchema.optional(),
  });

const fillStyleShape = (gradient: z.ZodTypeAny) =>
  z.object({
    type: z.enum(['solid', 'gradient', 'pattern']),
    color: ColorSchema.optional(),
    gradient: gradient.optional(),
    pattern: PatternSchema.optional(),
  });

const adjustmentShape = (gradient: z.ZodTypeAny) =>
  z.object({
    type: z.enum([
      'brightness-contrast', 'levels', 'curves', 'exposure',
      'hue-saturation', 'color-balance', 'black-white', 'photo-filter',
      'channel-mixer', 'selective-color', 'invert', 'posterize',
      'threshold', 'gradient-map', 'vibrance', 'clarity-dehaze',
    ]),
    values: z.record(z.string().max(40), z.number()).optional(),
    /** Photo Filter's tint. `applyAdjustment` has always read it. */
    color: ColorSchema.optional(),
    gradient: gradient.optional(),
    curves: z
      .record(
        z.string().max(20),
        z.array(z.object({ x: z.number(), y: z.number() })).max(32)
      )
      .optional(),
  });

// ---------------------------------------------------------------------------
// DesignerElement
// ---------------------------------------------------------------------------
const elementCommon = {
  id: z.string().max(200),
  // `path` (Pen tools) and `raster` (paint tools) were added in doc v3. Both are
  // additive: v2 documents keep validating unchanged.
  // `group`/`fill`/`adjustment` were added in doc v4 for Photoshop-parity
  // layers. Additive: v2/v3 documents keep validating unchanged.
  type: z.enum([
    'text', 'image', 'shape', 'icon', 'path', 'raster',
    'group', 'fill', 'adjustment',
    // doc v6 — additive, so v5 documents keep validating unchanged.
    'symbol',
  ]),
  name: z.string().max(200).optional(),
  // NOT deprecated: the cross-format reflow move-unit, deliberately separate
  // from `parentId` (the Photoshop layer folder). See the field's doc comment
  // on `DesignerElement` — no migration converts one into the other.
  groupId: z.string().max(200).optional(),
  parentId: z.string().max(200).optional(),
  symbolId: z.string().max(200).optional(),
  blendMode: BlendModeSchema.optional(),
  clipped: z.boolean().optional(),
  collapsed: z.boolean().optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),

  // text
  text: z.string().max(MAX_TEXT_LEN).optional(),
  fontFamily: z.string().max(200).optional(),
  fontStyle: z.enum(['normal', 'italic']).optional(),
  fill: ColorSchema.optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  textPath: z.string().max(MAX_TEXT_LEN).optional(),

  // image
  src: SrcSchema.optional(),
  fileId: z.string().max(200).optional(),
  fitMode: z.enum(['contain', 'cover', 'fill']).optional(),
  alt: z.string().max(500).optional(),

  // Painted layer mask (bitmap stencil) — see `maskSrc` on DesignerElement.
  maskSrc: SrcSchema.optional(),
  maskFileId: z.string().max(200).optional(),
  maskEnabled: z.boolean().optional(),

  // Non-destructive filter stack — see `smartFilters` on DesignerElement.
  smartFilters: SmartFilterStackSchema,
  originalSrc: SrcSchema.optional(),
  originalFileId: z.string().max(200).optional(),

  // shape
  shape: z
    .enum(['rect', 'ellipse', 'line', 'star', 'triangle', 'polygon'])
    .optional(),
  sides: z.number().int().min(3).max(64).optional(),

  // path (Pen tools) — bezier nodes in element-local coordinates
  nodes: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        inX: z.number().optional(),
        inY: z.number().optional(),
        outX: z.number().optional(),
        outY: z.number().optional(),
      })
    )
    .max(MAX_PATH_NODES)
    .optional(),
  closed: z.boolean().optional(),
  innerRatio: z.number().min(0.05).max(0.95).optional(),
  stroke: ColorSchema.optional(),

  // reflow / linked-by-default
  originId: z.string().max(200).optional(),
  anchor: z
    .enum([
      'top-left',
      'top-center',
      'top-right',
      'center-left',
      'center',
      'center-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ])
    .optional(),
};

const elementStrictNumeric = {
  x: strictNum(-MAX_DIMENSION, MAX_DIMENSION),
  y: strictNum(-MAX_DIMENSION, MAX_DIMENSION),
  width: strictNum(0, MAX_DIMENSION),
  height: strictNum(0, MAX_DIMENSION),
  rotation: strictNum(-360000, 360000),
  opacity: strictNum(0, 1),
  locked: z.boolean(),
  hidden: z.boolean(),
};

const elementStrictOptionalNumeric = {
  fontSize: strictNum(1, MAX_FONT_SIZE).optional(),
  fontWeight: strictNum(1, 1000).optional(),
  lineHeight: strictNum(0, 100).optional(),
  letterSpacing: strictNum(-MAX_DIMENSION, MAX_DIMENSION).optional(),
  curve: strictNum(-1000, 1000).optional(),
  borderRadius: strictNum(0, MAX_DIMENSION).optional(),
  strokeWidth: strictNum(0, MAX_DIMENSION).optional(),
  naturalWidth: strictNum(0, MAX_DIMENSION).optional(),
  naturalHeight: strictNum(0, MAX_DIMENSION).optional(),
};

const elementLenientNumeric = {
  x: lenientNum(-MAX_DIMENSION, MAX_DIMENSION, 0),
  y: lenientNum(-MAX_DIMENSION, MAX_DIMENSION, 0),
  width: lenientNum(0, MAX_DIMENSION, 0),
  height: lenientNum(0, MAX_DIMENSION, 0),
  rotation: lenientNum(-360000, 360000, 0),
  opacity: lenientNum(0, 1, 1),
  locked: z.boolean().catch(false),
  hidden: z.boolean().catch(false),
  fontSize: lenientNum(1, MAX_FONT_SIZE, 16),
  fontWeight: lenientNum(1, 1000, 400),
  lineHeight: lenientNum(0, 100, 1.2),
  letterSpacing: lenientNum(-MAX_DIMENSION, MAX_DIMENSION, 0),
  curve: lenientNum(-1000, 1000, 0),
  borderRadius: lenientNum(0, MAX_DIMENSION, 0),
  strokeWidth: lenientNum(0, MAX_DIMENSION, 0),
  naturalWidth: lenientNum(0, MAX_DIMENSION, 0),
  naturalHeight: lenientNum(0, MAX_DIMENSION, 0),
};

const elementStrictNested = {
  richText: z.array(StrictTextRunSchema).max(1000).optional(),
  textShadow: StrictDesignerTextShadowSchema.optional(),
  textStroke: StrictDesignerTextStrokeSchema.optional(),
  crop: StrictDesignerCropSchema.optional(),
  focalPoint: StrictFocalPointSchema.optional(),
  subjectPoint: StrictFocalPointSchema.optional(),
  mask: StrictDesignerMaskSchema.optional(),
  fillGradient: StrictDesignerGradientSchema.optional(),
  // drift-resolved: boxShadow present in frontend, absent server copy
  boxShadow: StrictDesignerTextShadowSchema.optional(),
  styles: z.array(layerStyleShape(StrictDesignerGradientSchema)).max(MAX_LAYER_STYLES).optional(),
  fillStyle: fillStyleShape(StrictDesignerGradientSchema).optional(),
  adjustment: adjustmentShape(StrictDesignerGradientSchema).optional(),
  strokeStyle: StrokeStyleSchema,
  symbolOverrides: SymbolOverridesSchema,
  slot: SlotSchema,
  filters: FiltersSchema,
};

const elementLenientNested = {
  richText: z.array(LenientTextRunSchema).max(1000).optional(),
  textShadow: LenientDesignerTextShadowSchema.optional(),
  textStroke: LenientDesignerTextStrokeSchema.optional(),
  crop: LenientDesignerCropSchema.optional(),
  focalPoint: LenientFocalPointSchema.optional(),
  subjectPoint: LenientFocalPointSchema.optional(),
  mask: LenientDesignerMaskSchema.optional(),
  fillGradient: LenientDesignerGradientSchema.optional(),
  boxShadow: LenientDesignerTextShadowSchema.optional(),
  styles: z.array(layerStyleShape(LenientDesignerGradientSchema)).max(MAX_LAYER_STYLES).optional(),
  fillStyle: fillStyleShape(LenientDesignerGradientSchema).optional(),
  adjustment: adjustmentShape(LenientDesignerGradientSchema).optional(),
  strokeStyle: StrokeStyleSchema,
  symbolOverrides: SymbolOverridesSchema,
  slot: SlotSchema,
  filters: FiltersSchema,
};

const { strict: StrictDesignerElementSchema, lenient: LenientDesignerElementSchema } =
  dualObject(
    {
      ...elementCommon,
      ...elementStrictNumeric,
      ...elementStrictOptionalNumeric,
      ...elementStrictNested,
    },
    {
      ...elementCommon,
      ...elementLenientNumeric,
      ...elementLenientNested,
    }
  );

// ---------------------------------------------------------------------------
// StickerFrame
// ---------------------------------------------------------------------------
const { strict: StrictStickerFrameSchema, lenient: LenientStickerFrameSchema } =
  dualObject(
    {
      url: SrcSchema,
      durationMs: strictNum(0, MAX_VIDEO_DURATION_MS),
    },
    {
      url: SrcSchema,
      durationMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
    }
  );

// ---------------------------------------------------------------------------
// CaptionWord
// ---------------------------------------------------------------------------
const { strict: StrictCaptionWordSchema, lenient: LenientCaptionWordSchema } =
  dualObject(
    {
      word: z.string().max(200),
      startMs: strictNum(0, MAX_VIDEO_DURATION_MS),
      endMs: strictNum(0, MAX_VIDEO_DURATION_MS),
    },
    {
      word: z.string().max(200),
      startMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
      endMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
    }
  );

// ---------------------------------------------------------------------------
// Transition
// ---------------------------------------------------------------------------
const transitionCommon = {
  type: z.enum(['cut', 'fade', 'dissolve', 'slide']),
  direction: z.enum(['left', 'right', 'up', 'down']).optional(),
};
const { strict: StrictTransitionSchema, lenient: LenientTransitionSchema } =
  dualObject(
    {
      ...transitionCommon,
      durationMs: strictNum(0, MAX_VIDEO_DURATION_MS),
    },
    {
      ...transitionCommon,
      durationMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
    }
  );

// ---------------------------------------------------------------------------
// Keyframe
// ---------------------------------------------------------------------------
const easeHandle = z.tuple([z.number().finite(), z.number().finite()]);
const EaseSchema = z.union([
  z.enum(['linear', 'easeInOut', 'easeIn', 'easeOut']),
  z.object({ in: easeHandle.optional(), out: easeHandle.optional() }).strict(),
]);

const { strict: StrictKeyframeSchema, lenient: LenientKeyframeSchema } =
  dualObject(
    {
      tMs: strictNum(0, MAX_VIDEO_DURATION_MS),
      props: z.record(z.number().finite()),
      ease: EaseSchema.optional(),
    },
    {
      tMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
      props: z.record(z.number().finite()),
      ease: EaseSchema.optional(),
    }
  );

// ---------------------------------------------------------------------------
// VideoClip
// ---------------------------------------------------------------------------
const clipCommon = {
  id: z.string().max(200),
  src: SrcSchema.optional(),
  fileId: z.string().max(200).optional(),
  smartFilters: SmartFilterStackSchema,
  originalSrc: SrcSchema.optional(),
  originalFileId: z.string().max(200).optional(),
  motionBlur: z
    .object({
      enabled: z.boolean().optional(),
      shutterAngle: z.number().finite().min(0).max(360).optional(),
      samples: z.number().finite().min(1).max(MAX_MOTION_BLUR_SAMPLES).optional(),
    })
    .optional(),
  text: z.string().max(MAX_TEXT_LEN).optional(),
  fontFamily: z.string().max(200).optional(),
  fill: ColorSchema.optional(),
  reverse: z.boolean().optional(),
  // The frame renderer already honours these on clips; they were only ever
  // missing from the contract.
  fitMode: z.enum(['contain', 'cover', 'fill']).optional(),
  // Shape clips (doc v5) — additive, so v4 documents keep validating.
  shape: z
    .enum(['rect', 'ellipse', 'line', 'star', 'triangle', 'polygon'])
    .optional(),
  stroke: ColorSchema.optional(),
};



const clipStrictNumeric = {
  startMs: strictNum(0, MAX_VIDEO_DURATION_MS),
  endMs: strictNum(0, MAX_VIDEO_DURATION_MS),
};

const clipStrictOptionalNumeric = {
  trimInMs: strictNum(0, MAX_VIDEO_DURATION_MS).optional(),
  trimOutMs: strictNum(0, MAX_VIDEO_DURATION_MS).optional(),
  x: strictNum(-MAX_DIMENSION, MAX_DIMENSION).optional(),
  y: strictNum(-MAX_DIMENSION, MAX_DIMENSION).optional(),
  width: strictNum(0, MAX_DIMENSION).optional(),
  height: strictNum(0, MAX_DIMENSION).optional(),
  rotation: strictNum(-360000, 360000).optional(),
  opacity: strictNum(0, 1).optional(),
  fontSize: strictNum(1, MAX_FONT_SIZE).optional(),
  // drift-resolved: fontWeight present in frontend, absent server copy
  fontWeight: strictNum(1, 1000).optional(),
  sides: strictNum(3, 64).optional(),
  innerRatio: strictNum(0.05, 0.95).optional(),
  strokeWidth: strictNum(0, MAX_DIMENSION).optional(),
  borderRadius: strictNum(0, MAX_DIMENSION).optional(),
  volume: strictNum(0, 1).optional(),
  fadeInMs: strictNum(0, MAX_VIDEO_DURATION_MS).optional(),
  fadeOutMs: strictNum(0, MAX_VIDEO_DURATION_MS).optional(),
  naturalWidth: strictNum(0, MAX_DIMENSION).optional(),
  naturalHeight: strictNum(0, MAX_DIMENSION).optional(),
  speed: strictNum(0.1, 10).optional(),
  freezeAtMs: strictNum(0, MAX_VIDEO_DURATION_MS).optional(),
};

const clipLenientNumeric = {
  startMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
  endMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
  trimInMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
  trimOutMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
  x: lenientNum(-MAX_DIMENSION, MAX_DIMENSION, 0),
  y: lenientNum(-MAX_DIMENSION, MAX_DIMENSION, 0),
  width: lenientNum(0, MAX_DIMENSION, 0),
  height: lenientNum(0, MAX_DIMENSION, 0),
  rotation: lenientNum(-360000, 360000, 0),
  opacity: lenientNum(0, 1, 1),
  fontSize: lenientNum(1, MAX_FONT_SIZE, 16),
  fontWeight: lenientNum(1, 1000, 400),
  sides: lenientNum(3, 64, 6),
  innerRatio: lenientNum(0.05, 0.95, 0.5),
  strokeWidth: lenientNum(0, MAX_DIMENSION, 0),
  borderRadius: lenientNum(0, MAX_DIMENSION, 0),
  volume: lenientNum(0, 1, 1),
  fadeInMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
  fadeOutMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
  naturalWidth: lenientNum(0, MAX_DIMENSION, 0),
  naturalHeight: lenientNum(0, MAX_DIMENSION, 0),
  speed: lenientNum(0.1, 10, 1),
  freezeAtMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
};

const clipStrictNested = {
  crop: StrictDesignerCropSchema.optional(),
  focalPoint: StrictFocalPointSchema.optional(),
  keyframes: z.array(StrictKeyframeSchema).max(1000).optional(),
  transitionIn: StrictTransitionSchema.optional(),
  transitionOut: StrictTransitionSchema.optional(),
  filters: FiltersSchema,
  frames: z.array(StrictStickerFrameSchema).max(1000).optional(),
  words: z.array(StrictCaptionWordSchema).max(10000).optional(),
  captionStyle: CaptionStyleSchema,
  beats: BeatsSchema,
};

const clipLenientNested = {
  crop: LenientDesignerCropSchema.optional(),
  focalPoint: LenientFocalPointSchema.optional(),
  keyframes: z.array(LenientKeyframeSchema).max(1000).optional(),
  transitionIn: LenientTransitionSchema.optional(),
  transitionOut: LenientTransitionSchema.optional(),
  filters: FiltersSchema,
  frames: z.array(LenientStickerFrameSchema).max(1000).optional(),
  words: z.array(LenientCaptionWordSchema).max(10000).optional(),
  captionStyle: CaptionStyleSchema,
  beats: BeatsSchema,
};

const { strict: StrictVideoClipSchema, lenient: LenientVideoClipSchema } =
  dualObject(
    {
      ...clipCommon,
      ...clipStrictNumeric,
      ...clipStrictOptionalNumeric,
      ...clipStrictNested,
    },
    {
      ...clipCommon,
      ...clipLenientNumeric,
      ...clipLenientNested,
    }
  );

// ---------------------------------------------------------------------------
// VideoTrack
// ---------------------------------------------------------------------------
const trackCommon = {
  id: z.string().max(200),
  type: z.enum(['video', 'image', 'text', 'audio', 'sticker', 'caption', 'shape', 'raster']),
  autoDuck: z.boolean().optional(),
};
const { strict: StrictVideoTrackSchema, lenient: LenientVideoTrackSchema } =
  dualObject(
    {
      ...trackCommon,
      clips: z.array(StrictVideoClipSchema).max(MAX_CLIPS_PER_TRACK),
      gain: strictNum(0, 2).optional(),
    },
    {
      ...trackCommon,
      clips: z.array(LenientVideoClipSchema).max(MAX_CLIPS_PER_TRACK),
      gain: lenientNum(0, 2, 1),
    }
  );

// ---------------------------------------------------------------------------
// VideoOutput
// ---------------------------------------------------------------------------
const videoOutputCommon = {
  id: z.string().max(200),
  formatId: z.string().max(64),
  name: z.string().max(200),
};
const { strict: StrictVideoOutputSchema, lenient: LenientVideoOutputSchema } =
  dualObject(
    {
      ...videoOutputCommon,
      width: strictNum(1, MAX_DIMENSION),
      height: strictNum(1, MAX_DIMENSION),
      fps: strictNum(1, 240),
      durationMs: strictNum(0, MAX_VIDEO_DURATION_MS),
      tracks: z.array(StrictVideoTrackSchema).max(MAX_TRACKS),
    },
    {
      ...videoOutputCommon,
      width: lenientNum(1, MAX_DIMENSION, 1080),
      height: lenientNum(1, MAX_DIMENSION, 1080),
      fps: lenientNum(1, 240, 30),
      durationMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 10000),
      tracks: z.array(LenientVideoTrackSchema).max(MAX_TRACKS),
    }
  );

// ---------------------------------------------------------------------------
// DesignerOutput
// ---------------------------------------------------------------------------
const designerOutputCommon = {
  id: z.string().max(200),
  formatId: z.string().max(64),
  name: z.string().max(200),
  background: ColorSchema,
};
const { strict: StrictDesignerOutputSchema, lenient: LenientDesignerOutputSchema } =
  dualObject(
    {
      ...designerOutputCommon,
      width: strictNum(1, MAX_DIMENSION),
      height: strictNum(1, MAX_DIMENSION),
      bg: StrictDesignerBackgroundSchema.optional(),
      typeBudget: strictNum(0, 100).optional(),
      children: z.array(StrictDesignerElementSchema).max(MAX_ELEMENTS_PER_OUTPUT),
    },
    {
      ...designerOutputCommon,
      width: lenientNum(1, MAX_DIMENSION, 1080),
      height: lenientNum(1, MAX_DIMENSION, 1080),
      bg: LenientDesignerBackgroundSchema.optional(),
      typeBudget: lenientNum(0, 100, 0).optional(),
      children: z.array(LenientDesignerElementSchema).max(MAX_ELEMENTS_PER_OUTPUT),
    }
  );

// ---------------------------------------------------------------------------
// DesignerAttribution
// ---------------------------------------------------------------------------
const attributionCommon = {
  source: z.string().max(200).optional(),
  url: z.string().max(2048).optional(),
  downloadLocation: z.string().max(2048).optional(),
  author: z.string().max(200).optional(),
  authorUrl: z.string().max(2048).optional(),
};
const { strict: StrictDesignerAttributionSchema, lenient: LenientDesignerAttributionSchema } =
  dualObject(attributionCommon, attributionCommon);

// ---------------------------------------------------------------------------
// Doc
// ---------------------------------------------------------------------------
const docCommon = {
  version: z.number().int().min(1).max(DESIGNER_DOC_VERSION),
  mode: z.literal('image'),
};
const { strict: ImageDocStrictSchema, lenient: ImageDocLenientSchema } = dualObject(
  {
    ...docCommon,
    outputs: z.array(StrictDesignerOutputSchema).min(1).max(MAX_OUTPUTS),
    attribution: StrictDesignerAttributionSchema.optional(),
    symbols: z.array(symbolDefinitionShape(StrictDesignerElementSchema)).max(200).optional(),
  },
  {
    ...docCommon,
    outputs: z.array(LenientDesignerOutputSchema).min(1).max(MAX_OUTPUTS),
    attribution: LenientDesignerAttributionSchema.optional(),
    symbols: z.array(symbolDefinitionShape(LenientDesignerElementSchema)).max(200).optional(),
  }
);

const videoDocCommon = {
  version: z.number().int().min(1).max(DESIGNER_DOC_VERSION),
  mode: z.literal('video'),
};
const { strict: VideoDocStrictSchema, lenient: VideoDocLenientSchema } = dualObject(
  {
    ...videoDocCommon,
    outputs: z.array(StrictVideoOutputSchema).min(1).max(MAX_OUTPUTS),
    attribution: StrictDesignerAttributionSchema.optional(),
    symbols: z.array(symbolDefinitionShape(StrictDesignerElementSchema)).max(200).optional(),
  },
  {
    ...videoDocCommon,
    outputs: z.array(LenientVideoOutputSchema).min(1).max(MAX_OUTPUTS),
    attribution: LenientDesignerAttributionSchema.optional(),
    symbols: z.array(symbolDefinitionShape(LenientDesignerElementSchema)).max(200).optional(),
  }
);

export { StrictTextRunSchema, LenientTextRunSchema };
export { StrictDesignerTextShadowSchema, LenientDesignerTextShadowSchema };
export { StrictDesignerTextStrokeSchema, LenientDesignerTextStrokeSchema };
export { StrictDesignerCropSchema, LenientDesignerCropSchema };
export { StrictDesignerMaskSchema, LenientDesignerMaskSchema };
export { StrictDesignerGradientStopSchema, LenientDesignerGradientStopSchema };
export { StrictDesignerGradientSchema, LenientDesignerGradientSchema };
export { StrictDesignerBackgroundSchema, LenientDesignerBackgroundSchema };
export { StrictDesignerElementSchema, LenientDesignerElementSchema };
export { StrictStickerFrameSchema, LenientStickerFrameSchema };
export { StrictCaptionWordSchema, LenientCaptionWordSchema };
export { StrictTransitionSchema, LenientTransitionSchema };
export { StrictKeyframeSchema, LenientKeyframeSchema };
export { StrictVideoClipSchema, LenientVideoClipSchema };
export { StrictVideoTrackSchema, LenientVideoTrackSchema };
export { StrictVideoOutputSchema, LenientVideoOutputSchema };
export { StrictDesignerOutputSchema, LenientDesignerOutputSchema };
export { StrictDesignerAttributionSchema, LenientDesignerAttributionSchema };
export { ImageDocStrictSchema, ImageDocLenientSchema };
export { VideoDocStrictSchema, VideoDocLenientSchema };

/**
 * Explicitly annotated because the inferred union type is now large enough that
 * TypeScript refuses to serialize it into the emitted `.d.ts` (TS7056) — the
 * v4 layer fields pushed it over. `z.ZodType<DesignerDoc, …>` is also a better
 * public contract than the inferred shape: as the note at the top of this file
 * explains, `z.infer` marks every field optional under this repo's
 * `strictNullChecks: false`, so callers were already relying on the explicit
 * interfaces rather than the inferred ones.
 *
 * The runtime schemas are unchanged; only their declared type is pinned.
 */
export const DesignerDocStrictSchema: z.ZodType<DesignerDoc, z.ZodTypeDef, unknown> =
  z.discriminatedUnion('mode', [
    ImageDocStrictSchema,
    VideoDocStrictSchema,
  ]) as unknown as z.ZodType<DesignerDoc, z.ZodTypeDef, unknown>;

export const DesignerDocLenientSchema: z.ZodType<DesignerDoc, z.ZodTypeDef, unknown> =
  z.discriminatedUnion('mode', [
    ImageDocLenientSchema,
    VideoDocLenientSchema,
  ]) as unknown as z.ZodType<DesignerDoc, z.ZodTypeDef, unknown>;

