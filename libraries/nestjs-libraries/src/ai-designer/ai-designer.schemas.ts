import { z } from 'zod';

/**
 * Runtime schemas for the JSON columns stored on AiDesignerSession.
 *
 * These guards sit at the repository write path so malformed or attacker-shaped
 * payloads cannot be persisted as session state, even if a caller bypasses the
 * websocket DTO validation.
 */

export const AiDesignerStateSchema = z.enum([
  'intake',
  'planning',
  'awaiting_plan',
  'executing',
  'delivered',
  'revising',
]);

const CustomSizeSchema = z.object({
  width: z.number().int().min(16).max(4096),
  height: z.number().int().min(16).max(4096),
  name: z.string().max(100).optional(),
});

export const AiDesignerConfigSchema = z
  .object({
    channels: z.array(z.string().max(100)).min(1).max(20),
    customSizes: z.array(CustomSizeSchema).max(10).optional(),
    savePath: z.string().max(300).optional(),
    saveFolderId: z.string().max(100).optional(),
    brandProfileId: z.string().max(100).optional(),
    variants: z.number().int().min(1).max(10),
    referenceFileIds: z.array(z.string().max(100)).max(10).optional(),
  })
  .strict();

const BackgroundSchema = z
  .object({
    kind: z.enum(['solid', 'gradient', 'image']),
    ref: z.string().startsWith('asset:').max(200).optional(),
    value: z.string().max(500).optional(),
  })
  .passthrough();

const DesignSlotSchema = z
  .object({
    id: z.string().max(200),
    role: z.string().max(100),
    kind: z.enum(['text', 'image']),
  })
  .passthrough();

const AssetNeedSchema = z
  .object({
    slotId: z.string().max(200),
    brief: z.string().max(1000),
    prefer: z.enum(['generate', 'stock', 'either']),
  })
  .passthrough();

const TypeScaleSchema = z.record(z.number().min(0).max(1000));

const DesignPlanSchema = z
  .object({
    variantId: z.string().max(200),
    skill: z.string().max(200),
    concept: z.string().max(2000),
    formatTemplate: z.string().max(200).optional(),
    palette: z.array(z.string().max(100)).max(64),
    typeScale: TypeScaleSchema,
    background: BackgroundSchema,
    slots: z.array(DesignSlotSchema).max(200),
    assetNeeds: z.array(AssetNeedSchema).max(200),
    perChannel: z.record(z.object({ note: z.string().max(1000) })).optional(),
  })
  .passthrough();

export const DesignBriefSchema = z
  .object({
    intent: z.string().max(5000),
    audience: z.string().max(1000).optional(),
    tone: z.string().max(1000).optional(),
    includeLogo: z.boolean().optional(),
    fixedCopy: z.string().max(5000).optional(),
    referenceCues: z.array(z.string().max(2000)).max(50).optional(),
    questionsAsked: z.array(z.string().max(1000)).max(50).optional(),
    lastPlans: z.array(DesignPlanSchema).max(20).optional(),
    pendingReviseTarget: z.string().max(200).optional(),
    answeredPromptIds: z.array(z.string().max(200)).max(100).optional(),
    skillId: z.string().max(200).optional(),
  })
  .passthrough();

export const ActiveDesignIdsSchema = z
  .array(z.string().max(200))
  .max(20)
  .nullable();

// ── AI Designer message content schemas ──────────────────────────────────────
// These guard the Json `content` column on AiDesignerMessage. Each message is
// tagged by `kind` and carries a renderer payload. Schemas are intentionally
// permissive (passthrough) for fields the renderer may add, but enforce the
// shape required to persist and render safely.

const AiDesignerMediaItemSchema = z
  .object({
    url: z.string().max(2000),
    type: z.enum(['image', 'video']),
    caption: z.string().max(1000).optional(),
    designId: z.string().max(200).optional(),
    fileId: z.string().max(200).optional(),
  })
  .passthrough();

const AiDesignerTextMsgSchema = z.object({
  kind: z.literal('text'),
  text: z.string().max(20000),
});

const AiDesignerMarkdownMsgSchema = z.object({
  kind: z.literal('markdown'),
  md: z.string().max(50000),
});

const AiDesignerMediaMsgSchema = z.object({
  kind: z.literal('media'),
  items: z.array(AiDesignerMediaItemSchema).max(20),
});

const AiDesignerProgressMsgSchema = z
  .object({
    kind: z.literal('progress'),
    agent: z.string().max(100),
    phase: z.string().max(100),
    pct: z.number().int().min(0).max(100).optional(),
    note: z.string().max(2000).optional(),
  })
  .passthrough();

const AiDesignerPlanMsgSchema = z.object({
  kind: z.literal('plan'),
  brief: DesignBriefSchema,
  plans: z.array(DesignPlanSchema).max(20),
  actions: z.array(z.enum(['accept', 'revise'])).max(5),
});

const FormOptionSchema = z.object({
  value: z.string().max(500),
  label: z.string().max(500),
});

const FormFieldSchema = z.discriminatedUnion('type', [
  z.object({
    name: z.string().max(100),
    type: z.literal('radio'),
    label: z.string().max(500),
    options: z.array(FormOptionSchema).max(50),
  }),
  z.object({
    name: z.string().max(100),
    type: z.literal('select'),
    label: z.string().max(500),
    options: z.array(FormOptionSchema).max(50),
  }),
  z.object({
    name: z.string().max(100),
    type: z.literal('checkbox'),
    label: z.string().max(500),
    options: z.array(FormOptionSchema).max(50),
  }),
  z.object({
    name: z.string().max(100),
    type: z.literal('text'),
    label: z.string().max(500),
    placeholder: z.string().max(500).optional(),
  }),
  z.object({
    name: z.string().max(100),
    type: z.literal('number'),
    label: z.string().max(500),
    placeholder: z.string().max(500).optional(),
  }),
  z.object({
    name: z.string().max(100),
    type: z.literal('color'),
    label: z.string().max(500),
  }),
  z.object({
    name: z.string().max(100),
    type: z.literal('media-pick'),
    label: z.string().max(500),
  }),
]);

const AiDesignerFormMsgSchema = z.object({
  kind: z.literal('form'),
  prompt: z.string().max(5000),
  fields: z.array(FormFieldSchema).max(50),
  submitLabel: z.string().max(200).optional(),
});

export const AiDesignerMessageContentSchema = z.discriminatedUnion('kind', [
  AiDesignerTextMsgSchema,
  AiDesignerMarkdownMsgSchema,
  AiDesignerMediaMsgSchema,
  AiDesignerProgressMsgSchema,
  AiDesignerPlanMsgSchema,
  AiDesignerFormMsgSchema,
]);
