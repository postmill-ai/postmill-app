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
  /** Set by the art director when this plan is a generic fallback (LLM planning failed). */
  fallback?: boolean;
}

/** Optional per-slot style override — wins over the preset-derived defaults. */
export interface DesignSlotStyle {
  fontFamily?: string;
  fontWeight?: number;
  fill?: string;
  gradient?: [string, string];
  stroke?: { color: string; width: number };
  shadow?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Badge slot shape override — wins over the preset's badgeStyle treatment. */
  badgeStyle?: 'pill' | 'burst' | 'ribbon';
}

export interface DesignSlot {
  id: string;
  role: 'top-caption' | 'bottom-caption' | 'image' | 'logo' | string;
  kind: 'text' | 'image' | 'cta-button' | 'badge' | 'accent-shape';
  style?: DesignSlotStyle;
}

/** Slots that carry copy (everything except imagery and decorative shapes). */
export const isCopySlot = (slot: Pick<DesignSlot, 'kind'>): boolean =>
  slot.kind !== 'image' && slot.kind !== 'accent-shape';

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
  /** Provider-supplied focal point for cover-cropping; the composer defaults to center. */
  focalPoint?: { x: number; y: number };
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
  /** Text outline (maps to the element's `textStroke`). */
  textStroke?: DesignerTextStroke;
  textShadow?: boolean;
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
  type: 'text' | 'shape';
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
