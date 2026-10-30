import { z } from 'zod';
import {
  MAX_DIMENSION,
  MAX_FONT_SIZE,
  MAX_OPS_PER_REQUEST,
  MAX_TEXT_LEN,
  MAX_VIDEO_DURATION_MS,
} from './designer-doc.limits';
import {
  ColorSchema,
  DesignerDocStrictSchema,
  StrictDesignerBackgroundSchema,
  StrictDesignerElementBaseSchema,
  StrictDesignerGradientSchema,
  SrcSchema,
  withIconSrcGuard,
} from './designer-doc.schema';
import { migrateDoc } from './designer-doc.migrate';

const strictNum = (min: number, max: number) =>
  z.number().finite().min(min).max(max);

const outputIndex = z.number().int().min(0).max(1024);

const BoxSchema = z
  .object({
    x: strictNum(-MAX_DIMENSION, MAX_DIMENSION).optional(),
    y: strictNum(-MAX_DIMENSION, MAX_DIMENSION).optional(),
    width: strictNum(0, MAX_DIMENSION).optional(),
    height: strictNum(0, MAX_DIMENSION).optional(),
  })
  .strict();

const AddOutputPresetSchema = z
  .object({
    formatId: z.string().max(64),
    name: z.string().max(200),
    width: strictNum(1, MAX_DIMENSION),
    height: strictNum(1, MAX_DIMENSION),
  })
  .strict();

const UpdateElementPatchSchema =
  // The exported element schema is refined (icon-src guard); a partial patch
  // carries no `type`, so the guard cannot apply here — derive from the
  // unguarded base (zod 4: .omit() throws on objects carrying checks). The
  // merged element is validated as a whole downstream.
  StrictDesignerElementBaseSchema.omit({
      id: true,
      originId: true,
      type: true,
    })
    .partial()
    .strict();

const SetDocOpSchema = z.object({
  op: z.literal('setDoc'),
  // Embedded docs go through the same migration as every other doc entry
  // point (validate/validateStrict) — agent-emitted docs routinely omit
  // normalized fields like `version`, which migrateDoc defaults.
  doc: z.preprocess((raw) => migrateDoc(raw), DesignerDocStrictSchema),
});

const RemoveOutputOpSchema = z.object({
  op: z.literal('removeOutput'),
  outputIndex: outputIndex,
});

// Pages (doc v8, image mode only). `pageNumber` is 0-based across the whole
// output: 0 is page 1 (`output.children`), n ≥ 1 is `output.pages[n - 1]`.
const pageNumber = z.number().int().min(0).max(1024);

const AddPageOpSchema = z
  .object({
    op: z.literal('addPage'),
    outputIndex: outputIndex,
    name: z.string().max(200).optional(),
    background: StrictDesignerBackgroundSchema.optional(),
  })
  .strict();

const RemovePageOpSchema = z
  .object({
    op: z.literal('removePage'),
    outputIndex: outputIndex,
    // Page 1 (pageNumber 0) is the output itself and cannot be removed.
    pageNumber: pageNumber,
  })
  .strict();

const DuplicatePageOpSchema = z
  .object({
    op: z.literal('duplicatePage'),
    outputIndex: outputIndex,
    pageNumber: pageNumber,
  })
  .strict();

const ReorderPageOpSchema = z
  .object({
    op: z.literal('reorderPage'),
    outputIndex: outputIndex,
    from: pageNumber,
    to: pageNumber,
  })
  .strict();

const AddOutputOpSchema = z.object({
  op: z.literal('addOutput'),
  preset: AddOutputPresetSchema,
  // Default (absent/true) seeds the new output from the primary output's
  // children; `false` opts out and appends an empty white canvas (the
  // pre-seeding behavior).
  seed: z.boolean().optional(),
});

const ResizeOutputOpSchema = z
  .object({
    op: z.literal('resizeOutput'),
    outputIndex: outputIndex,
    width: strictNum(1, MAX_DIMENSION),
    height: strictNum(1, MAX_DIMENSION),
    formatId: z.string().max(64).optional(),
    name: z.string().max(200).optional(),
  })
  .strict();

const SetOutputBackgroundOpSchema = z.object({
  op: z.literal('setOutputBackground'),
  outputIndex: outputIndex,
  background: StrictDesignerBackgroundSchema,
});

const AddElementOpSchema = z.object({
  op: z.literal('addElement'),
  outputIndex: outputIndex,
  // `id` stays server-assigned; `originId` is allowed so a headless caller
  // (e.g. the AI Designer composer) can link the new element across outputs.
  element: withIconSrcGuard(
    StrictDesignerElementBaseSchema.omit({ id: true }).strict()
  ),
  beforeElementId: z.string().max(200).optional(),
});

const UpdateElementOpSchema = z
  .object({
    op: z.literal('updateElement'),
    outputIndex: outputIndex,
    elementId: z.string().max(200),
    patch: UpdateElementPatchSchema,
    scope: z.enum(['shared', 'format-only']).optional(),
  })
  .strict();

const RemoveElementOpSchema = z.object({
  op: z.literal('removeElement'),
  outputIndex: outputIndex,
  elementId: z.string().max(200),
});

const ReorderElementOpSchema = z
  .object({
    op: z.literal('reorderElement'),
    outputIndex: outputIndex,
    elementId: z.string().max(200),
    dir: z.enum(['front', 'back', 'forward', 'backward']),
  })
  .strict();

const PlaceImageOpSchema = z
  .object({
    op: z.literal('placeImage'),
    outputIndex: outputIndex,
    src: SrcSchema,
    fileId: z.string().max(200).optional(),
    box: BoxSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Clip ops (video outputs)
//
// SCOPE RULE: clip ops are FORMAT-LOCAL — they apply only to the addressed
// `outputIndex`, with no cross-output propagation. Clips DO carry `originId`
// (video variants link through it and the interactive editor propagates
// content/style across them — see `designer-doc/apply-linked`), but the
// headless/AI revise path deliberately stays single-output in v1: a revise
// asks for one visible change and the format-local result is what the
// vision re-check judges. Geometry and timing never propagate even in the
// editor (`VIDEO_CLIP_LOCAL_KEYS`), and keyframe-level animation edits are
// NOT expressible here at all — those remain an honest "unsupported change".
// ---------------------------------------------------------------------------

/**
 * Whitelisted clip patch. Content (`text`), style (`fill`, `font*`),
 * geometry (`x`/`y`/`width`/`height` — the BASE box; keyframes are never
 * rewritten), `opacity` and timing (`startMs`/`endMs`, bounds-checked against
 * the output's `durationMs` at apply time). Media presentation is patchable
 * too — `fitMode`, audio (`volume`, `fadeInMs`/`fadeOutMs`) and `speed` —
 * with the same bounds the clip schema itself enforces. `src`/`fileId` are
 * deliberately absent — media swaps go through `replaceClipMedia`.
 */
const UpdateClipPatchSchema = z
  .object({
    text: z.string().max(MAX_TEXT_LEN).optional(),
    fill: ColorSchema.optional(),
    fillGradient: StrictDesignerGradientSchema.optional(),
    align: z.enum(['left', 'center', 'right', 'justify']).optional(),
    fontFamily: z.string().max(200).optional(),
    fontSize: strictNum(1, MAX_FONT_SIZE).optional(),
    fontWeight: strictNum(1, 1000).optional(),
    fontStyle: z.enum(['normal', 'italic']).optional(),
    x: strictNum(-MAX_DIMENSION, MAX_DIMENSION).optional(),
    y: strictNum(-MAX_DIMENSION, MAX_DIMENSION).optional(),
    width: strictNum(0, MAX_DIMENSION).optional(),
    height: strictNum(0, MAX_DIMENSION).optional(),
    opacity: strictNum(0, 1).optional(),
    startMs: strictNum(0, MAX_VIDEO_DURATION_MS).optional(),
    endMs: strictNum(0, MAX_VIDEO_DURATION_MS).optional(),
    fitMode: z.enum(['contain', 'cover', 'fill']).optional(),
    fadeInMs: strictNum(0, MAX_VIDEO_DURATION_MS).optional(),
    fadeOutMs: strictNum(0, MAX_VIDEO_DURATION_MS).optional(),
    volume: strictNum(0, 1).optional(),
    speed: strictNum(0.1, 10).optional(),
  })
  .strict();

const clipAddress = {
  outputIndex,
  /** Narrows the search when clip ids collide across tracks. */
  trackId: z.string().max(200).optional(),
  clipId: z.string().max(200),
};

const UpdateClipOpSchema = z
  .object({
    op: z.literal('updateClip'),
    ...clipAddress,
    patch: UpdateClipPatchSchema,
  })
  .strict();

const ReplaceClipMediaOpSchema = z
  .object({
    op: z.literal('replaceClipMedia'),
    ...clipAddress,
    src: SrcSchema,
    fileId: z.string().max(200).optional(),
    focalPoint: z
      .object({ x: z.number().finite(), y: z.number().finite() })
      .strict()
      .optional(),
    naturalWidth: strictNum(0, MAX_DIMENSION).optional(),
    naturalHeight: strictNum(0, MAX_DIMENSION).optional(),
  })
  .strict();

const ClipTransitionInputSchema = z
  .object({
    type: z.enum(['cut', 'fade', 'dissolve', 'slide', 'wipe', 'zoom', 'blur']),
    durationMs: strictNum(0, MAX_VIDEO_DURATION_MS),
    direction: z.enum(['left', 'right', 'up', 'down']).optional(),
  })
  .strict();

const UpdateTransitionOpSchema = z
  .object({
    op: z.literal('updateTransition'),
    ...clipAddress,
    edge: z.enum(['in', 'out']),
    /** `null` removes the transition on that edge. */
    transition: ClipTransitionInputSchema.nullable(),
  })
  .strict();

export const DesignerDocOpSchema = z.discriminatedUnion('op', [
  SetDocOpSchema,
  RemoveOutputOpSchema,
  AddOutputOpSchema,
  ResizeOutputOpSchema,
  SetOutputBackgroundOpSchema,
  AddPageOpSchema,
  RemovePageOpSchema,
  DuplicatePageOpSchema,
  ReorderPageOpSchema,
  AddElementOpSchema,
  UpdateElementOpSchema,
  RemoveElementOpSchema,
  ReorderElementOpSchema,
  PlaceImageOpSchema,
  UpdateClipOpSchema,
  ReplaceClipMediaOpSchema,
  UpdateTransitionOpSchema,
]);

export type DesignerDocOp = z.infer<typeof DesignerDocOpSchema>;

// Element- and page-level ops that only make sense on image outputs.
// addOutput/resizeOutput are deliberately NOT here: both are video-aware
// (see DesignerDocService._applyOp — a video doc gets a cloned+reflowed
// VideoOutput variant), so mode gating happens per-branch, not per-op.
// setOutputBackground is not here either: VideoOutput carries `bg`, so the
// op works on both output kinds. The clip ops above are the video-side
// vocabulary; they gate on the target being a VIDEO output in _applyOp.
export const IMAGE_ONLY_OPS = new Set([
  'addPage',
  'removePage',
  'duplicatePage',
  'reorderPage',
  'addElement',
  'updateElement',
  'removeElement',
  'reorderElement',
  'placeImage',
]);

export const DesignerDocOpsSchema = z
  .array(DesignerDocOpSchema)
  .max(MAX_OPS_PER_REQUEST);
