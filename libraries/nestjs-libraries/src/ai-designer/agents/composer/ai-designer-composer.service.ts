import '@postmill-ai/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentResponse } from '@reaatech/agent-mesh';
import { repair } from '@reaatech/structured-repair-core';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import { AIModelProvider } from '@postmill-ai/nestjs-libraries/ai/ai-model.provider';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  DesignerTextShadow,
  DesignerTextStroke,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import {
  DesignerDocOpsSchema,
  DesignerDocOpSchema,
  type DesignerDocOp,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc-ops.schema';
import type { TextContrastViolation } from '@postmill-ai/nestjs-libraries/media/design-render/design-render.types';
import { MAX_FONT_SIZE } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import { roleFontFloorPx } from '@postmill-ai/nestjs-libraries/media/designer-doc/reflow';
import type {
  AssetAspect,
  AssetResult,
  DesignPlan,
  DesignSlot,
  Fix,
  FixAddElement,
  FixStyle,
  SlotTextMap,
  VisionFinding,
} from '../../ai-designer.types';
import { isCopySlot } from '../../ai-designer.types';
import { ASPECT_PRIORITY, aspectClass } from '../../util/aspect';
import {
  DEFAULT_STYLE_ID,
  getStylePreset,
  type AiDesignerStylePreset,
} from '../../styles';
import { raceWithTimeout } from '../../util/race-with-timeout';
import {
  isAgentInputError,
  parseAgentInput,
} from '../../util/parse-agent-input';
import { validateDesignDoc } from '../../util/doc-validator';

// Keys accepted from a Vision Critic fix's `geometry` (numeric, matching
// Fix['geometry'] and valid under the strict updateElement patch schema).
// `fontSize` is handled separately for shared scope (scaled per output).
const GEOMETRY_PATCH_KEYS = ['x', 'y', 'width', 'height', 'fontSize'] as const;

// Legibility floor for every composed fontSize. Anything under this is a
// bug (a ratio-shaped LLM hint rounds to 0 and fails strict doc validation,
// nuking the whole composition into the one-text fallback).
const MIN_FONT_SIZE_PX = 8;

// Minimum acceptable label-on-shape contrast (the WCAG large-text ratio) for
// badge/CTA accent pairs.
const MIN_CONTRAST_RATIO = 3;

// Per-role type floors as a share of min(w,h), so copy stays legible when the
// design is viewed at feed-thumbnail size (~25%): headline ≥ 6%, subhead/body
// ≥ 3.2%, badge/CTA ≥ 2.8%. Legal/fine print keeps the absolute floor.
const ROLE_FLOOR_RATIO: Record<keyof TypeScalePx, number> = {
  headline: 0.06,
  subhead: 0.032,
  cta: 0.028,
  legal: 0,
};

// ---------------------------------------------------------------------------
// Style resolution & layout gallery (Phase 2B)
// ---------------------------------------------------------------------------

// Palette convention (applies to a plan-provided palette and to the preset
// palettes alike): [0] = surface/background, [1] = primary text,
// [2] = accent, [3+] = extra accents cycled by accent shapes and badges.
type LayoutId =
  | 'hero-fullbleed'
  | 'split-panel'
  | 'top-bottom'
  | 'badge-burst'
  | 'editorial-sidebar'
  | 'minimal-centered';

// Legacy template ids from stored/v1 plans map into the gallery so older
// plans still compose.
const LAYOUT_ALIASES: Record<string, LayoutId> = {
  'top-bottom-text': 'top-bottom',
  'two-panel': 'split-panel',
  'image-macro': 'hero-fullbleed',
};

// Per-channel layout intent (plan.channelLayouts) → gallery template.
const CHANNEL_LAYOUT_TEMPLATES: Record<string, LayoutId> = {
  stacked: 'top-bottom',
  'side-by-side': 'split-panel',
  'hero-top': 'hero-fullbleed',
  'minimal-centered': 'minimal-centered',
};

// Headline baseline multiplier per template, applied to min(w,h) * 0.085.
const LAYOUT_TYPE_SCALE: Record<LayoutId, number> = {
  'hero-fullbleed': 1,
  'badge-burst': 0.95,
  'top-bottom': 0.8,
  'split-panel': 0.72,
  'editorial-sidebar': 0.72,
  'minimal-centered': 0.9,
};

// Canonical gallery template ids — skills reference these in their
// layoutHints.formatTemplates, and the registry spec validates against them.
export const LAYOUT_TEMPLATE_IDS: readonly LayoutId[] = [
  'hero-fullbleed',
  'split-panel',
  'top-bottom',
  'badge-burst',
  'editorial-sidebar',
  'minimal-centered',
];

interface ResolvedStyle {
  preset: AiDesignerStylePreset;
  palette: string[];
  surface: string;
  text: string;
  accents: string[];
  surfaceIsDark: boolean;
}

interface TypeScalePx {
  headline: number;
  subhead: number;
  cta: number;
  legal: number;
}

type SlotRole = 'headline' | 'subhead' | 'cta' | 'badge' | 'legal' | 'body';

interface ComposeContext {
  plan: DesignPlan;
  copy: SlotTextMap;
  assets: Record<string, AssetResult>;
  w: number;
  h: number;
  margin: number;
  style: ResolvedStyle;
  scale: TypeScalePx;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** WCAG relative luminance of a #rrggbb color (unparseable → light). */
const hexLuminance = (hex: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
};

/** WCAG contrast ratio between two colors (unparseable reads as light). */
const contrastRatio = (a: string, b: string): number => {
  const l1 = hexLuminance(a);
  const l2 = hexLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

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
    const { doc, usedFallback } = await this._composeTracked(payload);
    return {
      content: JSON.stringify({
        type: 'doc',
        doc,
        fallback: usedFallback || undefined,
      }),
      workflow_complete: false,
    };
  };

  // Returns the composed doc without persisting: AiDesignerSaverService is the
  // single Design writer (a createDesign here would orphan one row per variant
  // next to the saver's).
  async compose(input: ComposerInput): Promise<DesignerDoc> {
    const { doc } = await this._composeTracked(input);
    return doc;
  }

  /**
   * compose + whether the total-fallback doc shipped, so the conductor can
   * surface an honest degradation note instead of silently delivering a
   * simplified design.
   */
  private async _composeTracked(
    input: ComposerInput
  ): Promise<{ doc: DesignerDoc; usedFallback: boolean }> {
    const { plan, copy, assets, outputs, rawOps } = input;

    if (outputs.length === 0) {
      throw new Error('No outputs specified');
    }

    try {
      if (rawOps) {
        return {
          doc: this.sanitizeDoc(
            await this._composeFromRawOps(rawOps, outputs, plan, copy, assets),
            plan
          ).doc,
          usedFallback: false,
        };
      }
      return {
        doc: this.sanitizeDoc(
          this._composeDeterministic(plan, copy, assets, outputs),
          plan
        ).doc,
        usedFallback: false,
      };
    } catch (err) {
      this._logger.warn(
        `Composition failed, using fallback: ${(err as Error).message}`,
        AiDesignerComposerService.name
      );
      return {
        doc: this._buildFallbackDoc(outputs, plan, copy, assets),
        usedFallback: true,
      };
    }
  }

  /**
   * Shared deterministic QC pass: text-fit clamp + overlap guard + the doc
   * validator (canvas bounds, contrast, shape-over-text occlusion, badge
   * inner-fit, degenerate-output detection). Never throws; returns the
   * (possibly repaired) doc plus the validator's human-readable violations.
   * Used by compose/applyFixes/revise internally and by the conductor's
   * variant expansion, whose seeded outputs would otherwise get zero
   * geometric QC.
   */
  sanitizeDoc(
    doc: DesignerDoc,
    plan?: DesignPlan
  ): { doc: DesignerDoc; violations: string[] } {
    // Order matters: the validator rewrites boxes (star inner-fit, occlusion
    // reorder), so the text-fit clamp runs LAST — a validator box change
    // always gets a font refit instead of shipping stale geometry.
    const guarded = this._resolveOverlaps(this._stripImageText(doc));
    try {
      const result = validateDesignDoc(guarded, { plan });
      for (const violation of result.violations) {
        this._logger.warn(
          `Doc validator: ${violation}`,
          AiDesignerComposerService.name
        );
      }
      return {
        doc: this._clampTextToFit(result.doc),
        violations: result.violations,
      };
    } catch (err) {
      this._logger.warn(
        `Doc validator failed (degraded, doc unchanged): ${(err as Error).message}`,
        AiDesignerComposerService.name
      );
      return { doc: this._clampTextToFit(guarded), violations: [] };
    }
  }

  /**
   * Image/icon elements never carry copy — a `text` value there is a fix-loop
   * corruption (e.g. a critic marker patched onto an image) that would echo
   * back into the next critique prompt. Stripping it here heals already-saved
   * docs on their next pass through the composer.
   */
  private _stripImageText(doc: DesignerDoc): DesignerDoc {
    let changed = false;
    const outputs = doc.outputs.map((out) => {
      if (!('children' in out)) return out;
      let outChanged = false;
      const children = out.children.map((el) => {
        if ((el.type === 'image' || el.type === 'icon') && el.text !== undefined) {
          this._logger.warn(
            `Stripping stray text from ${el.type} slot "${el.originId || el.id}" — imagery carries no copy.`,
            AiDesignerComposerService.name
          );
          outChanged = true;
          const { text: _text, ...rest } = el;
          return rest as DesignerElement;
        }
        return el;
      });
      if (!outChanged) return out;
      changed = true;
      return { ...out, children };
    });
    return changed ? ({ ...doc, outputs } as DesignerDoc) : doc;
  }

  /**
   * Deterministic contrast repair for text over imagery (NO LLM). The render
   * service's `auditTextContrast` flags text whose sampled painted backdrop
   * fails the WCAG ratio for its size class. Per failing text: first flip
   * the fill to whichever of #FFFFFF/#111111 contrasts with the sampled
   * backdrop luminance; when neither passes (busy mid-luma imagery), insert
   * (or adjust) a `${originId}-scrim` shape — dark, opacity ≤ 0.55, sized to
   * the text bbox + ~0.3em padding, painted just before the text — and make
   * sure the fill reads against the scrim. One bounded pass; never throws;
   * returns the (possibly unchanged) doc plus human-readable notes for the
   * conductor's degradation trail.
   */
  fixContrast(
    doc: DesignerDoc,
    violations: TextContrastViolation[]
  ): { doc: DesignerDoc; notes: string[] } {
    const notes: string[] = [];
    if (violations.length === 0) return { doc, notes };

    const WHITE_L = 1;
    const BLACK_L = hexLuminance('#111111');
    const ops: DesignerDocOp[] = [];

    for (const violation of violations) {
      const out = doc.outputs[violation.outputIndex];
      if (!out || !('children' in out)) continue;
      const textEl = out.children.find((el) => el.id === violation.elementId);
      if (!textEl || textEl.type !== 'text') continue;
      const label = violation.originId || textEl.originId || textEl.id;
      const fontSize = textEl.fontSize || 16;
      const isLarge =
        fontSize >= 24 ||
        ((textEl.fontWeight ?? 400) >= 700 && fontSize >= 18);
      const required = isLarge ? 3 : 4.5;
      const ratioTo = (lum: number) =>
        (Math.max(lum, violation.backdropLuma) + 0.05) /
        (Math.min(lum, violation.backdropLuma) + 0.05);
      const whiteRatio = ratioTo(WHITE_L);
      const blackRatio = ratioTo(BLACK_L);
      const flipped = whiteRatio >= blackRatio ? '#FFFFFF' : '#111111';

      if (Math.max(whiteRatio, blackRatio) >= required) {
        if ((textEl.fill || '').toUpperCase() === flipped) continue;
        ops.push({
          op: 'updateElement',
          outputIndex: violation.outputIndex,
          elementId: textEl.id,
          scope: 'format-only',
          patch: { fill: flipped },
        });
        notes.push(`flipped "${label}" to ${flipped} over the imagery`);
        continue;
      }

      // Busy mid-luma backdrop: neither flat fill reads — back the text with
      // a subtle dark scrim sized to its box plus ~0.3em padding.
      const pad = Math.round(fontSize * 0.3);
      const x = Math.max(0, textEl.x - pad);
      const y = Math.max(0, textEl.y - pad);
      const width = Math.min(out.width - x, textEl.width + pad * 2);
      const height = Math.min(out.height - y, textEl.height + pad * 2);
      const scrimOriginId = `${label}-scrim`;
      const existing = out.children.find(
        (el) => el.type === 'shape' && el.originId === scrimOriginId
      );
      if (existing) {
        ops.push({
          op: 'updateElement',
          outputIndex: violation.outputIndex,
          elementId: existing.id,
          scope: 'format-only',
          patch: { x, y, width, height, opacity: 0.55 },
        });
        notes.push(`adjusted the scrim behind "${label}" over the imagery`);
      } else {
        ops.push({
          op: 'addElement',
          outputIndex: violation.outputIndex,
          beforeElementId: textEl.id,
          element: {
            type: 'shape',
            shape: 'rect',
            x,
            y,
            width,
            height,
            rotation: 0,
            opacity: 0.55,
            locked: false,
            hidden: false,
            fill: '#111111',
            originId: scrimOriginId,
          },
        } as DesignerDocOp);
        notes.push(`added a scrim behind "${label}" over the imagery`);
      }
      // The text now sits on the dark scrim — its fill must read against it.
      if (contrastRatio(textEl.fill || '#000000', '#111111') < required) {
        ops.push({
          op: 'updateElement',
          outputIndex: violation.outputIndex,
          elementId: textEl.id,
          scope: 'format-only',
          patch: { fill: '#FFFFFF' },
        });
      }
    }

    if (ops.length === 0) return { doc, notes };
    try {
      return { doc: this._docService.applyOps(doc, ops), notes };
    } catch (err) {
      this._logger.warn(
        `fixContrast could not apply its ops (doc unchanged): ${(err as Error).message}`,
        AiDesignerComposerService.name
      );
      return { doc, notes: [] };
    }
  }

  /**
   * Apply Vision Critic findings to an existing doc and return the patched doc.
   * `signal` (the session's pipeline abort) stops the freeform-note LLM
   * re-emits between calls when the user cancels. `targetOutputs` pins the
   * whole pass to specific formats (per-variant QC): every fix is forced
   * format-only onto those outputs so a single-format critique can never leak
   * shared-scope changes onto the others.
   */
  async applyFixes(
    doc: DesignerDoc,
    findings: VisionFinding[],
    orgId: string,
    signal?: AbortSignal,
    targetOutputs?: string[],
    lockedTexts?: Record<string, string>
  ): Promise<DesignerDoc> {
    const scopedFindings: VisionFinding[] = targetOutputs?.length
      ? findings.map((finding) => ({
          ...finding,
          formatId:
            finding.formatId && targetOutputs.includes(finding.formatId)
              ? finding.formatId
              : targetOutputs[0],
          fix: finding.fix
            ? { ...finding.fix, scope: 'format-only' as const }
            : undefined,
        }))
      : findings;

    const ops: DesignerDocOp[] = [];
    const noteFixes: {
      note: string;
      scope: Fix['scope'];
      formatId?: string;
      targetSlots?: string[];
    }[] = [];

    for (const finding of scopedFindings) {
      const fix = finding.fix;
      if (!fix) continue;

      // Prefer the typed path; only fall back to an LLM re-emit when the fix
      // carries a freeform `note` and no typed field can express it (plan §7.1).
      // regenerateAsset counts as typed so its note never falls into the
      // freeform LLM re-emit (which would paint the instruction onto the
      // doc) — the conductor handles regeneration; here it is a no-op.
      const hasTyped = !!(
        fix.geometry ||
        fix.style ||
        fix.text ||
        fix.regenerateAsset ||
        fix.addElement ||
        fix.removeElement
      );
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

      // Structural fixes: add a constrained text/shape element or remove an
      // element by slot/element id. Both self-scope (no slotScope needed).
      if (fix.addElement) {
        ops.push(...this._buildAddElementOps(doc, fix.addElement, targetIndexes, fix.scope));
      }
      if (fix.removeElement) {
        for (const outputIndex of targetIndexes) {
          const out = doc.outputs[outputIndex];
          if (!out || !('children' in out)) continue;
          for (const el of out.children) {
            if (el.originId === fix.removeElement || el.id === fix.removeElement) {
              // Imagery is protected from fix loops — a critic that dislikes
              // a photo must not get it deleted.
              if (el.type === 'image') {
                this._logger.warn(
                  `Refusing removeElement fix on image slot "${fix.removeElement}" — imagery is protected.`,
                  AiDesignerComposerService.name
                );
                continue;
              }
              ops.push({ op: 'removeElement', outputIndex, elementId: el.id });
            }
          }
        }
      }

      for (const outputIndex of targetIndexes) {
        const out = doc.outputs[outputIndex];
        if (!out || !('children' in out)) continue;

        const targetIds = slotScope ? new Set(slotScope) : undefined;
        // CTA/badge pairs must move as one: the button/pill shape and
        // underline bar are originId'd `${slotId}-bg` / `${slotId}-underline`
        // (the label keeps the slot id). A geometry fix scoped to the slot
        // that only patched the label would detach text from its shape — so
        // geometry targets expand to the companions. Style patches stay
        // label-only (a fill fix is about the copy, not the button).
        const geometryTargetIds = slotScope
          ? new Set(
              slotScope.flatMap((id) => [id, `${id}-bg`, `${id}-underline`])
            )
          : undefined;

        for (const el of out.children) {
          // Whitelist keys against the strict updateElement patch schema — a
          // single LLM-invented key (e.g. `color`) would otherwise zod-reject
          // the whole ops array and silently discard every valid fix.
          const patch: Partial<DesignerElement> = {};
          if (fix.geometry && geometryTargetIds?.has(el.originId || el.id)) {
            const picked = this._pickPatchKeys(fix.geometry, GEOMETRY_PATCH_KEYS, 'number');
            // The fix box is authored for the LABEL. Writing it verbatim to
            // the `-bg`/`-underline` companions collapses the label/shape
            // inset (pill box === label box, byte-identical) — a companion
            // gets a box re-derived from the label's patched box instead.
            const companionOf = slotScope?.find(
              (id) =>
                (el.originId || el.id) === `${id}-bg` ||
                (el.originId || el.id) === `${id}-underline`
            );
            Object.assign(
              patch,
              companionOf
                ? this._deriveCompanionGeometry(out, el, companionOf, picked)
                : picked
            );
          }
          if (fix.style && targetIds?.has(el.originId || el.id)) {
            Object.assign(patch, this._stylePatch(fix.style, el));
          }
          if (fix.text && (el.originId === fix.text.slotId || el.id === fix.text.slotId)) {
            // Imagery never carries copy — a critic that wants different
            // imagery must use regenerateAsset, and a text "fix" here would
            // bake a marker string into the doc (and echo it back into the
            // next critique prompt).
            if (el.type === 'image' || el.type === 'icon') {
              this._logger.warn(
                `Refusing text fix on ${el.type} slot "${fix.text.slotId}" — imagery is protected.`,
                AiDesignerComposerService.name
              );
            } else {
              // Locked copy (the plan texts the user approved) always wins over
              // a critic rewrite; geometry/style halves of the fix still apply.
              const locked = lockedTexts?.[fix.text.slotId];
              if (locked !== undefined) {
                if (locked !== fix.text.newText) {
                  this._logger.log(
                    `Locked copy for slot "${fix.text.slotId}" kept over the critic's rewrite.`,
                    AiDesignerComposerService.name
                  );
                }
                patch.text = locked;
              } else {
                patch.text = fix.text.newText;
              }
            }
          }

          // Imagery is protected from fix loops: never let a fix hide an
          // image slot or fade it to nothing.
          if (
            el.type === 'image' &&
            (patch.hidden === true || patch.opacity === 0)
          ) {
            this._logger.warn(
              `Refusing to hide/zero-out image slot "${el.originId || el.id}" — imagery is protected.`,
              AiDesignerComposerService.name
            );
            delete patch.hidden;
            delete patch.opacity;
          }

          // Shared-scope fontSize: the px value is authored against the
          // primary output, so each other output gets it scaled by its own
          // scale relative to the primary (the linked-propagation path in
          // applyLinked does the same for direct shared ops). The scaled
          // value rides a format-only op — a shared op would propagate and
          // overwrite the other outputs' scaled values.
          if (
            fix.scope === 'shared' &&
            typeof patch.fontSize === 'number' &&
            doc.outputs.length > 1
          ) {
            delete patch.fontSize;
            const scaled = this._scaleFontSizeToOutput(
              fix.geometry?.fontSize as number,
              doc,
              out
            );
            ops.push({
              op: 'updateElement',
              outputIndex,
              elementId: el.id,
              scope: 'format-only',
              patch: { fontSize: scaled },
            });
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
        signal,
        lockedTexts
      );
    }

    return this.sanitizeDoc(next).doc;
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
    signal?: AbortSignal,
    lockedTexts?: Record<string, string>
  ): Promise<DesignerDoc> {
    const revised = await this._llmReviseOps(
      doc,
      instruction,
      scope,
      orgId,
      targetOutputs,
      targetSlots,
      signal,
      lockedTexts
    );
    return this.sanitizeDoc(revised).doc;
  }

  /**
   * One-line background description for the revise prompt's doc summary, so
   * the model can see (and target) each output's current background instead
   * of guessing.
   */
  private _describeBackground(out: DesignerOutput): string {
    const bg = out.bg;
    if (!bg) return `color ${out.background}`;
    if (bg.type === 'image') return 'image';
    if (bg.type === 'gradient') {
      const stops = bg.gradient?.stops?.map((s) => s.color).join(' → ');
      return stops ? `gradient ${stops}` : 'gradient';
    }
    return `color ${bg.color ?? out.background}`;
  }

  /**
   * Conservative text-overflow clamp after a revise/auto-fix pass: the
   * renderer's own shrink-to-fit (`fitFlatText`) is canvas-bound, so this
   * estimates the wrapped line count (≈0.55 × fontSize average glyph
   * advance) and steps fontSize down 10% at a time until the block fits its
   * element height. The floor is the ABSOLUTE role floor shared with
   * `smartReflow` — the old relative floor (60% of the current size)
   * ratcheted down across repeated passes (35→21→13→12px). When the floor is
   * reached and the text still overflows, the box GROWS (bounded by the
   * canvas) instead of the type shrinking below legibility. Returns the SAME
   * doc reference when nothing needed clamping.
   */
  private _clampTextToFit(doc: DesignerDoc): DesignerDoc {
    let clamped = false;
    const outputs = doc.outputs.map((out) => {
      if (!('children' in out)) return out;
      const children = out.children.map((el) => {
        if (el.type !== 'text' || el.richText?.length || !el.text) return el;
        const fontSize = el.fontSize || 16;
        if (!(el.width > 0) || !(el.height > 0)) return el;
        const lineHeightFactor = el.lineHeight || 1.2;
        const floor = roleFontFloorPx(el, out.width, out.height);
        let size = fontSize;
        let lines = this._estimateWrappedLines(el.text, el.width, size);
        while (size > floor && lines * lineHeightFactor * size > el.height) {
          size = Math.max(floor, Math.floor(size * 0.9));
          lines = this._estimateWrappedLines(el.text, el.width, size);
        }
        let height = el.height;
        if (lines * lineHeightFactor * size > height) {
          // Floor reached and the wrapped block still overflows — grow the
          // box toward the canvas bottom rather than shipping illegible type.
          const needed = Math.ceil(lines * lineHeightFactor * size);
          height = Math.min(needed, Math.max(el.height, out.height - el.y));
        }
        if (size >= fontSize && height === el.height) return el;
        clamped = true;
        this._logger.log(
          `Font-size clamp: element ${el.id} ("${el.text.slice(0, 40)}") ${fontSize}px → ${size}px (box ${el.height}px → ${height}px) to fit its box`,
          AiDesignerComposerService.name
        );
        return { ...el, fontSize: size, height };
      });
      return clamped ? { ...out, children } : out;
    });
    return clamped ? ({ ...doc, outputs } as DesignerDoc) : doc;
  }

  /**
   * Estimated word-wrap line count for a flat text at `fontSize` inside
   * `width` px — deliberately pessimistic (0.55 × fontSize per glyph) so the
   * clamp errs on the small side rather than letting text overflow.
   */
  private _estimateWrappedLines(
    text: string,
    width: number,
    fontSize: number
  ): number {
    const maxChars = Math.max(1, Math.floor(width / (fontSize * 0.55)));
    let lines = 1;
    let current = 0;
    for (const word of text.split(/\s+/)) {
      const wordLen = Math.max(1, word.length);
      if (current > 0 && current + 1 + wordLen > maxChars) {
        lines++;
        current = 0;
      }
      current = current > 0 ? current + 1 + wordLen : wordLen;
      // A single word longer than the line hard-wraps mid-word.
      while (current > maxChars) {
        lines++;
        current -= maxChars;
      }
    }
    return lines;
  }

  /**
   * Deterministic post-pass overlap guard, applied after compose and after
   * applyFixes/revise: (1) text spilling outside its containing shape (the
   * `${slotId}-bg` companion) is re-clamped inside and shrunk to fit, (2)
   * text running off the left/right canvas edge is pulled back on-canvas
   * (shrinking the box when it is wider than the canvas), (3) text-on-text
   * and badge/CTA-shape-on-text AABB collisions are separated by nudging the
   * later element below the earlier one. Anything it cannot resolve is
   * logged as a degradation note — it NEVER throws, and returns the SAME doc
   * reference when nothing needed fixing.
   */
  private _resolveOverlaps(doc: DesignerDoc): DesignerDoc {
    try {
      let changed = false;
      const outputs = doc.outputs.map((out) => {
        if (!('children' in out)) return out;
        let children: DesignerElement[] | null = null;
        const replace = (index: number, el: DesignerElement) => {
          if (!children) children = [...out.children];
          children[index] = el;
          changed = true;
        };

        const shapesByOrigin = new Map<string, DesignerElement>();
        for (const el of out.children) {
          if (el.type === 'shape' && el.originId?.endsWith('-bg')) {
            shapesByOrigin.set(el.originId, el);
          }
        }

        const currentAt = (index: number): DesignerElement =>
          children ? children[index] : out.children[index];
        // Deferred z-order fixes (the no-room last resort): the collider is
        // re-inserted right AFTER the group so it paints on top — applied
        // once the pass is done moving things around.
        const reorders: { colliderId: string; afterIds: string[] }[] = [];

        const placed: { index: number; el: DesignerElement }[] = [];
        for (let i = 0; i < out.children.length; i++) {
          const el = currentAt(i);
          if (el.type !== 'text' || !el.text || el.rotation) {
            placed.push({ index: i, el });
            continue;
          }
          let next = el;

          // (1) Text spilling outside its containing shape: clamp the box
          // back inside and shrink the font until the estimated wrap fits.
          const shape = el.originId
            ? shapesByOrigin.get(`${el.originId}-bg`)
            : undefined;
          if (shape && !this._boxInside(el, shape)) {
            const insetX = Math.max(2, Math.round(shape.width * 0.04));
            const insetY = Math.max(2, Math.round(shape.height * 0.04));
            const inner = {
              x: shape.x + insetX,
              y: shape.y + insetY,
              width: Math.max(10, shape.width - insetX * 2),
              height: Math.max(10, shape.height - insetY * 2),
            };
            const fontSize = next.fontSize || 16;
            // Absolute role floor (shared with smartReflow) — the old
            // relative 60% floor ratcheted across repeated passes.
            const floor = roleFontFloorPx(next, out.width, out.height);
            let size = fontSize;
            const lineHeightFactor = next.lineHeight || 1.2;
            let lines = this._estimateWrappedLines(next.text, inner.width, size);
            while (size > floor && lines * lineHeightFactor * size > inner.height) {
              size = Math.max(floor, Math.floor(size * 0.9));
              lines = this._estimateWrappedLines(next.text, inner.width, size);
            }
            this._logger.warn(
              `Overlap guard: text "${next.text.slice(0, 40)}" spilled outside its shape ${shape.originId} — clamped inside (${fontSize}px → ${size}px).`,
              AiDesignerComposerService.name
            );
            next = { ...next, ...inner, fontSize: size };
            replace(i, next);
          }

          // (2) Canvas-edge clamp (x/width): text hanging off the left or
          // right edge is pulled back on-canvas; a box wider than the canvas
          // is shrunk to fit (the collision pass below owns the bottom edge).
          if (next.x < 0 || next.x + next.width > out.width) {
            const width = Math.max(10, Math.min(next.width, out.width));
            const x = Math.max(0, Math.min(next.x, out.width - width));
            if (x !== next.x || width !== next.width) {
              this._logger.warn(
                `Overlap guard: text "${next.text.slice(0, 40)}" ran off the canvas edge — clamped x/width ${next.x}/${next.width} → ${x}/${width}.`,
                AiDesignerComposerService.name
              );
              next = { ...next, x, width };
              replace(i, next);
            }
          }

          // (3) Collision pass: text-on-text, plus badge/CTA `*-bg` shapes
          // covering a text outside their own group (a starburst over the
          // headline). The moving unit is the text's whole GROUP — the label
          // and its `${slotId}-bg` / `${slotId}-underline` companions (shared
          // groupId, or the companion originId convention) translate by the
          // same delta, so a nudge never rips a label out of its pill.
          // Placement: below the collider's group first, above it when there
          // is no room below; when neither fits a TEXT collider, the group is
          // reordered to paint behind the collider instead of overlapping.
          // Near-touching pairs (gap under ~8px at a 1080×1080 canvas,
          // scaled by the geometric mean of the canvas sides — min(w,h)
          // collapsed to 5px on 1200×675 landscapes) between unrelated
          // elements count as collisions so groups keep breathing room.
          const minGap = Math.max(
            2,
            Math.round((Math.sqrt(out.width * out.height) / 1080) * 8)
          );
          const nextKey = this._groupKeyOf(next);
          const groupIndexes: number[] = [];
          for (let m = 0; m < out.children.length; m++) {
            if (m === i || (nextKey && this._groupKeyOf(currentAt(m)) === nextKey)) {
              groupIndexes.push(m);
            }
          }
          const groupBox = () => {
            let gx = Infinity;
            let gy = Infinity;
            let gr = -Infinity;
            let gb = -Infinity;
            for (const m of groupIndexes) {
              const member = m === i ? next : currentAt(m);
              gx = Math.min(gx, member.x);
              gy = Math.min(gy, member.y);
              gr = Math.max(gr, member.x + member.width);
              gb = Math.max(gb, member.y + member.height);
            }
            return { x: gx, y: gy, width: gr - gx, height: gb - gy };
          };
          const moveGroup = (deltaY: number) => {
            for (const m of groupIndexes) {
              if (m === i) continue;
              const member = currentAt(m);
              const moved = { ...member, y: member.y + deltaY };
              replace(m, moved);
              const p = placed.findIndex((entry) => entry.index === m);
              if (p >= 0) placed[p].el = moved;
            }
          };

          for (const entry of placed) {
            const other = entry.el;
            // Own-group members (the pill under its label) never collide.
            if (nextKey && this._groupKeyOf(other) === nextKey) continue;
            const isTextCollider =
              other.type === 'text' && !!other.text && !other.rotation;
            // A `*-bg` shape collides only when it is a small accent (badge
            // burst, CTA pill) covering a text that is NOT in its group —
            // big background panels (split-panel-bg) are backdrops the copy
            // intentionally sits on, not collisions.
            const isShapeCollider =
              other.type === 'shape' &&
              !!other.originId?.endsWith('-bg') &&
              other.width * other.height < out.width * out.height * 0.25;
            if (!isTextCollider && !isShapeCollider) continue;

            // The collider's own group extent — a label's pill may extend
            // below it, so "below the collider" means below the whole unit.
            const otherKey = this._groupKeyOf(other);
            let colliderTop = other.y;
            let colliderBottom = other.y + other.height;
            if (otherKey) {
              for (const peer of placed) {
                if (this._groupKeyOf(peer.el) !== otherKey) continue;
                colliderTop = Math.min(colliderTop, peer.el.y);
                colliderBottom = Math.max(
                  colliderBottom,
                  peer.el.y + peer.el.height
                );
              }
            }

            let hit = this._boxesOverlap(next, other);
            if (!hit) {
              // Near-touch: boxes separated by less than the minimum gap.
              const dx = Math.max(
                other.x - (next.x + next.width),
                next.x - (other.x + other.width),
                0
              );
              const dy = Math.max(
                other.y - (next.y + next.height),
                next.y - (other.y + other.height),
                0
              );
              hit = dx < minGap && dy < minGap && (dx > 0 || dy > 0);
            }
            if (!hit) continue;

            const otherLabel =
              other.type === 'text'
                ? `"${(other.text as string).slice(0, 40)}"`
                : `shape "${other.originId || other.id}"`;
            // +2px so a nudged element rests ABOVE the near-touch floor
            // instead of landing exactly on it.
            const gap =
              Math.max(minGap, Math.round((next.fontSize || 16) * 0.2)) + 2;
            const box = groupBox();
            const belowDelta = colliderBottom + gap - box.y;
            if (box.y + box.height + belowDelta <= out.height) {
              this._logger.warn(
                `Overlap guard: text "${next.text.slice(0, 40)}" overlapped ${otherLabel} — nudged its group down by ${belowDelta}px.`,
                AiDesignerComposerService.name
              );
              moveGroup(belowDelta);
              next = { ...next, y: next.y + belowDelta };
              replace(i, next);
              continue;
            }
            const aboveDelta = colliderTop - gap - (box.y + box.height);
            if (box.y + aboveDelta >= 0) {
              this._logger.warn(
                `Overlap guard: text "${next.text.slice(0, 40)}" overlapped ${otherLabel} with no room below — moved its group above it.`,
                AiDesignerComposerService.name
              );
              moveGroup(aboveDelta);
              next = { ...next, y: next.y + aboveDelta };
              replace(i, next);
              continue;
            }
            if (isTextCollider) {
              // Last resort: keep the geometry, fix the paint order — the
              // group goes behind the colliding text so at least one of them
              // reads cleanly.
              this._logger.warn(
                `Overlap guard: collision between text "${next.text.slice(0, 40)}" and ${otherLabel} has no canvas room — reordered the group behind it.`,
                AiDesignerComposerService.name
              );
              reorders.push({
                colliderId: other.id,
                afterIds: groupIndexes.map((m) => currentAt(m).id),
              });
              break;
            }
            this._logger.warn(
              `Overlap guard: collision between text "${next.text.slice(0, 40)}" and ${otherLabel} left unresolved (no canvas room).`,
              AiDesignerComposerService.name
            );
          }

          placed.push({ index: i, el: next });
        }

        // Apply the deferred z-order fixes: re-insert each collider right
        // after the last group member so it paints on top of the group.
        if (reorders.length > 0) {
          if (!children) children = [...out.children];
          for (const reorder of reorders) {
            const from = children.findIndex((c) => c.id === reorder.colliderId);
            if (from < 0) continue;
            const [collider] = children.splice(from, 1);
            let lastGroupIndex = -1;
            for (const id of reorder.afterIds) {
              lastGroupIndex = Math.max(
                lastGroupIndex,
                children.findIndex((c) => c.id === id)
              );
            }
            children.splice(
              lastGroupIndex >= 0 ? lastGroupIndex + 1 : children.length,
              0,
              collider
            );
            changed = true;
          }
        }

        // (4) Label re-center: reflow clamps and collision nudges can leave
        // a label flush against (or drifted inside) its `${slotId}-bg`
        // shape. Re-center each visible label horizontally in its shape's
        // CURRENT box — vertically too for middle-aligned labels and star
        // bursts. Only the label moves, never the shape.
        {
          const current: DesignerElement[] = children ?? out.children;
          for (let i = 0; i < current.length; i++) {
            const el = current[i];
            if (el.type !== 'text' || !el.text || el.hidden || el.rotation) {
              continue;
            }
            if (!el.originId || !shapesByOrigin.has(`${el.originId}-bg`)) {
              continue;
            }
            const shape = current.find(
              (c) => c.type === 'shape' && c.originId === `${el.originId}-bg`
            );
            if (!shape) continue;
            const x = shape.x + Math.round((shape.width - el.width) / 2);
            const y =
              el.verticalAlign === 'middle' || shape.shape === 'star'
                ? shape.y + Math.round((shape.height - el.height) / 2)
                : el.y;
            if (x === el.x && y === el.y) continue;
            replace(i, { ...el, x, y });
          }
        }

        return children ? ({ ...out, children } as DesignerOutput) : out;
      });
      return changed ? ({ ...doc, outputs } as DesignerDoc) : doc;
    } catch (err) {
      this._logger.warn(
        `Overlap guard failed (degraded, doc unchanged): ${(err as Error).message}`,
        AiDesignerComposerService.name
      );
      return doc;
    }
  }

  private _boxInside(el: DesignerElement, shape: DesignerElement): boolean {
    return (
      el.x >= shape.x - 1 &&
      el.y >= shape.y - 1 &&
      el.x + el.width <= shape.x + shape.width + 1 &&
      el.y + el.height <= shape.y + shape.height + 1
    );
  }

  private _boxesOverlap(a: DesignerElement, b: DesignerElement): boolean {
    return (
      a.x < b.x + b.width - 2 &&
      a.x + a.width > b.x + 2 &&
      a.y < b.y + b.height - 2 &&
      a.y + a.height > b.y + 2
    );
  }

  /**
   * The move/relationship unit of an element: its explicit groupId, or the
   * slot id it shares with its `${slotId}-bg` / `${slotId}-underline`
   * companions. Ungrouped elements key on their own originId — a group of
   * one. Elements with neither return undefined (no group semantics).
   */
  private _groupKeyOf(el: DesignerElement): string | undefined {
    if (el.groupId) return el.groupId;
    const origin = el.originId;
    if (!origin) return undefined;
    if (origin.endsWith('-bg')) return origin.slice(0, -'-bg'.length);
    if (origin.endsWith('-underline')) {
      return origin.slice(0, -'-underline'.length);
    }
    return origin;
  }

  private async _llmReviseOps(
    doc: DesignerDoc,
    instruction: string,
    scope: Fix['scope'],
    orgId: string,
    targetOutputs?: string[],
    targetSlots?: string[],
    signal?: AbortSignal,
    lockedTexts?: Record<string, string>
  ): Promise<DesignerDoc> {
    const summary = doc.outputs
      .map((out, outputIndex) => {
        if (!('children' in out)) return null;
        return {
          outputIndex,
          formatId: out.formatId,
          width: out.width,
          height: out.height,
          background: this._describeBackground(out),
          elements: out.children.map((el) => ({
            elementId: el.id,
            originId: el.originId,
            type: el.type,
            text: (el as { text?: string }).text,
            fill: (el as { fill?: string }).fill,
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
      'You revise a multi-output social-media design by emitting ops against the current doc.',
      'Current outputs and elements (JSON):',
      JSON.stringify(summary),
      targetOutputs?.length ? `Target outputs (formatId): ${targetOutputs.join(', ')}` : '',
      targetSlots?.length ? `Target slots (originId): ${targetSlots.join(', ')}` : '',
      `Instruction: ${instruction}`,
      scopeHint,
      `Return ONLY a JSON array of ops. Each op is {"op":"updateElement","outputIndex":<n>,"elementId":"<existing id>","scope":"${scope}","patch":{...}}.`,
      'patch may set x, y, width, height, fontSize, text, fill, opacity, fontFamily, align, verticalAlign, textStroke ({color,width}), textShadow ({color,blur,offsetX,offsetY}). Never invent element ids or patch keys.',
      'You may also emit {"op":"addElement","outputIndex":<n>,"element":{...}} with a constrained text or shape element (type, x, y, width, height, rotation: 0, opacity: 1, locked: false, hidden: false, plus text/shape, fontSize, fill, align, textStroke, textShadow, originId), or {"op":"removeElement","outputIndex":<n>,"elementId":"<existing id>"} to delete an element. Decorative shapes and scrims MUST go behind the copy: set "beforeElementId" to the output\'s first text element id and keep them subtle (opacity ≤ 0.6).',
      'To change an output\'s background, emit {"op":"setOutputBackground","outputIndex":<n>,"background":{"type":"color","color":"#rrggbb"}} — or {"type":"gradient","gradient":{"type":"linear","angle":<deg>,"stops":[{"color":"#rrggbb","offset":0},{"color":"#rrggbb","offset":1}]}}. Use it when the instruction asks for a background color or gradient. Never use it on an output whose background is an image — image backgrounds are protected.',
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
      const filtered = this._filterReviseOps(
        doc,
        repaired as DesignerDocOp[],
        targetOutputs,
        lockedTexts
      );
      if (filtered.length > 0) {
        try {
          return this._docService.applyOps(doc, filtered);
        } catch (err) {
          this._logger.warn(
            `Revise ops failed applyOps: ${(err as Error).message}`,
            AiDesignerComposerService.name
          );
        }
      }
    }
    return doc;
  }

  /**
   * Fail-closed screening of LLM-emitted revise ops before they touch the
   * doc: ops must stay inside the requested targetOutputs scope, image slots
   * and image backgrounds are protected from deletion/hiding/replacement,
   * and locked copy (user-approved plan texts) always wins over an LLM
   * rewrite.
   */
  private _filterReviseOps(
    doc: DesignerDoc,
    ops: DesignerDocOp[],
    targetOutputs?: string[],
    lockedTexts?: Record<string, string>
  ): DesignerDocOp[] {
    const findElement = (outputIndex: number, elementId: string) => {
      const out = doc.outputs[outputIndex];
      if (!out || !('children' in out)) return undefined;
      return out.children.find((el) => el.id === elementId);
    };
    const allowedIndexes = targetOutputs?.length
      ? new Set(
          targetOutputs
            .map((formatId) =>
              doc.outputs.findIndex((out) => out.formatId === formatId)
            )
            .filter((i) => i >= 0)
        )
      : undefined;

    const filtered: DesignerDocOp[] = [];
    for (const op of ops) {
      if (
        'outputIndex' in op &&
        allowedIndexes &&
        !allowedIndexes.has(op.outputIndex as number)
      ) {
        this._logger.warn(
          `Dropping revise op ${op.op} for outputIndex ${op.outputIndex} — outside the requested targetOutputs scope.`,
          AiDesignerComposerService.name
        );
        continue;
      }

      if (op.op === 'setOutputBackground') {
        const out = doc.outputs[op.outputIndex];
        if (out && 'children' in out && out.bg?.type === 'image') {
          this._logger.warn(
            `Dropping setOutputBackground for outputIndex ${op.outputIndex} — the image background is protected.`,
            AiDesignerComposerService.name
          );
          continue;
        }
      }

      if (op.op === 'removeElement') {
        const el = findElement(op.outputIndex, op.elementId);
        if (el?.type === 'image') {
          this._logger.warn(
            `Dropping removeElement on image slot "${el.originId || el.id}" — imagery is protected.`,
            AiDesignerComposerService.name
          );
          continue;
        }
      }

      if (op.op === 'updateElement') {
        const el = findElement(op.outputIndex, op.elementId);
        const patch = { ...(op.patch as Partial<DesignerElement>) };
        if (el?.type === 'image' && (patch.hidden === true || patch.opacity === 0)) {
          this._logger.warn(
            `Refusing to hide/zero-out image slot "${el.originId || el.id}" — imagery is protected.`,
            AiDesignerComposerService.name
          );
          delete patch.hidden;
          delete patch.opacity;
        }
        // Imagery carries no copy and its source is not LLM-replaceable:
        // text on an image would ship a baked-in marker string, and a
        // src/fileId swap must go through the conductor's deterministic
        // regeneration path, never an LLM op.
        if (
          (el?.type === 'image' || el?.type === 'icon') &&
          (patch.text !== undefined ||
            patch.src !== undefined ||
            patch.fileId !== undefined)
        ) {
          this._logger.warn(
            `Dropping text/src/fileId patch on ${el.type} slot "${el.originId || el.id}" — imagery is protected.`,
            AiDesignerComposerService.name
          );
          delete patch.text;
          delete patch.src;
          delete patch.fileId;
        }
        if (el && lockedTexts && typeof patch.text === 'string') {
          const locked =
            (el.originId ? lockedTexts[el.originId] : undefined) ??
            lockedTexts[el.id];
          if (locked !== undefined) {
            if (locked !== patch.text) {
              this._logger.log(
                `Locked copy for slot "${el.originId || el.id}" kept over the LLM rewrite.`,
                AiDesignerComposerService.name
              );
            }
            patch.text = locked;
          }
        }
        if (Object.keys(patch).length === 0) continue;
        filtered.push({ ...op, patch } as DesignerDocOp);
        continue;
      }

      if (op.op === 'addElement') {
        const out = doc.outputs[op.outputIndex];
        if (!out || !('children' in out)) continue;
        const element = { ...(op.element as DesignerElement) };
        if (element.type === 'shape') {
          // Scrim discipline for LLM-added shapes: they paint BEHIND the copy
          // (inserted before the first visible text), stay subtle (opacity
          // capped at 0.6), and their box is clamped to the canvas.
          const firstText = out.children.find(
            (c) =>
              c.type === 'text' &&
              !c.hidden &&
              typeof c.text === 'string' &&
              c.text.trim().length > 0
          );
          element.opacity = Math.min(element.opacity ?? 1, 0.6);
          element.width = Math.min(element.width, out.width);
          element.height = Math.min(element.height, out.height);
          element.x = Math.min(
            Math.max(element.x, 0),
            Math.max(0, out.width - element.width)
          );
          element.y = Math.min(
            Math.max(element.y, 0),
            Math.max(0, out.height - element.height)
          );
          filtered.push({
            ...op,
            element,
            ...(firstText ? { beforeElementId: firstText.id } : {}),
          } as DesignerDocOp);
          continue;
        }
      }

      filtered.push(op);
    }
    return filtered;
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
    const style = this._resolveStyle(plan);
    const layout = this._resolveTemplate(plan);
    const primaryPreset = outputs[0];
    const primaryElements = this._buildElements(
      plan,
      copy,
      assets,
      primaryPreset,
      layout,
      style
    );

    const bg = this._backgroundToDesignerBg(
      plan.background,
      assets,
      primaryPreset,
      plan.variantId
    );
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

    // Single-format compose (the pipeline's one-original flow passes exactly
    // one output): no addOutput ops above, and `_applyChannelLayouts` is a
    // no-op (it only iterates secondary outputs). `_buildPerChannelAdjustments`
    // is inert for new plans — the art director no longer emits `perChannel`;
    // it only still honors notes carried by older stored plans.
    doc = this._applyChannelLayouts(plan, copy, assets, outputs, style, doc);
    doc = this._dropBackgroundDuplicateImages(doc);

    const adjustOps = this._buildPerChannelAdjustments(plan, doc);
    if (adjustOps.length > 0) {
      doc = this._docService.applyOps(doc, adjustOps);
    }

    return doc;
  }

  /**
   * Per-channel layout intent (plan §channelLayouts): when the plan names a
   * layout for a secondary output's formatId, that output is composed fresh
   * with the mapped template instead of keeping the seeded primary reflow.
   * Elements are composed with the same originIds as the primary output so
   * shared-scope fixes still link across outputs.
   */
  private _applyChannelLayouts(
    plan: DesignPlan,
    copy: SlotTextMap,
    assets: Record<string, AssetResult>,
    outputs: ComposerInput['outputs'],
    style: ResolvedStyle,
    doc: DesignerDoc
  ): DesignerDoc {
    if (!plan.channelLayouts) return doc;
    let next = doc;
    for (let i = 1; i < outputs.length; i++) {
      const intent = plan.channelLayouts[outputs[i].formatId];
      if (!intent) continue;
      const template = CHANNEL_LAYOUT_TEMPLATES[intent];
      if (!template) continue;
      const out = next.outputs[i];
      if (!out || !('children' in out)) continue;
      const children = this._buildElements(
        plan,
        copy,
        assets,
        outputs[i],
        template,
        style,
        { heroTop: intent === 'hero-top' }
      ).map((el) => ({ ...el, id: randomUUID() }));
      next = {
        ...next,
        outputs: next.outputs.map((o, idx) =>
          idx === i ? { ...o, children } : o
        ),
      } as DesignerDoc;
    }
    return next;
  }

  /**
   * Same-asset dedupe: an image background already carries its subject
   * full-bleed. An image element resolving to the SAME asset (the art
   * director sometimes plans both `background.ref: 'asset:<slot>'` and an
   * image slot for one subject) is always a duplicate — drop it. A slot on a
   * DIFFERENT asset is untouched. Variants seeded from the original inherit
   * this via the addOutput copy — no per-output re-resolution happens here.
   */
  private _dropBackgroundDuplicateImages(doc: DesignerDoc): DesignerDoc {
    const outputs = doc.outputs.map((out) => {
      if (!('children' in out)) return out;
      const bgImage = out.bg?.type === 'image' ? out.bg : undefined;
      if (!bgImage) return out;
      const children = out.children.filter((el) => {
        if (el.type !== 'image') return true;
        const sameAsset =
          (!!el.fileId && !!bgImage.fileId && el.fileId === bgImage.fileId) ||
          (!!el.src && !!bgImage.src && el.src === bgImage.src);
        if (!sameAsset) return true;
        this._logger.log(
          `Dropping image element "${el.originId || el.id}" on output "${out.formatId}" — same asset as the image background.`,
          AiDesignerComposerService.name
        );
        return false;
      });
      return children.length === out.children.length ? out : { ...out, children };
    });

    return { ...doc, outputs } as DesignerDoc;
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
    copy: SlotTextMap,
    assets: Record<string, AssetResult>
  ): DesignerDoc {
    const primaryPreset = outputs[0];
    const w = primaryPreset.width;
    const h = primaryPreset.height;
    const margin = Math.round(Math.min(w, h) * 0.05);
    const fontSize = Math.max(MIN_FONT_SIZE_PX, Math.round(Math.min(w, h) * 0.08));

    // The fallback is triggered by a copy/layout failure — assets that DID
    // generate still resolve here (same variant-scoped → slotId:aspect →
    // slotId → any-aspect lookup as the primary compose), so a copy-side
    // failure doesn't also lose the imagery.
    const bg = this._backgroundToDesignerBg(
      plan.background,
      assets,
      primaryPreset,
      plan.variantId
    );
    // Reuse the slot-text resolution (fuzzy copy match, role-appropriate
    // generic line, 60-char concept truncation) — never dump the raw concept.
    const firstSlot = plan.slots[0];
    const text =
      (firstSlot ? this._slotText(copy, firstSlot, plan, 0) : '') || 'AI Design';

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
          fontFamily: getStylePreset(DEFAULT_STYLE_ID)?.fonts.display,
          // Contrast-aware pick against the resolved background — the
          // hardcoded near-black was invisible on the dark fallback
          // background (the solid-navy dead output).
          fill: this._contrastOn(bg.background, this._resolveStyle(plan)),
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

  /**
   * Whitelisted style half of a fix patch. Same fail-closed rule as
   * `_pickPatchKeys`: anything off-shape is dropped so one bad key can't
   * zod-reject the whole ops array. `textShadow: false` keeps the key with an
   * undefined value — the strict patch schema allows it (optional) and the
   * spread in applyLinked clears the field.
   */
  private _stylePatch(style: FixStyle, el: DesignerElement): Partial<DesignerElement> {
    const patch: Partial<DesignerElement> = {};
    if (typeof style.fill === 'string') patch.fill = style.fill;
    if (typeof style.stroke === 'string') patch.stroke = style.stroke;
    if (typeof style.opacity === 'number' && Number.isFinite(style.opacity)) {
      patch.opacity = Math.max(0, Math.min(1, style.opacity));
    }
    if (typeof style.fontFamily === 'string' && style.fontFamily.trim()) {
      patch.fontFamily = style.fontFamily;
    }
    if (style.align === 'left' || style.align === 'center' || style.align === 'right') {
      patch.align = style.align;
    }
    if (
      style.verticalAlign === 'top' ||
      style.verticalAlign === 'middle' ||
      style.verticalAlign === 'bottom'
    ) {
      patch.verticalAlign = style.verticalAlign;
    }
    if (
      style.textStroke &&
      typeof style.textStroke.color === 'string' &&
      typeof style.textStroke.width === 'number' &&
      Number.isFinite(style.textStroke.width)
    ) {
      patch.textStroke = {
        color: style.textStroke.color,
        width: style.textStroke.width,
      };
    }
    if (style.textShadow === true) {
      patch.textShadow = this._defaultShadow(
        typeof el.fontSize === 'number' ? el.fontSize : 32
      );
    } else if (style.textShadow === false) {
      patch.textShadow = undefined;
    }
    return patch;
  }

  /** Default drop shadow for `textShadow: true` fixes (mirrors the light-surface preset shadow). */
  private _defaultShadow(fontSize: number): DesignerTextShadow {
    return {
      color: 'rgba(0,0,0,0.4)',
      blur: Math.round(fontSize * 0.12),
      offsetX: Math.round(fontSize * 0.04),
      offsetY: Math.round(fontSize * 0.06),
    };
  }

  /**
   * Scale a primary-output px value to another output (same uniform-scale
   * rule as smartReflow / applyLinked), floored at 10px.
   */
  private _scaleFontSizeToOutput(
    fontSize: number,
    doc: DesignerDoc,
    out: DesignerOutput
  ): number {
    const primary = doc.outputs[0];
    if (!primary || primary === out) return fontSize;
    const scale = Math.min(
      out.width / primary.width,
      out.height / primary.height
    );
    return Math.max(10, Math.round(fontSize * scale));
  }

  /**
   * Companion half of a slot-scoped geometry fix: the fix box targets the
   * LABEL, so a `${slotId}-bg` shape re-derives x/width from the label's
   * patched box via the badge inset convention (insetX = round(fontSize ×
   * 0.6), symmetric — see `_badgeElements`), and a `${slotId}-underline` bar
   * keeps the label's x/width with its y sitting below the label. Only keys
   * the fix actually carries are derived; a missing label falls back to the
   * raw patch (better than detaching the pair).
   */
  private _deriveCompanionGeometry(
    out: DesignerOutput,
    companion: DesignerElement,
    slotId: string,
    picked: Record<string, unknown>
  ): Record<string, unknown> {
    const label = out.children.find(
      (c) => c.type === 'text' && (c.originId === slotId || c.id === slotId)
    );
    if (!label) return picked;
    const merged = {
      x: (picked.x as number | undefined) ?? label.x,
      y: (picked.y as number | undefined) ?? label.y,
      width: (picked.width as number | undefined) ?? label.width,
      height: (picked.height as number | undefined) ?? label.height,
    };
    const fontSize =
      (picked.fontSize as number | undefined) ?? label.fontSize ?? 16;
    const patch: Record<string, unknown> = {};
    if ((companion.originId || companion.id).endsWith('-underline')) {
      if (picked.x !== undefined) patch.x = merged.x;
      if (picked.width !== undefined) patch.width = merged.width;
      if (picked.y !== undefined) {
        patch.y = merged.y + Math.round(fontSize * 1.3);
      }
      return patch;
    }
    const insetX = Math.round(fontSize * 0.6);
    if (picked.x !== undefined) patch.x = merged.x - insetX;
    if (picked.width !== undefined) patch.width = merged.width + insetX * 2;
    if (picked.y !== undefined) patch.y = merged.y;
    if (picked.height !== undefined) patch.height = merged.height;
    return patch;
  }

  /**
   * Build `addElement` ops from a constrained fix spec: text/shape/badge-style
   * additions only, defaults filled per output, and every op validated through
   * the doc ops schema before it is emitted — a fix can never inject an
   * arbitrary element. Shared scope scales an explicit box/fontSize (authored
   * against the primary output) to each output.
   */
  private _buildAddElementOps(
    doc: DesignerDoc,
    spec: FixAddElement,
    targetIndexes: number[],
    scope: Fix['scope']
  ): DesignerDocOp[] {
    if (
      !spec ||
      (spec.type !== 'text' && spec.type !== 'shape') ||
      typeof spec.slotId !== 'string' ||
      !spec.slotId.trim()
    ) {
      this._logger.warn(
        'Skipping addElement fix with an out-of-spec shape.',
        AiDesignerComposerService.name
      );
      return [];
    }
    if (spec.type === 'text' && !(typeof spec.text === 'string' && spec.text.trim())) {
      this._logger.warn(
        `Skipping addElement fix ("${spec.slotId}"): a text element needs text.`,
        AiDesignerComposerService.name
      );
      return [];
    }

    const primary = doc.outputs[0];
    const ops: DesignerDocOp[] = [];

    for (const outputIndex of targetIndexes) {
      const out = doc.outputs[outputIndex];
      if (!out || !('children' in out)) continue;

      const scale =
        scope === 'shared' && primary && primary !== out
          ? Math.min(out.width / primary.width, out.height / primary.height)
          : 1;

      let x: number;
      let y: number;
      let width: number;
      let height: number;
      if (spec.box) {
        // Explicit boxes are authored against the primary output and scaled.
        width = Math.round((spec.box.width ?? out.width * 0.6) * scale);
        height = Math.round((spec.box.height ?? out.height * 0.12) * scale);
        x = Math.round((spec.box.x ?? (out.width - width) / 2) * scale);
        y = Math.round((spec.box.y ?? (out.height - height) / 2) * scale);
      } else {
        // Default: a centered band, computed on each output's own canvas.
        width = Math.round(out.width * 0.6);
        height = Math.round(out.height * 0.12);
        x = Math.round((out.width - width) / 2);
        y = Math.round((out.height - height) / 2);
      }

      // The box must fit the target canvas — a scaled explicit box can land
      // partially off-canvas on a differently-shaped output.
      width = Math.min(width, out.width);
      height = Math.min(height, out.height);
      x = Math.min(Math.max(x, 0), Math.max(0, out.width - width));
      y = Math.min(Math.max(y, 0), Math.max(0, out.height - height));

      // Slot collision: the slot already exists on this output — a second
      // insert would layer a duplicate over it (the double "badge-bg" black
      // plate over the original star). Patch the existing element with the
      // spec's box/fill instead of inserting.
      const existing = out.children.find(
        (c) => (c.originId || c.id) === spec.slotId
      );
      if (existing) {
        const patch: Partial<DesignerElement> = {};
        if (spec.box) Object.assign(patch, { x, y, width, height });
        if (typeof spec.style?.fill === 'string') patch.fill = spec.style.fill;
        if (Object.keys(patch).length === 0) {
          this._logger.warn(
            `Skipping addElement fix ("${spec.slotId}"): the slot already exists and the spec carries nothing to patch.`,
            AiDesignerComposerService.name
          );
          continue;
        }
        this._logger.log(
          `addElement fix ("${spec.slotId}") targets an existing slot — patching it instead of layering a duplicate.`,
          AiDesignerComposerService.name
        );
        ops.push({
          op: 'updateElement',
          outputIndex,
          elementId: existing.id,
          scope: 'format-only',
          patch,
        });
        continue;
      }

      // A shape/scrim must never paint OVER the copy: insert it just before
      // the output's first text element instead of appending it topmost.
      const beforeElementId =
        spec.type === 'shape'
          ? out.children.find((c) => c.type === 'text' && !c.hidden)?.id
          : undefined;

      // A genuinely-new companion (`${base}-bg` / `${base}-underline`) whose
      // base element exists joins the base's move group so overlap nudges
      // and reflow keep the new pair glued.
      const baseId = spec.slotId.endsWith('-bg')
        ? spec.slotId.slice(0, -'-bg'.length)
        : spec.slotId.endsWith('-underline')
        ? spec.slotId.slice(0, -'-underline'.length)
        : undefined;
      const base = baseId
        ? out.children.find((c) => (c.originId || c.id) === baseId)
        : undefined;

      const element: Record<string, unknown> = {
        type: spec.type,
        x,
        y,
        width,
        height,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        originId: spec.slotId,
        ...(base?.groupId ? { groupId: base.groupId } : {}),
      };

      if (spec.type === 'text') {
        element.text = spec.text;
        if (
          typeof spec.style?.fontSize === 'number' &&
          Number.isFinite(spec.style.fontSize)
        ) {
          element.fontSize = Math.max(10, Math.round(spec.style.fontSize * scale));
        }
        if (typeof spec.style?.fontFamily === 'string' && spec.style.fontFamily.trim()) {
          element.fontFamily = spec.style.fontFamily;
        }
        if (
          spec.style?.align === 'left' ||
          spec.style?.align === 'center' ||
          spec.style?.align === 'right'
        ) {
          element.align = spec.style.align;
        }
        if (
          spec.style?.textStroke &&
          typeof spec.style.textStroke.color === 'string' &&
          typeof spec.style.textStroke.width === 'number' &&
          Number.isFinite(spec.style.textStroke.width)
        ) {
          element.textStroke = {
            color: spec.style.textStroke.color,
            width: spec.style.textStroke.width,
          };
        }
        if (spec.style?.textShadow === true) {
          element.textShadow = this._defaultShadow(
            (element.fontSize as number) ?? Math.round(Math.min(out.width, out.height) * 0.05)
          );
        }
        if (typeof spec.style?.fill === 'string') {
          element.fill = spec.style.fill;
        }
      } else {
        element.shape =
          spec.shape === 'ellipse' || spec.shape === 'line' || spec.shape === 'star'
            ? spec.shape
            : 'rect';
        if (typeof spec.style?.fill === 'string') {
          element.fill = spec.style.fill;
        }
      }

      const parsed = DesignerDocOpSchema.safeParse({
        op: 'addElement',
        outputIndex,
        element,
        ...(beforeElementId ? { beforeElementId } : {}),
      });
      if (!parsed.success) {
        this._logger.warn(
          `Skipping addElement fix ("${spec.slotId}"): ${parsed.error.issues[0]?.message}`,
          AiDesignerComposerService.name
        );
        continue;
      }
      ops.push(parsed.data as DesignerDocOp);
    }

    return ops;
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

  // ---------------------------------------------------------------------
  // Style resolution
  // ---------------------------------------------------------------------

  private _resolveStyle(plan: DesignPlan): ResolvedStyle {
    const preset =
      getStylePreset(plan.styleId ?? DEFAULT_STYLE_ID) ??
      (getStylePreset(DEFAULT_STYLE_ID) as AiDesignerStylePreset);
    const planned = (plan.palette || []).filter(
      (c) => typeof c === 'string' && c.trim()
    );
    // A usable palette needs at least surface + text + accent; anything
    // shorter falls back to the preset's first palette.
    const palette = planned.length >= 3 ? planned : preset.palettes[0];
    const surface = palette[0];
    const text = palette[1];
    const accents = palette.length > 2 ? palette.slice(2) : [text];
    return {
      preset,
      palette,
      surface,
      text,
      accents,
      surfaceIsDark: hexLuminance(surface) < 0.35,
    };
  }

  private _resolveTemplate(plan: DesignPlan): LayoutId {
    const raw = plan.formatTemplate?.trim();
    const mapped = raw ? LAYOUT_ALIASES[raw] ?? raw : undefined;
    if (mapped && (LAYOUT_TYPE_SCALE as Record<string, number>)[mapped] !== undefined) {
      return mapped as LayoutId;
    }
    if (raw) {
      this._logger.warn(
        `Unknown formatTemplate "${raw}" — falling back to a gallery default.`,
        AiDesignerComposerService.name
      );
    }
    // Unknown/absent templates never silently degrade to a bare image macro:
    // plans with imagery get the hero treatment, text-only plans get the
    // centered minimal stack.
    const hasImage =
      plan.slots.some((s) => s.kind === 'image' || s.role === 'image') ||
      plan.background?.kind === 'image';
    return hasImage ? 'hero-fullbleed' : 'minimal-centered';
  }

  /** Map the preset typeScale ratios to pixels for this output size. LLM
   *  pixel hints in `plan.typeScale` win over the preset ratios — but only
   *  when they plausibly ARE pixels: models sometimes emit ratio-shaped
   *  values (0..1) that pass a bare `> 0` check and round down to 0, failing
   *  strict doc validation. Hints under the legibility floor are ignored in
   *  favor of the preset ratio, and every computed size is clamped UP to its
   *  per-role floor (feed-legibility) as well as to the absolute minimum. */
  private _typeScalePx(
    plan: DesignPlan,
    style: ResolvedStyle,
    w: number,
    h: number,
    layout: LayoutId
  ): TypeScalePx {
    const base = Math.min(w, h) * 0.085 * LAYOUT_TYPE_SCALE[layout];
    const ratios = style.preset.typeScale;
    const px = (key: keyof TypeScalePx): number => {
      const floor = Math.max(
        MIN_FONT_SIZE_PX,
        Math.round(Math.min(w, h) * ROLE_FLOOR_RATIO[key])
      );
      const hint = plan.typeScale?.[key];
      if (
        typeof hint === 'number' &&
        Number.isFinite(hint) &&
        hint >= MIN_FONT_SIZE_PX
      ) {
        // Clamped to the doc schema's font-size ceiling as well as the role
        // floor — an outsized LLM hint fails strict validation otherwise.
        return Math.max(floor, Math.min(MAX_FONT_SIZE, Math.round(hint)));
      }
      const computed = base * ratios[key];
      return Number.isFinite(computed)
        ? Math.max(floor, Math.round(computed))
        : floor;
    };
    return {
      headline: px('headline'),
      subhead: px('subhead'),
      cta: px('cta'),
      legal: px('legal'),
    };
  }

  /** Classify a copy slot into a typographic role. `copyIndex` is the slot's
   *  index among the plan's copy slots (first copy slot = headline). */
  private _slotRole(slot: DesignSlot, copyIndex: number): SlotRole {
    if (slot.kind === 'cta-button') return 'cta';
    if (slot.kind === 'badge') return 'badge';
    const role = (slot.role || '').toLowerCase();
    if (/legal|footer|disclaimer|fine.?print|terms/.test(role)) return 'legal';
    if (/cta|button|action/.test(role)) return 'cta';
    if (/badge|sticker|burst/.test(role)) return 'badge';
    if (copyIndex === 0 || /headline|title|hero/.test(role)) return 'headline';
    if (/sub|caption|body|desc|tagline/.test(role)) return 'subhead';
    return 'body';
  }

  private _roleFontSize(role: SlotRole, scale: TypeScalePx): number {
    switch (role) {
      case 'headline':
        return scale.headline;
      case 'cta':
      case 'badge':
        return scale.cta;
      case 'legal':
        return scale.legal;
      default:
        return scale.subhead;
    }
  }

  private _roleFontWeight(role: SlotRole): number {
    switch (role) {
      case 'headline':
        return 800;
      case 'cta':
      case 'badge':
        return 700;
      case 'subhead':
        return 500;
      default:
        return 400;
    }
  }

  /** Pick the palette candidate with the best contrast ratio against `bg`.
   *  Below the minimum ratio the "best" pick is still unreadable — force
   *  whichever of white/near-black reads better against the actual
   *  underlying fill. */
  private _contrastOn(bg: string, style: ResolvedStyle): string {
    const candidates = [style.surface, style.text, '#FFFFFF', '#111111'];
    let best = candidates[0];
    let bestRatio = -1;
    for (const c of candidates) {
      const ratio = contrastRatio(bg, c);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = c;
      }
    }
    if (bestRatio >= MIN_CONTRAST_RATIO) return best;
    return contrastRatio(bg, '#FFFFFF') >= contrastRatio(bg, '#111111')
      ? '#FFFFFF'
      : '#111111';
  }

  /** A plan-supplied accent is only usable when a readable label color
   *  exists against it (≥ the minimum ratio); a failing label/shape pair
   *  falls back to the style accent. */
  private _resolveAccent(
    slotFill: string | undefined,
    style: ResolvedStyle
  ): string {
    const fallback = style.accents[0];
    if (!slotFill) return fallback;
    return contrastRatio(this._contrastOn(slotFill, style), slotFill) >=
      MIN_CONTRAST_RATIO
      ? slotFill
      : fallback;
  }

  /** Preset-driven shadow: accent glow on dark surfaces (neon signage), a
   *  soft offset drop shadow on light ones. */
  private _presetShadow(style: ResolvedStyle, fontSize: number): DesignerTextShadow {
    if (style.surfaceIsDark) {
      return {
        color: style.accents[0],
        blur: Math.round(fontSize * 0.45),
        offsetX: 0,
        offsetY: 0,
      };
    }
    return {
      color: 'rgba(0,0,0,0.4)',
      blur: Math.round(fontSize * 0.12),
      offsetX: Math.round(fontSize * 0.04),
      offsetY: Math.round(fontSize * 0.06),
    };
  }

  // ---------------------------------------------------------------------
  // Element builders
  // ---------------------------------------------------------------------

  private _styledTextElement(
    slot: DesignSlot,
    role: SlotRole,
    rawText: string,
    box: Box,
    ctx: ComposeContext,
    opts: {
      align?: 'left' | 'center' | 'right';
      onImage?: boolean;
      noStroke?: boolean;
      verticalAlign?: 'top' | 'middle' | 'bottom';
      fontSize?: number;
      fill?: string;
      groupId?: string;
    } = {}
  ): DesignerElement {
    const { preset } = ctx.style;
    const treatments = preset.treatments;
    const override = slot.style || {};
    const isDisplay = role === 'headline';

    let text = rawText;
    if (isDisplay && treatments.headlineTransform === 'uppercase') {
      text = text.toUpperCase();
    }

    const fontSize = opts.fontSize ?? this._roleFontSize(role, ctx.scale);
    const fontFamily =
      override.fontFamily ??
      (isDisplay ? preset.fonts.display : preset.fonts.body);
    const fontWeight = override.fontWeight ?? this._roleFontWeight(role);
    const align = override.align ?? opts.align ?? 'center';

    // Fill precedence: explicit opts > per-slot override > white over imagery
    // > palette text color. A gradient override on a text slot falls back to
    // its first stop (flat text has no gradient fill in the render model).
    const fill =
      opts.fill ??
      override.fill ??
      override.gradient?.[0] ??
      (opts.onImage ? '#FFFFFF' : ctx.style.text);

    // Stroke precedence: per-slot override > preset treatment (display text
    // only); 'dark'/'light' map against the palette surface.
    let textStroke: DesignerTextStroke | undefined = override.stroke;
    if (!textStroke && !opts.noStroke && isDisplay && treatments.textStroke) {
      textStroke = {
        color: treatments.textStroke.color === 'dark' ? '#111111' : '#FFFFFF',
        width: treatments.textStroke.width,
      };
    }

    // Shadow precedence: per-slot override (true = preset shadow, false =
    // none) > preset treatment > legibility safety net for text over imagery.
    let textShadow: DesignerTextShadow | undefined;
    if (override.shadow ?? treatments.textShadow) {
      textShadow = this._presetShadow(ctx.style, fontSize);
    } else if (override.shadow === undefined && opts.onImage && !textStroke) {
      textShadow = {
        color: 'rgba(0,0,0,0.5)',
        blur: Math.max(2, Math.round(fontSize * 0.18)),
        offsetX: 0,
        offsetY: Math.max(1, Math.round(fontSize * 0.04)),
      };
    }

    return {
      id: '',
      type: 'text',
      ...box,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      text,
      fontFamily,
      fontSize,
      fontWeight,
      fill,
      align,
      lineHeight: 1.1,
      letterSpacing: isDisplay ? treatments.letterSpacing || 0 : undefined,
      textStroke,
      textShadow,
      verticalAlign: opts.verticalAlign,
      groupId: opts.groupId,
      originId: slot.id,
    } as DesignerElement;
  }

  /**
   * CTA slot → button pair: a rounded-rect shape plus a centered text element
   * on top. The shape is originId'd `${slotId}-bg` (the text keeps the slot
   * id, so slot-scoped fixes hit the label) and both share a groupId.
   */
  private _ctaElements(
    slot: DesignSlot,
    rawText: string,
    area: { x: number; y: number; width: number },
    ctx: ComposeContext,
    opts: { align?: 'left' | 'center' | 'right' } = {}
  ): DesignerElement[] {
    const override = slot.style || {};
    const ctaStyle = ctx.style.preset.treatments.ctaStyle;
    const accent = this._resolveAccent(override.fill, ctx.style);
    const fontSize = ctx.scale.cta;
    const align = override.align ?? opts.align ?? 'center';

    const padX = Math.round(fontSize * 1.3);
    const estTextW = Math.round(rawText.length * fontSize * 0.56);
    const width = Math.min(area.width, estTextW + padX * 2);
    const underline = ctaStyle === 'underline';
    const height = underline
      ? Math.round(fontSize * 1.6)
      : Math.round(fontSize * 2.1);
    let x = area.x;
    if (align === 'center') x = area.x + Math.round((area.width - width) / 2);
    else if (align === 'right') x = area.x + area.width - width;
    const box: Box = { x, y: area.y, width, height };

    if (underline) {
      // Text-only CTA with an accent underline bar.
      const text = this._styledTextElement(slot, 'cta', rawText, box, ctx, {
        align,
        verticalAlign: 'middle',
        fill: override.fill ?? ctx.style.text,
        groupId: slot.id,
      });
      const bar: DesignerElement = {
        id: '',
        type: 'shape',
        shape: 'rect',
        x,
        y: area.y + Math.round(fontSize * 1.3),
        width,
        height: Math.max(2, Math.round(fontSize * 0.07)),
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        fill: ctx.style.accents[0],
        groupId: slot.id,
        originId: `${slot.id}-underline`,
      } as DesignerElement;
      return [bar, text];
    }

    const outline = ctaStyle === 'outline';
    const shape: DesignerElement = {
      id: '',
      type: 'shape',
      shape: 'rect',
      ...box,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      fill: outline ? undefined : accent,
      fillGradient:
        !outline && override.gradient
          ? {
              type: 'linear',
              angle: 90,
              stops: [
                { offset: 0, color: override.gradient[0] },
                { offset: 1, color: override.gradient[1] },
              ],
            }
          : undefined,
      borderRadius:
        ctaStyle === 'pill' ? Math.round(height / 2) : Math.round(height * 0.14),
      stroke: outline ? accent : undefined,
      strokeWidth: outline ? Math.max(2, Math.round(fontSize * 0.09)) : undefined,
      groupId: slot.id,
      originId: `${slot.id}-bg`,
    } as DesignerElement;

    const text = this._styledTextElement(slot, 'cta', rawText, box, ctx, {
      // The label always centers inside the button shape (align only
      // positions the pill within its area); box === shape box exactly.
      align: 'center',
      verticalAlign: 'middle',
      fill: outline ? accent : this._contrastOn(accent, ctx.style),
      groupId: slot.id,
    });
    return [shape, text];
  }

  /** Badge slot → small pill/burst/ribbon shape + short centered text.
   *  Shape kind precedence: per-slot override (plan-authored) > layout-forced
   *  style (badge-burst) > preset treatment > pill. */
  private _badgeElements(
    slot: DesignSlot,
    rawText: string,
    area: { x: number; y: number; width: number },
    ctx: ComposeContext,
    opts: {
      align?: 'left' | 'center' | 'right';
      onImage?: boolean;
      badgeStyle?: 'pill' | 'burst' | 'ribbon';
    } = {}
  ): DesignerElement[] {
    const badgeStyle =
      slot.style?.badgeStyle ??
      opts.badgeStyle ??
      ctx.style.preset.treatments.badgeStyle ??
      'pill';
    const accent = this._resolveAccent(slot.style?.fill, ctx.style);
    const fontSize = Math.max(12, Math.round(ctx.scale.cta * 0.85));
    const align = slot.style?.align ?? opts.align ?? 'center';

    const padX = Math.round(fontSize * 1.1);
    // Estimate on the generous side (0.66 em/char) so heavy display fonts and
    // wide glyphs (%, !) don't overflow the pill and clip.
    let width = Math.min(area.width, Math.round(rawText.length * fontSize * 0.66) + padX * 2);
    let height = Math.round(fontSize * 2);
    if (badgeStyle === 'burst') {
      // Starbursts need a roughly square frame to stay readable.
      const side = Math.max(width, Math.round(height * 1.5));
      width = side;
      height = side;
    }
    let x = area.x;
    if (align === 'center') x = area.x + Math.round((area.width - width) / 2);
    else if (align === 'right') x = area.x + area.width - width;
    const box: Box = { x, y: area.y, width, height };

    const shape: DesignerElement = {
      id: '',
      type: 'shape',
      shape: badgeStyle === 'burst' ? 'star' : 'rect',
      ...box,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      fill: accent,
      borderRadius:
        badgeStyle === 'burst'
          ? undefined
          : badgeStyle === 'pill'
          ? Math.round(height / 2)
          : Math.round(height * 0.12),
      groupId: slot.id,
      originId: `${slot.id}-bg`,
    } as DesignerElement;

    // The label sits inside the shape with a horizontal inset (bursts inset
    // on all sides to the star's ~60% inner safe area) so glyphs never touch
    // or clip the shape's edge.
    const insetX =
      badgeStyle === 'burst'
        ? Math.round(width * 0.2)
        : Math.round(fontSize * 0.6);
    const insetY = badgeStyle === 'burst' ? Math.round(height * 0.2) : 0;
    const textBox: Box = {
      x: box.x + insetX,
      y: box.y + insetY,
      width: Math.max(10, box.width - insetX * 2),
      height: Math.max(10, box.height - insetY * 2),
    };
    // Auto-fit: shrink the font (same 60%/8px floor as the renderer's
    // shrink-to-fit) until the estimated wrap fits the inner box — badge text
    // must never spill outside its shape (the starburst overflow case).
    let fittedFontSize = fontSize;
    const fontFloor = Math.max(MIN_FONT_SIZE_PX, Math.floor(fontSize * 0.6));
    while (
      fittedFontSize > fontFloor &&
      this._estimateWrappedLines(rawText, textBox.width, fittedFontSize) *
        1.1 *
        fittedFontSize >
        textBox.height
    ) {
      fittedFontSize = Math.max(fontFloor, Math.floor(fittedFontSize * 0.9));
    }
    const text = this._styledTextElement(slot, 'badge', rawText, textBox, ctx, {
      align: 'center',
      verticalAlign: 'middle',
      fontSize: fittedFontSize,
      fill: this._contrastOn(accent, ctx.style),
      groupId: slot.id,
    });
    return [shape, text];
  }

  /** Accent-shape slot → simple decorative geometry in an accent color.
   *  Deterministic corner placement cycling clockwise. */
  private _accentShapeElement(
    slot: DesignSlot,
    index: number,
    ctx: ComposeContext
  ): DesignerElement {
    const shapes: Array<'rect' | 'ellipse' | 'star'> = ['rect', 'ellipse', 'star'];
    const shape = shapes[index % shapes.length];
    const accent =
      slot.style?.fill ?? ctx.style.accents[index % ctx.style.accents.length];
    const unit = Math.min(ctx.w, ctx.h);
    const size = Math.round(unit * (shape === 'rect' ? 0.14 : 0.1));
    // Rects read as bars; circles/stars stay compact.
    const width = shape === 'rect' ? size * 2 : size;
    const height = shape === 'rect' ? Math.max(6, Math.round(size * 0.28)) : size;
    const positions = [
      { x: ctx.w - ctx.margin - width, y: ctx.margin },
      { x: ctx.margin, y: ctx.h - ctx.margin - height },
      { x: ctx.w - ctx.margin - width, y: ctx.h - ctx.margin - height },
      { x: ctx.margin, y: ctx.margin },
    ];
    const pos = positions[index % positions.length];
    return {
      id: '',
      type: 'shape',
      shape,
      x: pos.x,
      y: pos.y,
      width,
      height,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      fill: accent,
      originId: slot.id,
    } as DesignerElement;
  }

  // ---------------------------------------------------------------------
  // Layout gallery
  // ---------------------------------------------------------------------

  private _buildElements(
    plan: DesignPlan,
    copy: SlotTextMap,
    assets: Record<string, AssetResult>,
    output: { width: number; height: number },
    layout: LayoutId,
    style: ResolvedStyle,
    opts: { heroTop?: boolean } = {}
  ): DesignerElement[] {
    const w = output.width;
    const h = output.height;
    const margin = Math.round(Math.min(w, h) * 0.05);
    const scale = this._typeScalePx(plan, style, w, h, layout);
    const ctx: ComposeContext = { plan, copy, assets, w, h, margin, style, scale };

    const imageSlot = plan.slots.find(
      (s) => s.kind === 'image' || s.role === 'image'
    );
    const copySlots = plan.slots.filter(
      (s) => isCopySlot(s) && s.role !== 'image'
    );
    const roles = new Map<string, SlotRole>(
      copySlots.map((s, i) => [s.id, this._slotRole(s, i)])
    );
    const badgeSlots = copySlots.filter((s) => roles.get(s.id) === 'badge');
    const textSlots = copySlots.filter((s) => roles.get(s.id) !== 'badge');
    // Accent shapes paint behind text (they are pushed before text elements
    // in every layout below).
    const accents = plan.slots
      .filter((s) => s.kind === 'accent-shape')
      .map((s, i) => this._accentShapeElement(s, i, ctx));

    let elements: DesignerElement[];
    switch (layout) {
      case 'split-panel':
        elements = this._layoutSplitPanel(ctx, imageSlot, textSlots, badgeSlots, accents, roles);
        break;
      case 'top-bottom':
        elements = this._layoutTopBottom(ctx, imageSlot, textSlots, badgeSlots, accents, roles);
        break;
      case 'badge-burst':
        elements = this._layoutBadgeBurst(ctx, imageSlot, textSlots, badgeSlots, accents, roles);
        break;
      case 'editorial-sidebar':
        elements = this._layoutEditorialSidebar(ctx, imageSlot, textSlots, badgeSlots, accents, roles);
        break;
      case 'minimal-centered':
        elements = this._layoutMinimalCentered(ctx, imageSlot, textSlots, badgeSlots, accents, roles);
        break;
      case 'hero-fullbleed':
      default:
        elements = this._layoutHero(ctx, imageSlot, textSlots, badgeSlots, accents, roles, opts.heroTop);
        break;
    }

    return elements.map((el) => ({ ...el, originId: el.originId || el.id }));
  }

  /** hero-fullbleed: the image is full-bleed (0,0,w,h) by design — there is
   *  no scrim band; the copy stack in the lower third sits ON the image and
   *  relies on the over-image shadow safety net for legibility. Badge pinned
   *  top-right. `heroTop` (channel-layout variant) parks the image in the
   *  top ~55% and stacks copy below on the surface. */
  private _layoutHero(
    ctx: ComposeContext,
    imageSlot: DesignSlot | undefined,
    textSlots: DesignSlot[],
    badgeSlots: DesignSlot[],
    accents: DesignerElement[],
    roles: Map<string, SlotRole>,
    heroTop?: boolean
  ): DesignerElement[] {
    const { w, h, margin } = ctx;
    const elements: DesignerElement[] = [];
    if (imageSlot) {
      const imgH = heroTop ? Math.round(h * 0.55) : h;
      elements.push(
        this._imageElement(imageSlot.id, this._assetFor(ctx, imageSlot.id), 0, 0, w, imgH)
      );
    }
    elements.push(...accents);

    const onImage = !!imageSlot && !heroTop;
    this._pushBadges(ctx, elements, badgeSlots, roles, {
      x: margin,
      y: margin,
      width: w - margin * 2,
    });

    const stackY = heroTop ? Math.round(h * 0.58) : Math.round(h * 0.46);
    elements.push(
      ...this._copyStack(ctx, textSlots, roles, {
        x: margin,
        y: stackY,
        width: w - margin * 2,
        height: h - stackY - margin,
      }, { align: 'center', onImage })
    );
    return elements;
  }

  /** split-panel: solid surface panel with left-aligned copy on one side,
   *  image filling the other half. `plan.panelSide` picks the panel side
   *  (default left). */
  private _layoutSplitPanel(
    ctx: ComposeContext,
    imageSlot: DesignSlot | undefined,
    textSlots: DesignSlot[],
    badgeSlots: DesignSlot[],
    accents: DesignerElement[],
    roles: Map<string, SlotRole>
  ): DesignerElement[] {
    const { w, h, margin, style } = ctx;
    const panelW = Math.round(w * 0.46);
    const panelRight = ctx.plan.panelSide === 'right';
    const panelX = panelRight ? w - panelW : 0;
    const elements: DesignerElement[] = [
      {
        id: '',
        type: 'shape',
        shape: 'rect',
        x: panelX,
        y: 0,
        width: panelW,
        height: h,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        fill: style.surface,
        originId: 'split-panel-bg',
      } as DesignerElement,
    ];
    if (imageSlot) {
      elements.push(
        this._imageElement(
          imageSlot.id,
          this._assetFor(ctx, imageSlot.id),
          panelRight ? 0 : panelW,
          0,
          w - panelW,
          h
        )
      );
    }
    elements.push(...accents);
    this._pushBadges(ctx, elements, badgeSlots, roles, {
      x: panelX + margin,
      y: margin,
      width: panelW - margin * 2,
    }, 'left');
    const badgeOffset = badgeSlots.length
      ? Math.round(ctx.scale.cta * 2.6 * badgeSlots.length)
      : 0;
    elements.push(
      ...this._copyStack(ctx, textSlots, roles, {
        x: panelX + margin,
        y: margin + badgeOffset,
        width: panelW - margin * 2,
        height: h - margin * 2 - badgeOffset,
      }, { align: 'left' })
    );
    return elements;
  }

  /** top-bottom: fullbleed image, first copy slot pinned top, last pinned
   *  bottom, any middle slots stacked center. */
  private _layoutTopBottom(
    ctx: ComposeContext,
    imageSlot: DesignSlot | undefined,
    textSlots: DesignSlot[],
    badgeSlots: DesignSlot[],
    accents: DesignerElement[],
    roles: Map<string, SlotRole>
  ): DesignerElement[] {
    const { w, h, margin } = ctx;
    const elements: DesignerElement[] = [];
    if (imageSlot) {
      elements.push(
        this._imageElement(imageSlot.id, this._assetFor(ctx, imageSlot.id), 0, 0, w, h)
      );
    }
    elements.push(...accents);
    this._pushBadges(ctx, elements, badgeSlots, roles, {
      x: margin,
      y: margin,
      width: w - margin * 2,
    });

    const onImage = !!imageSlot;
    const top = textSlots[0];
    const bottom = textSlots.length > 1 ? textSlots[textSlots.length - 1] : undefined;
    const middle = textSlots.slice(1, bottom ? -1 : undefined);
    if (top) {
      const role = roles.get(top.id) || 'headline';
      const fontSize = this._roleFontSize(role, ctx.scale);
      elements.push(
        this._styledTextElement(
          top,
          role,
          this._slotText(ctx.copy, top, ctx.plan, 0),
          { x: margin, y: margin, width: w - margin * 2, height: Math.round(fontSize * 2.5) },
          ctx,
          { align: 'center', onImage }
        )
      );
    }
    if (middle.length) {
      elements.push(
        ...this._copyStack(ctx, middle, roles, {
          x: margin,
          y: Math.round(h * 0.35),
          width: w - margin * 2,
          height: Math.round(h * 0.3),
        }, { align: 'center', onImage })
      );
    }
    if (bottom) {
      const role = roles.get(bottom.id) || 'body';
      const bottomText = this._slotText(ctx.copy, bottom, ctx.plan, textSlots.length - 1);
      if (role === 'cta') {
        // A CTA pinned to the bottom band keeps its button treatment.
        const fontSize = ctx.scale.cta;
        elements.push(
          ...this._ctaElements(
            bottom,
            bottomText,
            { x: margin, y: h - margin - Math.round(fontSize * 2.4), width: w - margin * 2 },
            ctx,
            { align: 'center' }
          )
        );
      } else {
        const fontSize = this._roleFontSize(role, ctx.scale);
        elements.push(
          this._styledTextElement(
            bottom,
            role,
            bottomText,
            {
              x: margin,
              y: h - margin - Math.round(fontSize * 2.5),
              width: w - margin * 2,
              height: Math.round(fontSize * 2.5),
            },
            ctx,
            { align: 'center', onImage }
          )
        );
      }
    }
    return elements;
  }

  /** badge-burst: fullbleed hero with the badge as a prominent centered
   *  accent above the headline stack. */
  private _layoutBadgeBurst(
    ctx: ComposeContext,
    imageSlot: DesignSlot | undefined,
    textSlots: DesignSlot[],
    badgeSlots: DesignSlot[],
    accents: DesignerElement[],
    roles: Map<string, SlotRole>
  ): DesignerElement[] {
    const { w, h, margin } = ctx;
    const elements: DesignerElement[] = [];
    if (imageSlot) {
      elements.push(
        this._imageElement(imageSlot.id, this._assetFor(ctx, imageSlot.id), 0, 0, w, h)
      );
    }
    elements.push(...accents);
    const onImage = !!imageSlot;
    // The badge IS this layout's centerpiece — force the burst treatment
    // (a per-slot badgeStyle override still wins inside _badgeElements).
    this._pushBadges(ctx, elements, badgeSlots, roles, {
      x: margin,
      y: Math.round(h * 0.14),
      width: w - margin * 2,
    }, 'center', 'burst');
    const stackY = Math.round(h * 0.36);
    elements.push(
      ...this._copyStack(ctx, textSlots, roles, {
        x: margin,
        y: stackY,
        width: w - margin * 2,
        height: h - stackY - margin,
      }, { align: 'center', onImage })
    );
    return elements;
  }

  /** editorial-sidebar: solid sidebar column with a left-aligned vertical
   *  rhythm of copy; the image fills the rest of the canvas.
   *  `plan.panelSide` picks the sidebar side (default left). */
  private _layoutEditorialSidebar(
    ctx: ComposeContext,
    imageSlot: DesignSlot | undefined,
    textSlots: DesignSlot[],
    badgeSlots: DesignSlot[],
    accents: DesignerElement[],
    roles: Map<string, SlotRole>
  ): DesignerElement[] {
    const { w, h, margin, style } = ctx;
    const sidebarW = Math.round(w * 0.38);
    const panelRight = ctx.plan.panelSide === 'right';
    const sidebarX = panelRight ? w - sidebarW : 0;
    const elements: DesignerElement[] = [
      {
        id: '',
        type: 'shape',
        shape: 'rect',
        x: sidebarX,
        y: 0,
        width: sidebarW,
        height: h,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        fill: style.surface,
        originId: 'editorial-sidebar-bg',
      } as DesignerElement,
    ];
    if (imageSlot) {
      elements.push(
        this._imageElement(
          imageSlot.id,
          this._assetFor(ctx, imageSlot.id),
          panelRight ? 0 : sidebarW,
          0,
          w - sidebarW,
          h
        )
      );
    }
    elements.push(...accents);
    this._pushBadges(ctx, elements, badgeSlots, roles, {
      x: sidebarX + margin,
      y: margin,
      width: sidebarW - margin * 2,
    }, 'left');
    const badgeOffset = badgeSlots.length
      ? Math.round(ctx.scale.cta * 2.6 * badgeSlots.length)
      : 0;
    elements.push(
      ...this._copyStack(ctx, textSlots, roles, {
        x: sidebarX + margin,
        y: margin + badgeOffset,
        width: sidebarW - margin * 2,
        height: h - margin * 2 - badgeOffset,
      }, { align: 'left' })
    );
    return elements;
  }

  /** minimal-centered: centered copy stack with generous whitespace, no
   *  stroke; an optional image renders as an edge-to-edge band across the top
   *  — never a floating framed inset with margins around it. */
  private _layoutMinimalCentered(
    ctx: ComposeContext,
    imageSlot: DesignSlot | undefined,
    textSlots: DesignSlot[],
    badgeSlots: DesignSlot[],
    accents: DesignerElement[],
    roles: Map<string, SlotRole>
  ): DesignerElement[] {
    const { w, h, margin } = ctx;
    const elements: DesignerElement[] = [];
    let imageBottom = margin;
    if (imageSlot) {
      const bandH = Math.round(h * 0.38);
      elements.push(
        this._imageElement(
          imageSlot.id,
          this._assetFor(ctx, imageSlot.id),
          0,
          0,
          w,
          bandH
        )
      );
      imageBottom = bandH + margin;
    }
    elements.push(...accents);
    this._pushBadges(ctx, elements, badgeSlots, roles, {
      x: margin,
      y: imageBottom,
      width: w - margin * 2,
    }, 'center');

    // Center the stack vertically in the space below the image.
    const stackH = this._stackHeight(ctx, textSlots, roles);
    const availTop = imageBottom + (badgeSlots.length ? Math.round(ctx.scale.cta * 2.6) : 0);
    const startY = Math.max(
      availTop,
      Math.round((h - stackH) / 2),
    );
    elements.push(
      ...this._copyStack(ctx, textSlots, roles, {
        x: margin,
        y: startY,
        width: w - margin * 2,
        height: h - startY - margin,
      }, { align: 'center', noStroke: true, verticalAlign: 'middle' })
    );
    return elements;
  }

  // ---------------------------------------------------------------------
  // Shared stack helpers
  // ---------------------------------------------------------------------

  private _pushBadges(
    ctx: ComposeContext,
    elements: DesignerElement[],
    badgeSlots: DesignSlot[],
    roles: Map<string, SlotRole>,
    area: { x: number; y: number; width: number },
    align: 'left' | 'center' | 'right' = 'right',
    badgeStyle?: 'pill' | 'burst' | 'ribbon'
  ): void {
    const advance = Math.round(ctx.scale.cta * 2.6);
    badgeSlots.forEach((slot, i) => {
      const text = this._slotText(ctx.copy, slot, ctx.plan, i);
      if (!text) return;
      elements.push(
        ...this._badgeElements(
          slot,
          text,
          { x: area.x, y: area.y + i * advance, width: area.width },
          ctx,
          { align, badgeStyle }
        )
      );
    });
  }

  /** Stack copy slots vertically inside `area`, top-down, with role-driven
   *  box heights. Slots that would start below the area are dropped (the
   *  vision critic, not silent overlap, owns fixing an over-full layout). */
  private _copyStack(
    ctx: ComposeContext,
    slots: DesignSlot[],
    roles: Map<string, SlotRole>,
    area: Box,
    opts: {
      align?: 'left' | 'center' | 'right';
      onImage?: boolean;
      noStroke?: boolean;
      verticalAlign?: 'top' | 'middle' | 'bottom';
    } = {}
  ): DesignerElement[] {
    const elements: DesignerElement[] = [];
    const align = opts.align ?? 'center';
    let y = area.y;
    const bottom = area.y + area.height;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const role = roles.get(slot.id) || 'body';
      const text = this._slotText(ctx.copy, slot, ctx.plan, i);
      if (!text) continue;
      if (role === 'cta') {
        if (y >= bottom) break;
        const ctaEls = this._ctaElements(
          slot,
          text,
          { x: area.x, y, width: area.width },
          ctx,
          { align }
        );
        elements.push(...ctaEls);
        y += Math.round(ctx.scale.cta * 2.7);
        continue;
      }
      const fontSize = this._roleFontSize(role, ctx.scale);
      const boxH = Math.round(fontSize * (role === 'headline' ? 2.5 : 1.8));
      if (y >= bottom) break;
      elements.push(
        this._styledTextElement(
          slot,
          role,
          text,
          { x: area.x, y, width: area.width, height: Math.min(boxH, bottom - y) },
          ctx,
          {
            align,
            onImage: opts.onImage,
            noStroke: opts.noStroke,
            verticalAlign: opts.verticalAlign,
          }
        )
      );
      y += boxH + Math.round(fontSize * 0.45);
    }
    return elements;
  }

  /** Approximate stacked height of the given copy slots (for centering). */
  private _stackHeight(
    ctx: ComposeContext,
    slots: DesignSlot[],
    roles: Map<string, SlotRole>
  ): number {
    let total = 0;
    for (const slot of slots) {
      const role = roles.get(slot.id) || 'body';
      const fontSize = this._roleFontSize(role, ctx.scale);
      total +=
        role === 'cta'
          ? Math.round(fontSize * 2.7)
          : Math.round(fontSize * (role === 'headline' ? 2.5 : 1.8) + fontSize * 0.45);
    }
    return total;
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
      // Omit `src` when no asset resolved — an empty string fails the strict
      // SrcSchema on setDoc and would silently drop the whole composition
      // into the fallback doc.
      src: asset?.path || undefined,
      fileId: asset?.fileId,
      fitMode: 'cover',
      // Provider focal point when the asset carries one, center otherwise —
      // the renderer's cover-crop honors it when one asset serves several
      // aspect classes.
      focalPoint: asset?.focalPoint ?? { x: 0.5, y: 0.5 },
      originId: slotId,
    } as DesignerElement;
  }

  /**
   * Resolve the asset for a slot on an output of the given aspect class. The
   * conductor keys generated assets per plan (`${variantId}:${slotId}:aspect`)
   * so every plan's original gets its own image — that variant-scoped key
   * wins first. The legacy unscoped keys (`slotId:aspect`, then plain
   * `slotId`, then any aspect square-first) keep docs composed before
   * variant scoping resolving.
   */
  private _resolveAsset(
    assets: Record<string, AssetResult>,
    slotId: string,
    aspect: AssetAspect,
    variantId?: string
  ): AssetResult | undefined {
    const prefixes = variantId ? [`${variantId}:${slotId}`, slotId] : [slotId];
    for (const prefix of prefixes) {
      const exact = assets[`${prefix}:${aspect}`] ?? assets[prefix];
      if (exact) return exact;
    }
    for (const prefix of prefixes) {
      for (const fallback of ASPECT_PRIORITY) {
        const asset = assets[`${prefix}:${fallback}`];
        if (asset) return asset;
      }
    }
    return undefined;
  }

  private _assetFor(
    ctx: ComposeContext,
    slotId: string
  ): AssetResult | undefined {
    return this._resolveAsset(
      ctx.assets,
      slotId,
      aspectClass(ctx.w, ctx.h),
      ctx.plan.variantId
    );
  }

  /** Resolve display text for a slot: exact copy id, fuzzy role/id match
   *  (LLM copy maps often key by role), then a deterministic plan-derived
   *  fallback — a text slot must never render as an empty string. */
  private _slotText(
    copy: SlotTextMap,
    slot: { id: string; role?: string },
    plan: DesignPlan,
    slotIndex: number
  ): string {
    if (copy[slot.id]) return copy[slot.id];
    const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
    const wantId = norm(slot.id);
    const wantRole = norm(slot.role || '');
    for (const [k, v] of Object.entries(copy)) {
      if (!v) continue;
      const nk = norm(k);
      if (nk === wantId || (wantRole && (nk === wantRole || nk.includes(wantRole) || wantRole.includes(nk)))) {
        this._logger.warn(
          `Copy slot id mismatch: bound "${k}" to slot "${slot.id}" by fuzzy match.`,
          AiDesignerComposerService.name
        );
        return v;
      }
    }
    this._logger.warn(
      `No copy for text slot "${slot.id}" (role=${slot.role || '?'}); using plan-derived fallback.`,
      AiDesignerComposerService.name
    );
    const role = (slot.role || '').toLowerCase();
    if (/cta|button|action/.test(role)) return 'Learn more';
    if (slotIndex === 0 || /head|title|hero/.test(role)) {
      return (plan.concept || 'Your headline here').slice(0, 60);
    }
    return '';
  }

  private _backgroundToDesignerBg(
    background: DesignPlan['background'],
    assets?: Record<string, AssetResult>,
    output?: { width: number; height: number },
    variantId?: string
  ): { background: string; bg?: DesignerOutput['bg'] } {
    if (!background) return { background: '#ffffff' };
    if (background.kind === 'image') {
      // Plans reference generated/stock assets as `asset:{slotId}`. This case
      // was previously unimplemented and silently fell through to white —
      // every image-background plan rendered flat.
      const ref = (background.ref || '').replace(/^asset:/, '');
      const asset =
        ref && assets
          ? this._resolveAsset(
              assets,
              ref,
              output ? aspectClass(output.width, output.height) : 'square',
              variantId
            )
          : undefined;
      if (asset?.path) {
        return {
          background: '#000000',
          bg: {
            type: 'image',
            src: asset.path,
            fileId: asset.fileId,
            focalPoint: asset.focalPoint ?? { x: 0.5, y: 0.5 },
          },
        };
      }
      this._logger.warn(
        `Plan requested image background (ref=${background.ref || 'none'}) but no asset resolved; using solid fallback.`,
        AiDesignerComposerService.name
      );
      return { background: this._sanitizeColor(background.value) ?? '#1f2937' };
    }
    if (background.kind === 'solid') {
      return { background: this._sanitizeColor(background.value) ?? '#ffffff' };
    }
    if (background.kind === 'gradient') {
      const raw = background.value || '#ffffff,#000000';
      // Two value shapes reach here: a comma-separated color list and a full
      // CSS gradient string ("linear-gradient(135deg, #0A0A0A 0%, …)").
      // Splitting the CSS string on commas produced "linear-gradient(135deg"
      // as a color, which node-canvas rejects with "parse color failed" —
      // failing the whole variant (the S3 live failure).
      const listed = /^\s*(linear|radial|conic)-gradient\(/i.test(raw)
        ? this._extractGradientColors(raw)
        : raw.split(',');
      const colors = listed
        .map((token) => this._sanitizeColor(token))
        .filter((color): color is string => !!color);
      // A gradient needs at least two valid stops; anything less degrades to
      // a solid fallback rather than emitting an unparseable color.
      if (colors.length < 2) {
        return { background: colors[0] ?? '#1f2937' };
      }
      return {
        background: colors[0],
        bg: {
          type: 'gradient',
          gradient: {
            type: 'linear',
            angle: 135,
            stops: colors.map((c, i, arr) => ({
              offset: i / Math.max(1, arr.length - 1),
              color: c,
            })),
          },
        },
      };
    }
    return { background: '#ffffff' };
  }

  /**
   * A color the renderer can actually parse: #rgb/#rrggbb/#rrggbbaa hex or an
   * rgb(a)(…) functional value. Anything else (LLM-authored junk, half a CSS
   * gradient string) is dropped — an unparseable color reaching node-canvas
   * throws "parse color failed" and fails the whole variant.
   */
  private _sanitizeColor(value: string | undefined): string | undefined {
    const candidate = (value || '').trim();
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(candidate)) {
      return candidate;
    }
    if (
      /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i.test(
        candidate
      )
    ) {
      return candidate;
    }
    return undefined;
  }

  /**
   * Pull the color tokens out of a CSS gradient string. The angle and stop
   * percentages are ignored — the renderer computes its own evenly-spaced
   * stops from the extracted colors.
   */
  private _extractGradientColors(value: string): string[] {
    return value.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? [];
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
