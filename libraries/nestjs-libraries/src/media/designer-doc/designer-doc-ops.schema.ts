import { z } from 'zod';
import {
  MAX_DIMENSION,
  MAX_OPS_PER_REQUEST,
} from './designer-doc.limits';
import {
  DesignerDocStrictSchema,
  StrictDesignerBackgroundSchema,
  StrictDesignerElementBaseSchema,
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
]);

export type DesignerDocOp = z.infer<typeof DesignerDocOpSchema>;

// Element- and page-level ops that only make sense on image outputs.
// addOutput/resizeOutput are deliberately NOT here: both are video-aware
// (see DesignerDocService._applyOp — a video doc gets a cloned+reflowed
// VideoOutput variant), so mode gating happens per-branch, not per-op.
export const IMAGE_ONLY_OPS = new Set([
  'setOutputBackground',
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
