import { z } from 'zod';
import { STYLE_PRESET_IDS } from './styles';

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

const StylePresetIdSchema = z.enum(STYLE_PRESET_IDS);
// For PERSISTED values (plans, briefs): a preset id retired by a future
// release must not fail the session parse — fall back to the first preset,
// matching the `.catch` pattern of the sibling enums. Request-boundary
// schemas keep the strict enum so a bad client value still 400s.
const PersistedStylePresetIdSchema = StylePresetIdSchema.catch(
  STYLE_PRESET_IDS[0]
);

export const AiDesignerConfigSchema = z
  .object({
    channels: z.array(z.string().max(100)).max(20),
    customSizes: z.array(CustomSizeSchema).max(10).optional(),
    savePath: z.string().max(300).optional(),
    saveFolderId: z.string().max(100).optional(),
    brandProfileId: z.string().max(100).optional(),
    variants: z.number().int().min(1).max(10),
    referenceFileIds: z.array(z.string().max(100)).max(10).optional(),
    styleId: StylePresetIdSchema.optional(),
  })
  .strict()
  // Cross-field, mirroring the start DTO: the form allows custom-sizes-only
  // sessions, so channels may be empty only when custom sizes are provided.
  .refine(
    (config) =>
      config.channels.length > 0 || (config.customSizes?.length ?? 0) > 0,
    { message: 'provide at least one channel or one custom size', path: ['channels'] }
  );

const BackgroundSchema = z
  .object({
    kind: z.enum(['solid', 'gradient', 'image']),
    ref: z.string().startsWith('asset:').max(200).optional(),
    value: z.string().max(500).optional(),
  })
  .passthrough();

const SlotStyleSchema = z
  .object({
    fontFamily: z.string().max(200).optional(),
    fontWeight: z.number().int().min(100).max(900).optional(),
    fill: z.string().max(100).optional(),
    // Legacy two-stop tuple or the full form (multi-stop, radial + focal).
    gradient: z
      .union([
        z.tuple([z.string().max(100), z.string().max(100)]),
        z.object({
          type: z.enum(['linear', 'radial']).optional(),
          angle: z.number().min(-360).max(360).optional(),
          focalX: z.number().min(0).max(1).optional(),
          focalY: z.number().min(0).max(1).optional(),
          stops: z
            .array(
              z.object({
                color: z.string().max(100),
                offset: z.number().min(0).max(1),
              })
            )
            .min(2)
            .max(5),
        }),
      ])
      .optional(),
    stroke: z
      .object({
        color: z.string().max(100),
        width: z.number().min(0).max(50),
      })
      .optional(),
    // true/false keeps the legacy preset behaviour; the object form gives the
    // planner full control over the drop shadow.
    shadow: z
      .union([
        z.boolean(),
        z.object({
          color: z.string().max(100),
          blur: z.number().min(0).max(200),
          offsetX: z.number().min(-100).max(100),
          offsetY: z.number().min(-100).max(100),
        }),
      ])
      .optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    // Tracking in px (negative tightens) and leading as a font-size multiple —
    // the two craft dials letterspaced caps and tight display type need.
    letterSpacing: z.number().min(-2).max(20).optional(),
    lineHeight: z.number().min(1).max(1.6).optional(),
    opacity: z.number().min(0).max(1).optional(),
    // Condensation, case, paragraph rhythm and arc — the new type tools. All
    // clamped to craft ranges tighter than the document schema allows.
    textScaleX: z.number().min(0.5).max(1.25).optional(),
    textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),
    paragraphSpacing: z.number().min(0).max(100).optional(),
    firstLineIndent: z.number().min(0).max(100).optional(),
    curve: z.enum(['arc-up', 'arc-down']).optional(),
    borderRadius: z
      .union([
        z.number().min(0).max(400),
        z.tuple([
          z.number().min(0).max(400),
          z.number().min(0).max(400),
          z.number().min(0).max(400),
          z.number().min(0).max(400),
        ]),
      ])
      .optional(),
    badgeStyle: z.enum(['pill', 'burst', 'ribbon']).optional(),
    ctaStyle: z.enum(['pill', 'rect', 'underline', 'outline']).optional(),
  })
  .passthrough();

// An unknown recipe name must never sink an otherwise-valid plan: the catalog
// is generated from tables that change, and stored plans outlive them. The
// composer drops what it does not recognise, so the guard only bounds size.
const RecipeNameSchema = z.string().max(100);

const DesignSlotSchema = z
  .object({
    id: z.string().max(200),
    role: z.string().max(100),
    kind: z
      .enum([
        'text',
        'image',
        'cta-button',
        'badge',
        'accent-shape',
        'shape',
        'icon',
        'divider',
        'logo',
        'frame',
      ])
      // A kind this build does not know degrades to text rather than dropping
      // the slot, which would silently lose the copy it carries.
      .catch('text'),
    style: SlotStyleSchema.optional(),
    effects: z.array(RecipeNameSchema).max(4).optional(),
    treatment: RecipeNameSchema.optional(),
    // Scales the chosen treatment's parameters (0 = no-op, 1 = full recipe).
    // Plan-level "depth" stays the default when omitted.
    treatmentStrength: z.number().min(0).max(1).optional(),
    mask: RecipeNameSchema.optional(),
    blend: z.string().max(40).optional(),
    rotation: z.number().min(-180).max(180).optional(),
    warp: RecipeNameSchema.optional(),
    sides: z.number().int().min(3).max(12).optional(),
    innerRatio: z.number().min(0.3).max(0.7).optional(),
    // A directional gradient scrim over this image slot so type on top stays
    // legible — the planner's dial for creating a quiet type zone.
    scrim: z
      .object({
        direction: z.enum(['left', 'right', 'top', 'bottom', 'full']),
        strength: z.number().min(0).max(1),
      })
      .optional(),
  })
  .passthrough();

// Layout intent is a hint consumed from Phase 2B on — an unknown value must
// never sink an otherwise-valid plan, so it falls back instead of failing.
const ChannelLayoutSchema = z
  .enum(['stacked', 'side-by-side', 'hero-top', 'minimal-centered'])
  .catch('stacked');

const AssetNeedSchema = z
  .object({
    slotId: z.string().max(200),
    brief: z.string().max(1000),
    prefer: z.enum(['generate', 'stock', 'either']),
  })
  .passthrough();

const TypeScaleSchema = z.record(z.number().min(0).max(1000));

export const DesignPlanSchema = z
  .object({
    variantId: z.string().max(200),
    skill: z.string().max(200),
    concept: z.string().max(2000),
    formatTemplate: z.string().max(200).optional(),
    styleId: PersistedStylePresetIdSchema.optional(),
    palette: z.array(z.string().max(100)).max(64),
    typeScale: TypeScaleSchema,
    background: BackgroundSchema,
    slots: z.array(DesignSlotSchema).max(200),
    assetNeeds: z.array(AssetNeedSchema).max(200),
    // Plan-time copy per copy-slot id — shown on the plan card and editable
    // by the user before acceptance.
    texts: z.record(z.string().max(200), z.string().max(500)).optional(),
    perChannel: z.record(z.object({ note: z.string().max(1000) })).optional(),
    channelLayouts: z.record(z.string().max(100), ChannelLayoutSchema).optional(),
    // Plan schema v3 — the design language. All optional, so v1/v2 plans keep
    // composing unchanged.
    composition: z.string().max(100).optional(),
    depth: z.enum(['flat', 'layered', 'deep']).catch('layered').optional(),
    decor: z.array(RecipeNameSchema).max(6).optional(),
    // Split/sidebar layouts: which side the TEXT panel sits on.
    panelSide: z.enum(['left', 'right']).optional(),
    // Where the badge sits inside its layout band.
    // A CENTRED badge is a standard poster device — the ribbon under a
    // centred type stack — and the planner asked for `top-center` on the very
    // first reference run. Without these the enum rejected it, and because a
    // stored plan is re-validated on load, the whole SESSION died with "I hit
    // a problem" rather than the badge landing a few pixels off.
    badgePosition: z
      .enum([
        'top-left',
        'top-center',
        'top-right',
        'bottom-left',
        'bottom-center',
        'bottom-right',
        'center',
      ])
      // Never fatal: an unrecognised position degrades to the composer's own
      // placement, exactly as every recipe name does. A plan that outlives a
      // build of this enum must still open.
      .catch(undefined as never)
      .optional(),
  })
  .passthrough();

/**
 * Per-item guard for the v2 plan fields, used by the art director to drop a
 * single malformed LLM plan without failing the batch. Only the fields added
 * in schema v2 are asserted here — the legacy structural checks stay in the
 * service so v1-shaped plans keep passing.
 */
export const DesignPlanV2FieldsSchema = z
  .object({
    styleId: StylePresetIdSchema.optional(),
    channelLayouts: z
      .record(z.string().max(100), ChannelLayoutSchema)
      .optional(),
    slots: z
      .array(
        z
          .object({
            style: SlotStyleSchema.optional(),
          })
          .passthrough()
      )
      .optional(),
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
    styleId: PersistedStylePresetIdSchema.optional(),
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
