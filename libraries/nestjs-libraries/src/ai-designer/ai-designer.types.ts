import type { DesignerDoc, DesignerElement } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.schema';

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
  pendingReviseTarget?: string;
  answeredPromptIds?: string[];
  skillId?: string;
  [key: string]: unknown;
}

export interface DesignPlan {
  variantId: string;
  skill: string;
  concept: string;
  formatTemplate?: string;
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
}

export interface DesignSlot {
  id: string;
  role: 'top-caption' | 'bottom-caption' | 'image' | 'logo' | string;
  kind: 'text' | 'image';
}

export type SlotTextMap = Record<string, string>;

export interface AssetResult {
  slotId: string;
  fileId: string;
  path: string;
  type: 'image';
}

export type FixScope = 'shared' | 'format-only';

export interface Fix {
  scope: FixScope;
  targetSlots?: string[];
  geometry?: Partial<Pick<DesignerElement, 'x' | 'y' | 'width' | 'height' | 'fontSize'>>;
  style?: Partial<Pick<DesignerElement, 'fill' | 'stroke' | 'opacity'>>;
  text?: { slotId: string; newText: string };
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
  contactSheetFileId?: string;
  contactSheetUrl?: string;
}
