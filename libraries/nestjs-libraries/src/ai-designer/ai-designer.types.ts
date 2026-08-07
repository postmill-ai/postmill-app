import type { DesignerDoc, DesignerElement, DesignerTextStroke } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import type { TextContrastViolation } from '@postmill-ai/nestjs-libraries/media/design-render/design-render.types';

export type AiDesignerMode = 'chat' | 'prompt';

export type AiDesignerFormat = 'image' | 'video';

export type AiDesignerSessionState =
  | 'intake'
  | 'planning'
  | 'awaiting_plan'
  | 'executing'
  | 'delivered'
  | 'revising';

export type AiDesignerMessageRole = 'user' | 'assistant' | 'system' | 'agent';

export type AiDesignerMessageKind =
  | 'text'
  | 'markdown'
  | 'media'
  | 'progress'
  | 'plan'
  | 'form';

export interface AiDesignerConfig {
  channels: string[];
  customSizes?: { width: number; height: number; name?: string }[];
  savePath?: string;
  saveFolderId?: string;
  brandProfileId?: string;
  variants: number;
  referenceFileIds?: string[];
  /** User-selected style preset id (registry in `ai-designer/styles`); omitted = AI decides. */
  styleId?: string;
}

export interface DesignBrief {
  intent: string;
  audience?: string;
  tone?: string;
  includeLogo?: boolean;
  fixedCopy?: string;
  referenceCues?: string[];
  questionsAsked?: string[];
  lastPlans?: DesignPlan[];
  /**
   * Server-owned recap gate: set by the conductor when the conversationalist
   * emits the brief recap, and the only thing that lets a later accept
   * advance to planning. Reserved (clients/forms can't forge it).
   */
  recapShown?: boolean;
  /**
   * Server-owned record of the design ids the LATEST delivery presented.
   * Template auto-save on accept scopes to these, not every id ever active
   * (superseded revisions stay in `activeDesignIds` but are not saved).
   */
  lastDeliveredDesignIds?: string[];
  pendingReviseTarget?: string;
  answeredPromptIds?: string[];
  skillId?: string;
  /**
   * Server-owned count of CONSECUTIVE conversationalist classification
   * failures during intake (reset on any success). Reserved.
   */
  classifierFailures?: number;
  /**
   * Server-owned one-time gate for the "trouble reaching your AI provider"
   * intake note (set when the note is emitted). Reserved.
   */
  llmWarningShown?: boolean;
  /** User-selected style preset (flows from config into the plan prompt). */
  styleId?: string;
  [key: string]: unknown;
}

export interface DesignPlan {
  variantId: string;
  skill: string;
  concept: string;
  formatTemplate?: string;
  /** Style preset id from the registry; omitted plans use the default style. */
  styleId?: string;
  palette: string[];
  typeScale: Record<string, number>;
  background: {
    kind: 'solid' | 'gradient' | 'image';
    ref?: `asset:${string}`;
    value?: string;
  };
  slots: DesignSlot[];
  assetNeeds: {
    slotId: string;
    brief: string;
    prefer: 'generate' | 'stock' | 'either';
  }[];
  perChannel?: Record<string, { note: string }>;
  /**
   * Final copy per copy-slot id, written at plan time so the user can read
   * (and edit) the actual text before accepting. On accept the conductor
   * locks these for the copywriter (locked slots are never rewritten).
   */
  texts?: Record<string, string>;
  /** Per-channel layout intent (consumed by the composer from Phase 2B on). */
  channelLayouts?: Record<
    string,
    'stacked' | 'side-by-side' | 'hero-top' | 'minimal-centered'
  >;
  /**
   * Which side the solid panel/sidebar sits on for the split-panel and
   * editorial-sidebar layouts. Optional and backwards compatible — plans
   * without it default to a left panel. (The plan schema is passthrough, so
   * art-director output carrying this field flows straight through.)
   */
  panelSide?: 'left' | 'right';
  /**
   * Where the badge sits inside its layout band (the text panel for
   * split/sidebar layouts, the full canvas otherwise). Optional and backwards
   * compatible — plans without it keep each template's hardcoded corner. The
   * badge-burst layout ignores it (the badge IS its centerpiece).
   */
  badgePosition?:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'
    | 'center';
  /**
   * Which arrangement to use, from the composition gallery.
   *
   * Supersedes `formatTemplate` and `channelLayouts`, which named one of six
   * hard-coded templates. Both are still read, so stored plans keep composing;
   * a composition that does not suit the canvas is replaced rather than forced.
   */
  composition?: string;
  /**
   * How much depth the design should carry. Drives whether imagery is pushed
   * back behind copy, whether the subject is knocked out to sit in front of
   * type, and how freely effects are applied.
   */
  depth?: 'flat' | 'layered' | 'deep';
  /**
   * Vector decoration for the design as a whole, by recipe name. At most one
   * "loud" mark survives — restraint has to be structural, because a model told
   * to decorate tastefully will not comply reliably.
   */
  decor?: string[];
  /** Set by the art director when this plan is a generic fallback (LLM planning failed). */
  fallback?: boolean;
}

/** Optional per-slot style override — wins over the preset-derived defaults. */
export interface DesignSlotStyle {
  fontFamily?: string;
  fontWeight?: number;
  fill?: string;
  /**
   * Legacy two-stop tuple, or the full form: any number of stops (2–5),
   * linear at an angle or radial with an off-centre focal point. The composer
   * emits `fillGradient` from either.
   */
  gradient?:
    | [string, string]
    | {
        type?: 'linear' | 'radial';
        angle?: number;
        focalX?: number;
        focalY?: number;
        stops: { color: string; offset: number }[];
      };
  stroke?: { color: string; width: number };
  /**
   * true/false keeps the legacy preset behaviour; the object form gives the
   * planner full control over the drop shadow.
   */
  shadow?: boolean | { color: string; blur: number; offsetX: number; offsetY: number };
  align?: 'left' | 'center' | 'right';
  /** Tracking in px (negative tightens) — the dial letterspaced caps need. */
  letterSpacing?: number;
  /** Leading as a font-size multiple (1.0–1.6). */
  lineHeight?: number;
  opacity?: number;
  /**
   * Horizontal glyph condensation (0.5–1.25). 0.6 reads like a condensed cut
   * of the face — the tool for tall display type in a narrow measure.
   */
  textScaleX?: number;
  /** Case as a render property — measured AND painted transformed. */
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  /** Extra leading before each paragraph after the first, in px (0–100). */
  paragraphSpacing?: number;
  /** First-line indent of each paragraph, in px (0–100). */
  firstLineIndent?: number;
  /**
   * Arc the line of text: 'arc-up' bows ∩, 'arc-down' bows ∪. The composer
   * converts to the document's numeric curve scaled from the slot box.
   */
  curve?: 'arc-up' | 'arc-down';
  /**
   * Corner rounding for badge/CTA/shape plates: one number, or
   * [topLeft, topRight, bottomRight, bottomLeft].
   */
  borderRadius?: number | [number, number, number, number];
  /** Badge slot shape override — wins over the preset's badgeStyle treatment. */
  badgeStyle?: 'pill' | 'burst' | 'ribbon';
  /** CTA slot shape override — wins over the preset's ctaStyle treatment. */
  ctaStyle?: 'pill' | 'rect' | 'underline' | 'outline';
}

export interface DesignSlot {
  id: string;
  role: 'top-caption' | 'bottom-caption' | 'image' | 'logo' | string;
  kind:
    | 'text'
    | 'image'
    | 'cta-button'
    | 'badge'
    | 'accent-shape'
    // Added with the design language. Additive: the five above still compose.
    | 'shape'
    | 'icon'
    | 'divider'
    | 'logo'
    | 'frame';
  style?: DesignSlotStyle;
  /**
   * Layer-style recipes by name, from the effect catalog. At most two per
   * element; unknown names are dropped rather than failing the plan.
   */
  effects?: string[];
  /** Image treatment recipe by name. Images only. */
  treatment?: string;
  /** Mask recipe by name. Images only. */
  mask?: string;
  /** Blend mode, for elements that should interact with what is beneath them. */
  blend?: string;
  /** Rotation in degrees. Decorative and badge elements only. */
  rotation?: number;
  /**
   * Warp recipe by name, from the warp catalog (arched ribbons, flag waves).
   * Shape/badge/CTA plates only; unknown names are dropped.
   */
  warp?: string;
  /** Star points / polygon sides (3–12), accent-shape and shape kinds. */
  sides?: number;
  /** Star inner-radius ratio (0.3–0.7). */
  innerRatio?: number;
  /** Scales the chosen treatment's parameters (0 = no-op, 1 = full recipe). */
  treatmentStrength?: number;
  /**
   * A directional gradient scrim over this image slot so type on top stays
   * legible — how the planner creates a quiet type zone in a busy photo.
   */
  scrim?: {
    direction: 'left' | 'right' | 'top' | 'bottom' | 'full';
    strength: number;
  };
}

/**
 * Slots that carry copy — the kinds the copywriter writes text for, the
 * composer lays out as type, and the plan card lets the user edit. Decorative
 * and structural kinds (divider/logo/frame/shape/icon, imagery, accent
 * shapes) are NOT copy: treating them as such asks the copywriter for divider
 * "copy" and renders it as a stray body line. Matches the fill-panel mapping
 * in `util/template-slots.ts`.
 */
export const isCopySlot = (slot: Pick<DesignSlot, 'kind'>): boolean =>
  slot.kind === 'text' || slot.kind === 'cta-button' || slot.kind === 'badge';

export type SlotTextMap = Record<string, string>;

/** Aspect class of a generated asset / output format (see `util/aspect.ts`). */
export type AssetAspect = 'square' | 'wide' | 'tall';

/** One image generation request, scoped per plan (`${variantId}:${slotId}`) in the primary aspect by the conductor. */
export interface AssetNeedRequest {
  slotId: string;
  brief: string;
  prefer: 'generate' | 'stock' | 'either';
  /** Aspect class this generation targets; the asset is keyed `slotId:aspect`. */
  aspect?: AssetAspect;
  /**
   * Layout intent id (channelLayouts value or formatTemplate) for
   * background/hero slots — drives the text-space guidance appended to the
   * generation prompt. Absent for non-hero slots.
   */
  heroLayout?: string;
  /**
   * Stock id the caller already used for this slot. A regeneration passes the
   * previous pick so the (Redis-cached, deterministic) stock search cannot
   * hand back the identical photo — the silent regeneration no-op.
   */
  excludeStockId?: string;
  /**
   * Honor `prefer: 'stock'` verbatim on a REGENERATION instead of promoting it
   * to `'either'`. Set when the caller switched technique on purpose (the
   * brand_safety path: the image model already failed on that defect, so
   * re-generating is the same dice, not an escalation).
   */
  stockOnly?: boolean;
}

export interface AssetResult {
  slotId: string;
  fileId: string;
  path: string;
  type: 'image';
  /** Where the asset actually came from — compared against the plan's `prefer` to surface fallbacks. */
  source?: 'generate' | 'stock' | 'gradient';
  /** Aspect class this asset was generated for (the map key carries it too). */
  aspect?: AssetAspect;
  /** Provider-supplied focal point for cover-cropping; wins over `subjectPoint`. */
  focalPoint?: { x: number; y: number };
  /**
   * Provider item id for a `source: 'stock'` asset. Lets a caller detect (and
   * exclude) a repeat pick across regenerations.
   */
  stockId?: string;
  /**
   * Layout intent the GENERATION prompt targeted (`LAYOUT_TEXT_SPACE` key).
   * Only set for `source: 'generate'` — it records where the model was told to
   * put the subject, which the composer crops toward. Stock/gradient assets
   * never obeyed that instruction, so they never carry it.
   */
  heroLayout?: string;
  /**
   * Subject centroid, normalized 0..1 in SOURCE image space. Not a crop focal
   * point — the composer converts it per target box (see `_focalPointFor`).
   *
   * No longer produced by asset resolution: the offline sharp-`attention`
   * probe that used to fill it was a saliency heuristic that measured drop
   * shadows, not subjects. The composer now sets it from the real VLM
   * detector, and only for crops that risk losing the subject
   * (`applySubjectFocalPoints`). Still read here so a provider that supplies
   * a centroid, and a regenerated asset carrying one, both keep working.
   */
  subjectPoint?: { x: number; y: number };
  /** Intrinsic pixel dimensions of the resolved file, when they could be read. */
  naturalWidth?: number;
  naturalHeight?: number;
}

export type FixScope = 'shared' | 'format-only';

/** Style half of a critic fix. `textShadow: true` synthesizes a default
 *  shadow scaled to the element's font size; `false` removes it. */
export interface FixStyle {
  fill?: string;
  stroke?: string;
  opacity?: number;
  fontFamily?: string;
  align?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  /** Tracking in px — the fix for cramped or un-designed all-caps labels. */
  letterSpacing?: number;
  /** Leading as a font-size multiple. */
  lineHeight?: number;
  /** Text outline (maps to the element's `textStroke`). */
  textStroke?: DesignerTextStroke;
  textShadow?: boolean;
  /** Horizontal condensation (0.5–1.25) — the fix for display type that wraps. */
  textScaleX?: number;
  /** Case as a render property — never a copy rewrite. */
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  /** Arc a single accent/ribbon line: subtended degrees, ±60 max. */
  curve?: number;
  /** Warp bend on a plate the slot already warps (−100..100). */
  warpBend?: number;
  /** Backdrop frost on a glass panel: blur px (0–40). */
  backdropBlur?: number;
  /** Blend mode by name — all 27 the renderer composites. */
  blend?: string;
}

/**
 * Constrained new-element spec for revise fixes: text/shape/badge-style
 * additions only. The composer fills in safe defaults (centered box, required
 * element fields) and validates the result through the doc schema, so a fix
 * can never inject an arbitrary element.
 */
export interface FixAddElement {
  /** Becomes the new element's originId, linking copies across outputs. */
  slotId: string;
  type: 'text' | 'shape' | 'icon' | 'divider';
  text?: string;
  shape?: 'rect' | 'ellipse' | 'line' | 'star';
  box?: Partial<Pick<DesignerElement, 'x' | 'y' | 'width' | 'height'>>;
  style?: {
    fill?: string;
    fontFamily?: string;
    fontSize?: number;
    align?: 'left' | 'center' | 'right';
    textStroke?: DesignerTextStroke;
    textShadow?: boolean;
  };
}

export interface Fix {
  scope: FixScope;
  targetSlots?: string[];
  /**
   * Design-language repairs. Without these the critic can SEE that imagery
   * fights the palette or that a headline has no separation from a busy photo,
   * and has no way to ask for the thing that would fix it — so it re-requests a
   * geometry nudge every round instead. A capability the critic cannot request
   * is a capability it can never repair.
   */
  effects?: string[];
  treatment?: string;
  mask?: string;
  blend?: string;
  /** Swap the whole arrangement, when the problem is the layout itself. */
  recompose?: string;
  geometry?: Partial<Pick<DesignerElement, 'x' | 'y' | 'width' | 'height' | 'fontSize'>>;
  style?: FixStyle;
  text?: { slotId: string; newText: string };
  /**
   * Regenerate the slot's underlying imagery (the only sanctioned fix for
   * baked-in text/logos/watermarks in a generated photo). `brief` is optional
   * extra guidance for the regeneration prompt. Handled deterministically by
   * the conductor — the composer never applies it.
   */
  regenerateAsset?: { slotId: string; brief?: string };
  addElement?: FixAddElement;
  /** Slot/originId (or element id) to remove from the targeted outputs. */
  removeElement?: string;
  note?: string;
}

export interface VisionFinding {
  formatId?: string;
  slotId?: string;
  issue: string;
  /**
   * Rubric criterion this finding violates (`brand_safety`, `text_fit`, …).
   * Optional — the model may omit it. The conductor uses it to pick the
   * REGENERATION TECHNIQUE: a `brand_safety` defect re-rolls stock instead of
   * the image model, which has already failed on that defect.
   */
  criterion?: string;
  fix?: Fix;
}

export interface RevisionRequest {
  instruction: string;
  targetDesignId?: string;
  scope: FixScope;
  targetOutputs?: string[];
  targetSlots?: string[];
}

export interface FormOption {
  value: string;
  label: string;
}

export type FormField =
  | { name: string; type: 'radio' | 'select'; label: string; options: FormOption[] }
  | { name: string; type: 'checkbox'; label: string; options: FormOption[] }
  | { name: string; type: 'text' | 'number'; label: string; placeholder?: string }
  | { name: string; type: 'color'; label: string }
  | { name: string; type: 'media-pick'; label: string };

export interface AiDesignerTextMsg {
  kind: 'text';
  text: string;
}

export interface AiDesignerMarkdownMsg {
  kind: 'markdown';
  md: string;
}

export interface AiDesignerMediaItem {
  url: string;
  type: 'image' | 'video';
  caption?: string;
  designId?: string;
  fileId?: string;
}

export interface AiDesignerMediaMsg {
  kind: 'media';
  items: AiDesignerMediaItem[];
}

export interface AiDesignerProgressMsg {
  kind: 'progress';
  agent: string;
  phase: string;
  pct?: number;
  note?: string;
}

export interface AiDesignerPlanMsg {
  kind: 'plan';
  brief: DesignBrief;
  plans: DesignPlan[];
  actions: ('accept' | 'revise')[];
}

export interface AiDesignerFormMsg {
  kind: 'form';
  prompt: string;
  fields: FormField[];
  submitLabel?: string;
}

export type AiDesignerMsgContent =
  | AiDesignerTextMsg
  | AiDesignerMarkdownMsg
  | AiDesignerMediaMsg
  | AiDesignerProgressMsg
  | AiDesignerPlanMsg
  | AiDesignerFormMsg;

export interface AiDesignerMessagePayload {
  id: string;
  seq: number;
  sessionId: string;
  role: AiDesignerMessageRole;
  agent?: string;
  kind: AiDesignerMessageKind;
  replyTo?: string;
  content: AiDesignerMsgContent;
  createdAt: string;
}

export interface AiDesignerSessionDto {
  id: string;
  organizationId: string;
  userId: string;
  mode: AiDesignerMode;
  format: AiDesignerFormat;
  config: AiDesignerConfig;
  brief: DesignBrief | null;
  state: AiDesignerSessionState;
  activeDesignIds: string[] | null;
  createdAt: string;
  updatedAt: string;
}

/** Map a Prisma AiDesignerSession row to the wire DTO (gateway + controller). */
export const toAiDesignerSessionDto = (session: {
  id: string;
  organizationId: string;
  userId: string;
  mode: string;
  format: string;
  config: unknown;
  brief: unknown;
  state: string;
  activeDesignIds: unknown;
  createdAt: Date;
  updatedAt: Date;
}): AiDesignerSessionDto => ({
  id: session.id,
  organizationId: session.organizationId,
  userId: session.userId,
  mode: session.mode as AiDesignerMode,
  format: session.format as AiDesignerFormat,
  config: session.config as AiDesignerConfig,
  brief: (session.brief as DesignBrief | null) ?? null,
  state: session.state as AiDesignerSessionState,
  activeDesignIds: (session.activeDesignIds as string[] | null) ?? null,
  createdAt: session.createdAt.toISOString(),
  updatedAt: session.updatedAt.toISOString(),
});

export interface AiDesignerStartPayload {
  config: AiDesignerConfig;
  prompt?: string;
  mode: AiDesignerMode;
  nonce: string;
}

export interface AiDesignerMessagePayloadDto {
  text: string;
  nonce: string;
}

export interface AiDesignerFormSubmitPayload {
  replyTo: string;
  values: Record<string, unknown>;
  nonce: string;
}

export interface AiDesignerAcceptPlanPayload {
  replyTo: string;
  variantId?: string;
  saveTemplate?: boolean;
  nonce: string;
}

export interface AiDesignerRevisePayload {
  instruction: string;
  targetDesignId?: string;
  nonce: string;
}

export interface AiDesignerAckPayload {
  seq: number;
}

export interface AiDesignerCancelPayload {
  nonce: string;
}

export interface AiDesignerAgentContext {
  orgId: string;
  sessionId: string;
  userId: string;
}

export interface AiDesignerRenderResult {
  designId: string;
  variantId: string;
  outputPreviews: { formatId: string; fileId: string; url: string }[];
  /** QC artifact for the vision critic — a transient storage path, never a
   *  user-visible `File` row in the org's library. */
  contactSheetUrl?: string;
  /** Text-over-imagery contrast failures sampled off the rendered pages
   *  (DesignRenderService.auditTextContrast) — the conductor's deterministic
   *  fixContrast pass consumes these. */
  contrastViolations?: TextContrastViolation[];
}
