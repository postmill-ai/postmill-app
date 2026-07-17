import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentResponse } from '@reaatech/agent-mesh';
import { repair } from '@reaatech/structured-repair-core';
import { DesignerDocService } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.service';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { CHANNEL_PRESETS } from '@gitroom/nestjs-libraries/integrations/social/channel-presets';
import type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
} from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.schema';
import {
  DesignerDocOpsSchema,
  type DesignerDocOp,
} from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc-ops.schema';
import type {
  AssetResult,
  DesignPlan,
  Fix,
  SlotTextMap,
  VisionFinding,
} from '../../ai-designer.types';
import { raceWithTimeout } from '../../util/race-with-timeout';
import {
  isAgentInputError,
  parseAgentInput,
} from '../../util/parse-agent-input';

// Keys accepted from a Vision Critic fix, matching Fix['geometry']/['style']
// (and all valid under the strict updateElement patch schema).
const GEOMETRY_PATCH_KEYS = ['x', 'y', 'width', 'height', 'fontSize'] as const;
const STYLE_PATCH_KEYS = ['fill', 'stroke', 'opacity'] as const;

interface ComposerInput {
  plan: DesignPlan;
  copy: SlotTextMap;
  assets: Record<string, AssetResult>;
  outputs: { formatId: string; width: number; height: number; name?: string }[];
  orgId: string;
  userId: string;
  rawOps?: string;
}

@Injectable()
export class AiDesignerComposerService implements OnModuleInit {
  private readonly _logger = new Logger(AiDesignerComposerService.name);

  constructor(
    private readonly _docService: DesignerDocService,
    private readonly _model: AIModelProvider
  ) {}

  onModuleInit() {
    registerInProcessAgent('composer', this._handler.bind(this));
  }

  private _handler: InProcessHandler = async (
    context
  ): Promise<AgentResponse> => {
    const payload = parseAgentInput<ComposerInput>(context.raw_input);
    if (isAgentInputError(payload)) {
      return {
        content: JSON.stringify(payload),
        workflow_complete: false,
      };
    }
    const doc = await this.compose(payload);
    return {
      content: JSON.stringify({ type: 'doc', doc }),
      workflow_complete: false,
    };
  };

  // Returns the composed doc without persisting: AiDesignerSaverService is the
  // single Design writer (a createDesign here would orphan one row per variant
  // next to the saver's).
  async compose(input: ComposerInput): Promise<DesignerDoc> {
    const { plan, copy, assets, outputs, rawOps } = input;

    if (outputs.length === 0) {
      throw new Error('No outputs specified');
    }

    try {
      if (rawOps) {
        return await this._composeFromRawOps(rawOps, outputs, plan, copy, assets);
      }
      return this._composeDeterministic(plan, copy, assets, outputs);
    } catch (err) {
      this._logger.warn(
        `Composition failed, using fallback: ${(err as Error).message}`,
        AiDesignerComposerService.name
      );
      return this._buildFallbackDoc(outputs, plan, copy);
    }
  }

  /**
   * Apply Vision Critic findings to an existing doc and return the patched doc.
   * `signal` (the session's pipeline abort) stops the freeform-note LLM
   * re-emits between calls when the user cancels.
   */
  async applyFixes(
    doc: DesignerDoc,
    findings: VisionFinding[],
    orgId: string,
    signal?: AbortSignal
  ): Promise<DesignerDoc> {
    const ops: DesignerDocOp[] = [];
    const noteFixes: {
      note: string;
      scope: Fix['scope'];
      formatId?: string;
      targetSlots?: string[];
    }[] = [];

    for (const finding of findings) {
      const fix = finding.fix;
      if (!fix) continue;

      // Prefer the typed path; only fall back to an LLM re-emit when the fix
      // carries a freeform `note` and no typed field can express it (plan §7.1).
      const hasTyped = !!(fix.geometry || fix.style || fix.text);
      if (fix.note && !hasTyped) {
        noteFixes.push({
          note: fix.note,
          scope: fix.scope,
          formatId: finding.formatId,
          targetSlots: fix.targetSlots,
        });
        continue;
      }

      // Blast-radius guard: a geometry/style patch needs a slot scope
      // (`targetSlots`, falling back to the finding's `slotId`) — an unscoped
      // patch would apply to EVERY element of the targeted outputs (e.g.
      // `{ y: 1500 }` stacking the whole design). Skip it rather than corrupt
      // the doc; a `text` fix self-scopes by its own slotId and still applies.
      const slotScope = fix.targetSlots?.length
        ? fix.targetSlots
        : finding.slotId
        ? [finding.slotId]
        : undefined;
      if ((fix.geometry || fix.style) && !slotScope) {
        this._logger.warn(
          `Skipping unscoped geometry/style fix ("${finding.issue}") — no targetSlots/slotId.`,
          AiDesignerComposerService.name
        );
        if (!fix.text) continue;
      }

      const targetIndexes = this._resolveTargetOutputIndexes(
        doc,
        fix.scope,
        finding.formatId
      );

      for (const outputIndex of targetIndexes) {
        const out = doc.outputs[outputIndex];
        if (!out || !('children' in out)) continue;

        const targetIds = slotScope ? new Set(slotScope) : undefined;

        for (const el of out.children) {
          // Whitelist keys against the strict updateElement patch schema — a
          // single LLM-invented key (e.g. `color`) would otherwise zod-reject
          // the whole ops array and silently discard every valid fix.
          const patch: Partial<DesignerElement> = {};
          if (targetIds?.has(el.originId || el.id)) {
            if (fix.geometry) {
              Object.assign(patch, this._pickPatchKeys(fix.geometry, GEOMETRY_PATCH_KEYS, 'number'));
            }
            if (fix.style) {
              Object.assign(patch, this._pickPatchKeys(fix.style, STYLE_PATCH_KEYS));
            }
          }
          if (fix.text && (el.originId === fix.text.slotId || el.id === fix.text.slotId)) {
            patch.text = fix.text.newText;
          }

          if (Object.keys(patch).length > 0) {
            ops.push({
              op: 'updateElement',
              outputIndex,
              elementId: el.id,
              scope: fix.scope,
              patch,
            });
          }
        }
      }
    }

    let next = ops.length > 0 ? this._docService.applyOps(doc, ops) : doc;

    for (const nf of noteFixes) {
      // Cancel boundary between LLM re-emits: stop spending, return what has
      // been applied so far (the conductor throws at its next step boundary).
      if (signal?.aborted) break;
      next = await this._llmReviseOps(
        next,
        nf.note,
        nf.scope,
        orgId,
        nf.formatId ? [nf.formatId] : undefined,
        nf.targetSlots,
        signal
      );
    }

    return next;
  }

  /**
   * Apply a natural-language revise instruction by LLM-re-emitting
   * `updateElement` ops against the current doc (the plan §7.1 note escape
   * hatch / Q15 shared-vs-format-only revise). Returns the doc unchanged if the
   * model produces no valid ops.
   */
  async reviseByInstruction(
    doc: DesignerDoc,
    instruction: string,
    scope: Fix['scope'],
    orgId: string,
    targetOutputs?: string[],
    targetSlots?: string[],
    signal?: AbortSignal
  ): Promise<DesignerDoc> {
    return this._llmReviseOps(
      doc,
      instruction,
      scope,
      orgId,
      targetOutputs,
      targetSlots,
      signal
    );
  }

  private async _llmReviseOps(
    doc: DesignerDoc,
    instruction: string,
    scope: Fix['scope'],
    orgId: string,
    targetOutputs?: string[],
    targetSlots?: string[],
    signal?: AbortSignal
  ): Promise<DesignerDoc> {
    const summary = doc.outputs
      .map((out, outputIndex) => {
        if (!('children' in out)) return null;
        return {
          outputIndex,
          formatId: out.formatId,
          width: out.width,
          height: out.height,
          elements: out.children.map((el) => ({
            elementId: el.id,
            originId: el.originId,
            type: el.type,
            text: (el as { text?: string }).text,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            fontSize: (el as { fontSize?: number }).fontSize,
          })),
        };
      })
      .filter(Boolean);

    const scopeHint =
      scope === 'shared'
        ? 'Apply the change to every output that shares the element; set "scope":"shared".'
        : 'Apply the change only to the specified output(s); set "scope":"format-only".';

    const prompt = [
      'You revise a multi-output social-media design by emitting updateElement ops.',
      'Current outputs and elements (JSON):',
      JSON.stringify(summary),
      targetOutputs?.length ? `Target outputs (formatId): ${targetOutputs.join(', ')}` : '',
      targetSlots?.length ? `Target slots (originId): ${targetSlots.join(', ')}` : '',
      `Instruction: ${instruction}`,
      scopeHint,
      `Return ONLY a JSON array of ops. Each op is {"op":"updateElement","outputIndex":<n>,"elementId":"<existing id>","scope":"${scope}","patch":{...}}.`,
      'patch may set x, y, width, height, fontSize, text, fill, opacity. Never invent element ids or patch keys.',
    ]
      .filter(Boolean)
      .join('\n');

    let raw: string;
    try {
      // Same timeout treatment as agent dispatches — a wedged provider must
      // not hang the revise/auto-fix step indefinitely. Like the conductor's
      // race, a lost race abandons (not aborts) the underlying model call.
      raw = await this._generateWithLimits(prompt, orgId, signal);
    } catch (err) {
      this._logger.warn(
        `LLM revise failed: ${(err as Error).message}`,
        AiDesignerComposerService.name
      );
      return doc;
    }

    // repair() throws UnrepairableError when the reply is not salvageable
    // (e.g. a refusal) — that is "no valid ops", so the doc stays unchanged.
    let repaired: unknown;
    try {
      repaired = await repair(DesignerDocOpsSchema, raw);
    } catch (err) {
      this._logger.warn(
        `Revise ops unrepairable: ${(err as Error).message}`,
        AiDesignerComposerService.name
      );
      return doc;
    }
    if (repaired && Array.isArray(repaired) && repaired.length > 0) {
      try {
        return this._docService.applyOps(doc, repaired as DesignerDocOp[]);
      } catch (err) {
        this._logger.warn(
          `Revise ops failed applyOps: ${(err as Error).message}`,
          AiDesignerComposerService.name
        );
      }
    }
    return doc;
  }

  /**
   * `generateText` raced against the per-dispatch timeout (same env knob as
   * the conductor's agent dispatches) and the session's abort signal. Both
   * losses reject — the caller's catch treats them as "no valid ops".
   */
  private async _generateWithLimits(
    prompt: string,
    orgId: string,
    signal?: AbortSignal
  ): Promise<string> {
    const raw = Number(process.env.AI_DESIGNER_AGENT_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(raw) && raw > 0 ? raw : 120_000;
    return raceWithTimeout(
      this._model.generateText('agent', prompt, { orgId }),
      timeoutMs,
      { signal, label: 'LLM revise' }
    );
  }

  private _composeDeterministic(
    plan: DesignPlan,
    copy: SlotTextMap,
    assets: Record<string, AssetResult>,
    outputs: ComposerInput['outputs']
  ): DesignerDoc {
    const primaryPreset = outputs[0];
    const primaryElements = this._buildElementsForPrimary(
      plan,
      copy,
      assets,
      primaryPreset
    );

    const bg = this._backgroundToDesignerBg(plan.background);
    const primaryOutput: DesignerOutput = {
      id: '',
      formatId: primaryPreset.formatId,
      name: primaryPreset.name || primaryPreset.formatId,
      width: primaryPreset.width,
      height: primaryPreset.height,
      background: bg.background,
      bg: bg.bg,
      children: primaryElements,
    };

    const ops: DesignerDocOp[] = [
      {
        op: 'setDoc',
        doc: { mode: 'image', outputs: [primaryOutput] } as DesignerDoc,
      },
    ];

    for (let i = 1; i < outputs.length; i++) {
      ops.push({
        op: 'addOutput',
        preset: {
          formatId: outputs[i].formatId,
          name: outputs[i].name || outputs[i].formatId,
          width: outputs[i].width,
          height: outputs[i].height,
        },
      });
    }

    let doc = this._docService.applyOps(
      { mode: 'image', outputs: [] } as DesignerDoc,
      ops
    );

    const adjustOps = this._buildPerChannelAdjustments(plan, doc);
    if (adjustOps.length > 0) {
      doc = this._docService.applyOps(doc, adjustOps);
    }

    return doc;
  }

  private async _composeFromRawOps(
    rawOps: string,
    outputs: ComposerInput['outputs'],
    plan: DesignPlan,
    copy: SlotTextMap,
    assets: Record<string, AssetResult>
  ): Promise<DesignerDoc> {
    // repair() throws UnrepairableError on unsalvageable input — fall through
    // to the deterministic compose instead of aborting the whole variant.
    let repaired: unknown = null;
    try {
      repaired = await repair(DesignerDocOpsSchema, rawOps);
    } catch (err) {
      this._logger.warn(
        `Raw ops unrepairable: ${(err as Error).message}`,
        AiDesignerComposerService.name
      );
    }
    if (repaired && Array.isArray(repaired) && repaired.length > 0) {
      try {
        return this._docService.applyOps(
          { mode: 'image', outputs: [] } as DesignerDoc,
          repaired as DesignerDocOp[]
        );
      } catch (err) {
        this._logger.warn(
          `Repaired ops failed applyOps: ${(err as Error).message}`,
          AiDesignerComposerService.name
        );
      }
    }

    this._logger.warn(
      'Could not repair raw ops; falling back to deterministic compose.',
      AiDesignerComposerService.name
    );
    return this._composeDeterministic(plan, copy, assets, outputs);
  }

  private _buildFallbackDoc(
    outputs: ComposerInput['outputs'],
    plan: DesignPlan,
    copy: SlotTextMap
  ): DesignerDoc {
    const primaryPreset = outputs[0];
    const w = primaryPreset.width;
    const h = primaryPreset.height;
    const margin = Math.round(Math.min(w, h) * 0.05);
    const fontSize = Math.round(Math.min(w, h) * 0.08);

    const bg = this._backgroundToDesignerBg(plan.background);
    const text = copy[plan.slots[0]?.id] || plan.concept || 'AI Design';

    const primaryOutput: DesignerOutput = {
      id: '',
      formatId: primaryPreset.formatId,
      name: primaryPreset.name || primaryPreset.formatId,
      width: w,
      height: h,
      background: bg.background,
      bg: bg.bg,
      children: [
        {
          id: '',
          type: 'text',
          x: margin,
          y: Math.round(h * 0.4),
          width: w - margin * 2,
          height: Math.round(h * 0.2),
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          text,
          fontSize,
          fill: '#111827',
          align: 'center',
          fontWeight: 700,
          lineHeight: 1.1,
          originId: 'fallback-text',
        } as DesignerElement,
      ],
    };

    const ops: DesignerDocOp[] = [
      {
        op: 'setDoc',
        doc: { mode: 'image', outputs: [primaryOutput] } as DesignerDoc,
      },
    ];

    for (let i = 1; i < outputs.length; i++) {
      ops.push({
        op: 'addOutput',
        preset: {
          formatId: outputs[i].formatId,
          name: outputs[i].name || outputs[i].formatId,
          width: outputs[i].width,
          height: outputs[i].height,
        },
      });
    }

    return this._docService.applyOps(
      { mode: 'image', outputs: [] } as DesignerDoc,
      ops
    );
  }

  private _pickPatchKeys(
    source: Record<string, unknown>,
    keys: readonly string[],
    numericOnly?: 'number'
  ): Record<string, unknown> {
    const picked: Record<string, unknown> = {};
    for (const key of keys) {
      const value = (source as Record<string, unknown>)[key];
      if (value === undefined || value === null) continue;
      if (numericOnly === 'number') {
        if (typeof value === 'number' && Number.isFinite(value)) {
          picked[key] = value;
        }
        continue;
      }
      if (typeof value === 'string' || typeof value === 'number') {
        picked[key] = value;
      }
    }
    return picked;
  }

  private _resolveTargetOutputIndexes(
    doc: DesignerDoc,
    scope: Fix['scope'],
    formatId?: string
  ): number[] {
    if (scope === 'shared') {
      return doc.outputs.map((_, i) => i);
    }

    if (scope === 'format-only') {
      if (!formatId) {
        this._logger.warn(
          'Skipping format-only fix with missing formatId (unscoped).',
          AiDesignerComposerService.name
        );
        return [];
      }
      const idx = doc.outputs.findIndex((o) => o.formatId === formatId);
      if (idx < 0) {
        this._logger.warn(
          `Skipping format-only fix for unknown formatId "${formatId}".`,
          AiDesignerComposerService.name
        );
        return [];
      }
      return [idx];
    }

    return doc.outputs.map((_, i) => i);
  }

  private _buildElementsForPrimary(
    plan: DesignPlan,
    copy: SlotTextMap,
    assets: Record<string, AssetResult>,
    output: { width: number; height: number }
  ): DesignerElement[] {
    const w = output.width;
    const h = output.height;
    const margin = Math.round(Math.min(w, h) * 0.05);
    const safeTop = margin;
    const safeBottom = h - margin;

    const elements: DesignerElement[] = [];

    switch (plan.formatTemplate) {
      case 'top-bottom-text': {
        const imageSlot = plan.slots.find((s) => s.role === 'image');
        const topSlot = plan.slots.find((s) => s.role === 'top-caption');
        const bottomSlot = plan.slots.find((s) => s.role === 'bottom-caption');

        if (imageSlot) {
          elements.push(
            this._imageElement(imageSlot.id, assets[imageSlot.id], 0, 0, w, h)
          );
        }
        const fontSize = Math.round(Math.min(w, h) * 0.08);
        if (topSlot) {
          elements.push(
            this._textElement(
              topSlot.id,
              copy[topSlot.id] || 'Top text',
              margin,
              safeTop,
              w - margin * 2,
              fontSize * 1.5,
              fontSize,
              '#ffffff',
              true
            )
          );
        }
        if (bottomSlot) {
          elements.push(
            this._textElement(
              bottomSlot.id,
              copy[bottomSlot.id] || 'Bottom text',
              margin,
              safeBottom - fontSize * 2,
              w - margin * 2,
              fontSize * 1.5,
              fontSize,
              '#ffffff',
              true
            )
          );
        }
        break;
      }

      case 'two-panel': {
        const leftSlot = plan.slots.find((s) => s.role !== 'image');
        const imageSlot = plan.slots.find((s) => s.role === 'image');
        const panelW = Math.round((w - margin * 3) / 2);
        const panelH = h - margin * 2;
        if (leftSlot) {
          elements.push(
            this._textElement(
              leftSlot.id,
              copy[leftSlot.id] || '',
              margin,
              margin,
              panelW,
              panelH,
              Math.round(Math.min(panelW, panelH) * 0.06),
              '#111827',
              false
            )
          );
        }
        if (imageSlot) {
          elements.push(
            this._imageElement(
              imageSlot.id,
              assets[imageSlot.id],
              margin * 2 + panelW,
              margin,
              panelW,
              panelH
            )
          );
        }
        break;
      }

      case 'image-macro':
      default: {
        const imageSlot = plan.slots.find((s) => s.role === 'image');
        const textSlots = plan.slots.filter((s) => s.kind === 'text');

        if (imageSlot) {
          elements.push(
            this._imageElement(imageSlot.id, assets[imageSlot.id], 0, 0, w, h)
          );
        }

        const stackCount = textSlots.length || 1;
        const stackH = Math.round((h * 0.5) / stackCount);
        const fontSize = Math.round(Math.min(w, h) * 0.06);
        textSlots.forEach((slot, i) => {
          elements.push(
            this._textElement(
              slot.id,
              copy[slot.id] || '',
              margin,
              Math.round(h * 0.25) + i * stackH,
              w - margin * 2,
              stackH,
              fontSize,
              '#ffffff',
              true
            )
          );
        });
        break;
      }
    }

    return elements.map((el) => ({ ...el, originId: el.id }));
  }

  private _textElement(
    slotId: string,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fontSize: number,
    fill: string,
    stroke: boolean
  ): DesignerElement {
    return {
      id: '',
      type: 'text',
      x,
      y,
      width,
      height,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      text,
      fontSize,
      fill,
      align: 'center',
      fontWeight: 700,
      lineHeight: 1.1,
      textStroke: stroke
        ? { color: '#000000', width: Math.max(2, Math.round(fontSize * 0.08)) }
        : undefined,
      originId: slotId,
    } as DesignerElement;
  }

  private _imageElement(
    slotId: string,
    asset: AssetResult | undefined,
    x: number,
    y: number,
    width: number,
    height: number
  ): DesignerElement {
    return {
      id: '',
      type: 'image',
      x,
      y,
      width,
      height,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      src: asset?.path || '',
      fileId: asset?.fileId,
      fitMode: 'cover',
      originId: slotId,
    } as DesignerElement;
  }

  private _backgroundToDesignerBg(
    background: DesignPlan['background']
  ): { background: string; bg?: DesignerOutput['bg'] } {
    if (!background) return { background: '#ffffff' };
    if (background.kind === 'solid') {
      return { background: background.value || '#ffffff' };
    }
    if (background.kind === 'gradient') {
      const colors = (background.value || '#ffffff,#000000').split(',');
      return {
        background: colors[0]?.trim() || '#ffffff',
        bg: {
          type: 'gradient',
          gradient: {
            type: 'linear',
            angle: 135,
            stops: colors.map((c, i, arr) => ({
              offset: i / Math.max(1, arr.length - 1),
              color: c.trim(),
            })),
          },
        },
      };
    }
    return { background: '#ffffff' };
  }

  private _buildPerChannelAdjustments(
    plan: DesignPlan,
    doc: DesignerDoc
  ): DesignerDocOp[] {
    if (!plan.perChannel) return [];
    const ops: DesignerDocOp[] = [];
    for (let i = 0; i < doc.outputs.length; i++) {
      const out = doc.outputs[i];
      const note = plan.perChannel[out.formatId]?.note;
      if (!note) continue;
      // Only nudge text down if the note mentions a safe-zone issue.
      if (note.toLowerCase().includes('safe zone') || note.toLowerCase().includes('caption')) {
        const output = doc.outputs[i] as any;
        for (const el of output.children || []) {
          if (el.type === 'text' && el.y > out.height * 0.6) {
            ops.push({
              op: 'updateElement',
              outputIndex: i,
              elementId: el.id,
              scope: 'format-only',
              patch: { y: Math.max(20, el.y - out.height * 0.05) },
            });
          }
        }
      }
    }
    return ops;
  }
}
