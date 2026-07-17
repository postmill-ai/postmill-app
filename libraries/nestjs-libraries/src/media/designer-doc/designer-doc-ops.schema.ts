import { z } from 'zod';
import {
  MAX_DIMENSION,
  MAX_OPS_PER_REQUEST,
} from './designer-doc.limits';
import {
  DesignerDocStrictSchema,
  StrictDesignerBackgroundSchema,
  StrictDesignerElementSchema,
  SrcSchema,
} from './designer-doc.schema';

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
  StrictDesignerElementSchema.omit({
    id: true,
    originId: true,
    type: true,
  })
    .partial()
    .strict();

const SetDocOpSchema = z.object({
  op: z.literal('setDoc'),
  doc: DesignerDocStrictSchema,
});

const RemoveOutputOpSchema = z.object({
  op: z.literal('removeOutput'),
  outputIndex: outputIndex,
});

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
  element: StrictDesignerElementSchema.omit({ id: true, originId: true }).strict(),
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
  AddElementOpSchema,
  UpdateElementOpSchema,
  RemoveElementOpSchema,
  ReorderElementOpSchema,
  PlaceImageOpSchema,
]);

export type DesignerDocOp = z.infer<typeof DesignerDocOpSchema>;

export const IMAGE_ONLY_OPS = new Set([
  'addOutput',
  'resizeOutput',
  'setOutputBackground',
  'addElement',
  'updateElement',
  'removeElement',
  'reorderElement',
  'placeImage',
]);

export const DesignerDocOpsSchema = z
  .array(DesignerDocOpSchema)
  .max(MAX_OPS_PER_REQUEST);
