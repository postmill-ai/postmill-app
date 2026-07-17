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
import {
  MAX_CLIPS_PER_TRACK,
  MAX_DIMENSION,
  MAX_ELEMENTS_PER_OUTPUT,
  MAX_FILTERS_PER_ELEMENT,
  MAX_FONT_SIZE,
  MAX_OPS_PER_REQUEST,
  MAX_OUTPUTS,
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
}

export interface DesignerElement {
  id: string;
  type: 'text' | 'image' | 'shape' | 'icon';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  name?: string;
  groupId?: string;
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
  mask?: DesignerMask;
  alt?: string;
  naturalWidth?: number;
  naturalHeight?: number;

  // shape
  shape?: 'rect' | 'ellipse' | 'line' | 'star';
  fillGradient?: DesignerGradient;
  stroke?: string;
  strokeWidth?: number;

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
    ease?: 'linear' | 'easeInOut' | 'easeIn' | 'easeOut';
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
}

export interface VideoTrack {
  id: string;
  type: 'video' | 'image' | 'text' | 'audio' | 'sticker' | 'caption';
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
    },
    {
      ...backgroundCommon,
      gradient: LenientDesignerGradientSchema.optional(),
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
// DesignerElement
// ---------------------------------------------------------------------------
const elementCommon = {
  id: z.string().max(200),
  type: z.enum(['text', 'image', 'shape', 'icon']),
  name: z.string().max(200).optional(),
  groupId: z.string().max(200).optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),

  // text
  text: z.string().max(MAX_TEXT_LEN).optional(),
  fontFamily: z.string().max(200).optional(),
  fontStyle: z.enum(['normal', 'italic']).optional(),
  fill: ColorSchema.optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  textPath: z.string().max(MAX_TEXT_LEN).optional(),

  // image
  src: SrcSchema.optional(),
  fileId: z.string().max(200).optional(),
  fitMode: z.enum(['contain', 'cover', 'fill']).optional(),
  alt: z.string().max(500).optional(),

  // shape
  shape: z.enum(['rect', 'ellipse', 'line', 'star']).optional(),
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
  mask: StrictDesignerMaskSchema.optional(),
  fillGradient: StrictDesignerGradientSchema.optional(),
  // drift-resolved: boxShadow present in frontend, absent server copy
  boxShadow: StrictDesignerTextShadowSchema.optional(),
  filters: FiltersSchema,
};

const elementLenientNested = {
  richText: z.array(LenientTextRunSchema).max(1000).optional(),
  textShadow: LenientDesignerTextShadowSchema.optional(),
  textStroke: LenientDesignerTextStrokeSchema.optional(),
  crop: LenientDesignerCropSchema.optional(),
  focalPoint: LenientFocalPointSchema.optional(),
  mask: LenientDesignerMaskSchema.optional(),
  fillGradient: LenientDesignerGradientSchema.optional(),
  boxShadow: LenientDesignerTextShadowSchema.optional(),
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
const { strict: StrictKeyframeSchema, lenient: LenientKeyframeSchema } =
  dualObject(
    {
      tMs: strictNum(0, MAX_VIDEO_DURATION_MS),
      props: z.record(z.number().finite()),
      ease: z.enum(['linear', 'easeInOut', 'easeIn', 'easeOut']).optional(),
    },
    {
      tMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
      props: z.record(z.number().finite()),
      ease: z.enum(['linear', 'easeInOut', 'easeIn', 'easeOut']).optional(),
    }
  );

// ---------------------------------------------------------------------------
// VideoClip
// ---------------------------------------------------------------------------
const clipCommon = {
  id: z.string().max(200),
  src: SrcSchema.optional(),
  fileId: z.string().max(200).optional(),
  text: z.string().max(MAX_TEXT_LEN).optional(),
  fontFamily: z.string().max(200).optional(),
  fill: ColorSchema.optional(),
  reverse: z.boolean().optional(),
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
  volume: lenientNum(0, 1, 1),
  fadeInMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
  fadeOutMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
  naturalWidth: lenientNum(0, MAX_DIMENSION, 0),
  naturalHeight: lenientNum(0, MAX_DIMENSION, 0),
  speed: lenientNum(0.1, 10, 1),
  freezeAtMs: lenientNum(0, MAX_VIDEO_DURATION_MS, 0),
};

const clipStrictNested = {
  keyframes: z.array(StrictKeyframeSchema).max(1000).optional(),
  transitionIn: StrictTransitionSchema.optional(),
  transitionOut: StrictTransitionSchema.optional(),
  filters: FiltersSchema,
  frames: z.array(StrictStickerFrameSchema).max(1000).optional(),
  words: z.array(StrictCaptionWordSchema).max(10000).optional(),
};

const clipLenientNested = {
  keyframes: z.array(LenientKeyframeSchema).max(1000).optional(),
  transitionIn: LenientTransitionSchema.optional(),
  transitionOut: LenientTransitionSchema.optional(),
  filters: FiltersSchema,
  frames: z.array(LenientStickerFrameSchema).max(1000).optional(),
  words: z.array(LenientCaptionWordSchema).max(10000).optional(),
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
  type: z.enum(['video', 'image', 'text', 'audio', 'sticker', 'caption']),
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
      children: z.array(StrictDesignerElementSchema).max(MAX_ELEMENTS_PER_OUTPUT),
    },
    {
      ...designerOutputCommon,
      width: lenientNum(1, MAX_DIMENSION, 1080),
      height: lenientNum(1, MAX_DIMENSION, 1080),
      bg: LenientDesignerBackgroundSchema.optional(),
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
  version: z.number().int().min(1).max(2),
  mode: z.literal('image'),
};
const { strict: ImageDocStrictSchema, lenient: ImageDocLenientSchema } = dualObject(
  {
    ...docCommon,
    outputs: z.array(StrictDesignerOutputSchema).min(1).max(MAX_OUTPUTS),
    attribution: StrictDesignerAttributionSchema.optional(),
  },
  {
    ...docCommon,
    outputs: z.array(LenientDesignerOutputSchema).min(1).max(MAX_OUTPUTS),
    attribution: LenientDesignerAttributionSchema.optional(),
  }
);

const videoDocCommon = {
  version: z.number().int().min(1).max(2),
  mode: z.literal('video'),
};
const { strict: VideoDocStrictSchema, lenient: VideoDocLenientSchema } = dualObject(
  {
    ...videoDocCommon,
    outputs: z.array(StrictVideoOutputSchema).min(1).max(MAX_OUTPUTS),
    attribution: StrictDesignerAttributionSchema.optional(),
  },
  {
    ...videoDocCommon,
    outputs: z.array(LenientVideoOutputSchema).min(1).max(MAX_OUTPUTS),
    attribution: LenientDesignerAttributionSchema.optional(),
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

export const DesignerDocStrictSchema = z.discriminatedUnion('mode', [
  ImageDocStrictSchema,
  VideoDocStrictSchema,
]);

export const DesignerDocLenientSchema = z.discriminatedUnion('mode', [
  ImageDocLenientSchema,
  VideoDocLenientSchema,
]);

