import '@postmill-ai/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentResponse } from '@reaatech/agent-mesh';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import { AIModelProvider } from '@postmill-ai/nestjs-libraries/ai/ai-model.provider';
import { AiDefaultsService } from '@postmill-ai/nestjs-libraries/ai/defaults/ai-defaults.service';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import type {
  DesignerDoc,
  DesignerElement,
  DesignerGradient,
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
import {
  CONTAINED_RATIO,
  CONTAINER_FILL_RATIO,
  boxOverlapRatio,
  canvasMarginPx,
  computeTextStackBoxes,
  getSafeZoneInset,
  groupKeyOf,
  roleFontFloorPx,
  typeBasisPx,
  typeScaleRatio,
  PANEL_ORIGIN_IDS,
  type GroupBox,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/reflow';
import { subjectPointToFocalPoint } from '@postmill-ai/nestjs-libraries/media/designer-doc/focal-point';
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
  resolveFormatAlias,
  type FormatCandidate,
} from '../../util/format-alias';
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
import { parseOrRepair } from '../../util/parse-or-repair';
import {
  recoupleClippedAdjustments,
  wrapMoveUnitsInGroups,
} from '../../util/layer-groups';
import { markTemplateSlots } from '../../util/template-slots';
import {
  applySlotRecipes,
  emitDecor,
  strengthForDepth,
  treatmentAdjustmentLayers,
} from '../../design-language';
import {
  STAR_LABEL_SAFE_RATIO,
  starVisualBox,
  validateDesignDoc,
} from '../../util/doc-validator';

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

// `fixContrast`'s LAST-RESORT backing band (round 8 / D2), reached only after a
// type halo is already on the glyphs and the audit still fails. A soft vertical
// fade — transparent at both edges — so it never reads as the hard-edged opaque
// slab the old scrim remedy painted over the photograph.
const SOFT_SCRIM_OPACITY = 0.85;
const SOFT_SCRIM_GRADIENT: DesignerGradient = {
  type: 'linear',
  angle: 90,
  stops: [
    { offset: 0, color: 'rgba(0,0,0,0)' },
    { offset: 0.5, color: 'rgba(0,0,0,0.72)' },
    { offset: 1, color: 'rgba(0,0,0,0)' },
  ],
};

// A copy stack filling less than this share of its band is vertically centered
// in it instead of packed against the top (a top-heavy panel over dead space).
const STACK_BALANCE_RATIO = 0.65;

// …but only this far. Geometric centering of a SHORT stack in a tall band is
// itself a defect: it splits the whole leftover in half, so a one-line stack in
// a full-height panel opened a ~300px void between the badge and the copy and
// an equal one below it. Capping the shift lands the block at the OPTICAL
// centre (slightly above the geometric one), which is where copy belongs.
const STACK_BALANCE_MAX_SHIFT = 0.15;

// Per-role type floors as a share of the canvas TYPE BASIS (see `typeBasisPx`
// — the geometric mean, not the short edge), so copy stays legible when the
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

  // The composition gallery names arrangements this file does not implement
  // yet — the layout engine exists but the composer still runs the six
  // templates. Mapping each new id to its nearest built-in means a plan (or a
  // skill's art direction) naming one gets the closest thing rather than
  // silently falling through to the default hero, which would make every genre
  // that prefers a type-led arrangement look identical.
  //
  // These go away when `_buildElements` is switched to the engine.
  'type-dominant': 'minimal-centered',
  'centred-emblem': 'minimal-centered',
  'poster-frame': 'minimal-centered',
  'stacked-thirds': 'top-bottom',
  'overlap-card': 'hero-fullbleed',
  'banner-strip': 'hero-fullbleed',
};

// Per-channel layout intent (plan.channelLayouts) → gallery template.
const CHANNEL_LAYOUT_TEMPLATES: Record<string, LayoutId> = {
  stacked: 'top-bottom',
  'side-by-side': 'split-panel',
  'hero-top': 'hero-fullbleed',
  'minimal-centered': 'minimal-centered',
};

// Headline baseline as a share of the canvas type basis, before the per-layout
// multiplier below.
const BASE_TYPE_RATIO = 0.085;

// Footer/legal copy, by slot role or element originId. It is the one copy role
// whose placement is an EDGE contract rather than a stack position: it hangs
// off the bottom of its band, and the stack above it packs into what is left.
const FOOTER_ROLE_RE = /legal|footer|disclaimer|fine.?print|terms/;

// Headline baseline multiplier per template, applied to typeBasisPx(w,h) * 0.085.
const LAYOUT_TYPE_SCALE: Record<LayoutId, number> = {
  'hero-fullbleed': 1,
  'badge-burst': 0.95,
  'top-bottom': 0.8,
  'split-panel': 0.72,
  'editorial-sidebar': 0.72,
  'minimal-centered': 0.9,
};

// Share of the canvas HEIGHT each gallery layout leaves for its copy stack —
// the vertical budget that bounds the type basis (see `_typeBasisPx`). Read off
// the layout builders: hero stacks from 0.46h to h−margin, badge-burst from
// 0.36h, minimal-centered below a 0.38h image band, top-bottom must clear its
// pinned headline before the 0.35h middle band, and the two panel layouts own
// the full column between the margins.
const LAYOUT_COPY_BAND_RATIO: Record<LayoutId, number> = {
  'hero-fullbleed': 0.49,
  'badge-burst': 0.59,
  'top-bottom': 0.55,
  'split-panel': 0.9,
  'editorial-sidebar': 0.9,
  'minimal-centered': 0.52,
};

// Vertical rhythm of a copy stack as a multiple of the base type size, from
// `_copyStack`: headline box+gap = 2.95, subhead box+gap = 2.25 × ~0.42, CTA
// advance = 2.7 × ~0.3 — 4.705 for the full three-role stack.
//
// ROLE-COUNT AWARE: the flat 4.705 charged every design for a subhead and a
// CTA it may not have, so a headline+subhead pair was budgeted (and therefore
// typeset) 17% smaller than the space it actually occupies.
const STACK_ROLE_HEIGHT = [2.95, 2.25 * 0.42, 2.7 * 0.3];
const stackHeightFactor = (copySlots: number): number => {
  const n = Math.min(
    STACK_ROLE_HEIGHT.length,
    Math.max(1, Math.round(copySlots) || STACK_ROLE_HEIGHT.length)
  );
  return STACK_ROLE_HEIGHT.slice(0, n).reduce((a, b) => a + b, 0);
};

// Where the asset agent's generation prompt told the image model to put the
// subject, per layout intent — the exact mirror of `LAYOUT_TEXT_SPACE` in
// `agents/asset/ai-designer-asset.service.ts`. Normalized 0..1 SUBJECT
// CENTROIDS in source-image space, not crop positions; `_focalPointFor`
// converts. Layouts that ask for a centered subject are omitted (centre is
// already the default). Keep the two tables in lockstep.
//
// These are a GUESS about what the image model did — the only signal on the
// non-risky path, since the offline attention probe was removed (it was wrong
// in the field) and the VLM detector runs only on risky crops
// (`applySubjectFocalPoints`). So they are deliberately timid. The split /
// side-by-side / sidebar prompts do say "place the main subject on the right
// half of the frame", but the model does not honour it: both live generated
// assets measured a centroid of ≈0.517, dead centre. The old 0.75 asserted
// here converted to a saturated focal point and sliced ~26% of the frame off.
// Raise these only with evidence that the model actually complies.
// When is a cover crop worth an AI call? `slack` is the share of the source
// that the crop window CANNOT show along its tight axis. At slack 0 (a
// full-bleed hero: source aspect == box aspect) every pixel survives and the
// focal point is arithmetically inert — asking a VLM there is pure spend. The
// damage grows with the slack, and the conversion amplifies a centroid error
// by `1 / slack`, so the threshold marks where centring stops being safe: a
// square source in a 4:5 portrait discards 20% of its width and survives
// centred, while a square source in a split-panel column (583x1080) discards
// 46% — the live case that cropped 45% off a product. 25% sits between them.
const RISKY_CROP_SLACK_RATIO = 0.25;

// Spend ceiling per composed doc. Lookups are per distinct source image (the
// same picture on five formats is one call), and a plan is capped at 8 asset
// needs, so this only ever bites a pathological doc.
const MAX_SUBJECT_POINT_LOOKUPS = 4;

// A wedged vision provider must not hold up a compose; the crop just stays
// centred.
const SUBJECT_POINT_TIMEOUT_MS = 20_000;

const LAYOUT_SUBJECT_CENTROID: Record<string, { x: number; y: number }> = {
  // "Place the main subject in the upper two-thirds of the frame."
  'hero-fullbleed': { x: 0.5, y: 0.34 },
  'hero-top': { x: 0.5, y: 0.34 },
  // "Place the main subject on the right half of the frame."
  'split-panel': { x: 0.55, y: 0.5 },
  'side-by-side': { x: 0.55, y: 0.5 },
  'editorial-sidebar': { x: 0.55, y: 0.5 },
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
  /** The output's channel preset id — the title-safe area a bottom-anchored
   *  footer has to respect is derived from it. */
  formatId?: string;
  style: ResolvedStyle;
  scale: TypeScalePx;
  /** The output's own SOLID background color, when it has one — the backdrop
   *  copy sits on wherever no panel/image is painted beneath it. Undefined
   *  for image and gradient backgrounds (no single hex to judge). */
  outputBg?: string;
  /** The output's backdrop is a full-bleed IMAGE (not a flat colour, not a
   *  gradient). Copy painted straight onto it needs the over-image treatment
   *  even when the plan carries no image slot — see `_buildElements`' D4
   *  panel→hero redirect. */
  bgIsImage?: boolean;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One element (or one whole group) of a seeded output's copy column, paired
 *  with the box it occupies on the primary — see `refitSeededOutputs`. */
interface RefitUnit {
  members: DesignerElement[];
  /** Combined box on the PRIMARY output (the authored alignment). */
  source: Box;
  /** Combined box on the seeded output, as the reflow left it. */
  box: Box;
  /** Largest font among the unit's members — its vertical rhythm. */
  font: number;
}

const boundingBox = (els: Box[]): Box => {
  const x = Math.min(...els.map((el) => el.x));
  const y = Math.min(...els.map((el) => el.y));
  return {
    x,
    y,
    width: Math.max(...els.map((el) => el.x + el.width)) - x,
    height: Math.max(...els.map((el) => el.y + el.height)) - y,
  };
};

/** `inner` sits inside `box` — by AREA (`CONTAINED_RATIO`), not strictly: a
 *  few px of escape (a doc-validator safe-zone clamp) must not disown a copy
 *  column from the panel it plainly lives in. Same rule as the reflow's panel
 *  containment, so the two passes agree on where an element belongs. */
const containsBox = (box: Box, inner: Box): boolean =>
  boxOverlapRatio(inner, box) >= CONTAINED_RATIO;

/**
 * A solid `#rrggbb`, or undefined for anything else.
 *
 * Deliberately refuses rgba, gradients and named colours: callers use this to
 * recover a palette from a composed document, and a half-understood colour is
 * worse than none — it would ship a recipe built on a value that does not mean
 * what the caller thinks it means.
 */
const parseSolidHexColor = (color: unknown): string | undefined => {
  if (typeof color !== 'string') return undefined;
  const trimmed = color.trim();
  if (!/^#?[0-9a-f]{6}$/i.test(trimmed)) return undefined;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
};

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

  /** Ceiling for any shape a critic fix adds behind copy — see
   *  `_hardenAddedShape`, which is the ONE place both add paths apply it. */
  private static readonly MAX_ADDED_SHAPE_OPACITY = 0.6;

  constructor(
    private readonly _docService: DesignerDocService,
    private readonly _model: AIModelProvider,
    // Only used by `applySubjectFocalPoints`, and only for crops that risk
    // losing the subject — optional so the common compose path (and every
    // unit test) needs no vision provider at all.
    @Optional() private readonly _aiDefaults?: AiDefaultsService
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
      const composed = rawOps
        ? await this._composeFromRawOps(rawOps, outputs, plan, copy, assets)
        : this._composeDeterministic(plan, copy, assets, outputs);
      return {
        doc: await this.applySubjectFocalPoints(
          this.sanitizeDoc(composed, plan).doc,
          input.orgId
        ),
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
    const guarded = this._resolveOverlaps(
      this._linkStyleInvariants(this._stripImageText(doc))
    );
    try {
      const result = validateDesignDoc(guarded, { plan });
      for (const violation of result.violations) {
        this._logger.warn(
          `Doc validator: ${violation}`,
          AiDesignerComposerService.name
        );
      }
      return {
        // Re-couple after the validator: its z-order repair can move a layer
        // between an image and the grade clipped to it, which silently
        // re-points the grade at whatever landed in between.
        doc: this._recoupleAdjustments(this._clampTextToFit(result.doc)),
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
   * Re-fit every SEEDED (non-primary) output to its own canvas.
   *
   * `addOutput` seeds a new format from the primary and `smartReflow` places
   * each element INDEPENDENTLY against the new canvas — every element lands on
   * its own anchor, so the copy column arrives as a scattering of top-, centre-
   * and bottom-anchored pieces with dead bands between them (a live 1080²→
   * 1200×675 x-post measured 26.7% and 24.9% of the canvas height as void),
   * and the margins come out anisotropic (60 horizontal vs 34 vertical) because
   * they were scaled per-axis instead of re-derived.
   *
   * This is a RE-FIT, not a recompose: element identity (ids, originIds),
   * content, styling and z-order are untouched. Only canvas-derived geometry
   * moves — the copy column is re-margined to the target canvas, re-packed with
   * the composer's own vertical rhythm inside the band the badges leave, and
   * balanced with the same `STACK_BALANCE` rule `_copyStack` applies at compose
   * time. Type sizes already arrive re-fit through the shared aspect basis
   * (`typeScaleRatio` in smartReflow); the pack only scales them back when the
   * stack genuinely cannot fit its band, and never below the min-axis size the
   * seed used to produce.
   */
  refitSeededOutputs(doc: DesignerDoc): DesignerDoc {
    const primary = doc.outputs[0];
    if (doc.outputs.length < 2 || !primary || !('children' in primary)) {
      return doc;
    }
    let changed = false;
    const outputs = doc.outputs.map((out, i) => {
      if (i === 0 || !('children' in out)) return out;
      try {
        const refit = this._refitOutput(primary, out);
        if (!refit) return out;
        changed = true;
        return refit;
      } catch (err) {
        this._logger.warn(
          `Seeded-output re-fit skipped for output ${i}: ${(err as Error).message}`,
          AiDesignerComposerService.name
        );
        return out;
      }
    });
    return changed ? ({ ...doc, outputs } as DesignerDoc) : doc;
  }

  /** One output's re-fit — see `refitSeededOutputs`. Returns null when there is
   *  nothing to re-fit (no multi-unit copy column, or the seeded output has
   *  diverged from the primary so the two can no longer be matched up). */
  private _refitOutput(
    primary: DesignerOutput,
    out: DesignerOutput
  ): DesignerOutput | null {
    const key = (el: DesignerElement): string => el.originId || el.id;
    const targetByOrigin = new Map<string, DesignerElement>();
    for (const el of out.children) targetByOrigin.set(key(el), el);

    // The copy column AS AUTHORED on the primary — the same synthetic stack
    // frames the reflow groups a stack by, so a CTA pair or a badge with a
    // deliberate anchor is treated here exactly as it is there.
    const frames = computeTextStackBoxes(primary.children, primary);
    const byFrame = new Map<GroupBox, DesignerElement[]>();
    for (const [el, frame] of frames) {
      const list = byFrame.get(frame);
      if (list) list.push(el);
      else byFrame.set(frame, [el]);
    }
    let stackP: DesignerElement[] = [];
    for (const list of byFrame.values()) {
      if (list.length > stackP.length) stackP = list;
    }
    if (stackP.length < 2) return null;

    const stackT = stackP
      .map((el) => targetByOrigin.get(key(el)))
      .filter((el): el is DesignerElement => !!el);
    const units = this._refitUnits(stackT, primary, key);
    if (units.length < 2) return null;

    // Container: the copy column lives inside a layout panel when the design
    // has one, otherwise the canvas itself.
    const frameP = boundingBox(stackP);
    const panelP = primary.children.find(
      (el) =>
        !!el.originId &&
        PANEL_ORIGIN_IDS.has(el.originId) &&
        containsBox(el, frameP)
    );
    const panelT = panelP ? targetByOrigin.get(key(panelP)) : undefined;
    const containerP: Box =
      panelP && panelT
        ? panelP
        : { x: 0, y: 0, width: primary.width, height: primary.height };
    const containerT: Box =
      panelP && panelT
        ? panelT
        : { x: 0, y: 0, width: out.width, height: out.height };

    // Margins are RE-DERIVED for the target canvas, never scaled: a per-axis
    // scale leaves a frame that reads 60px on one side and 34 on the other.
    const marginP = canvasMarginPx(primary.width, primary.height);
    const marginT = canvasMarginPx(out.width, out.height);
    const colP = {
      x: containerP.x + marginP,
      width: Math.max(1, containerP.width - marginP * 2),
    };
    const colT = {
      x: containerT.x + marginT,
      width: Math.max(1, containerT.width - marginT * 2),
    };

    const patches = new Map<string, Partial<DesignerElement>>();

    // Badges share the copy's frame, so they are re-margined FIRST (a badge
    // left on the seed's per-axis inset sits 60px in while the copy under it
    // starts at 34 — the frame reads crooked) and the band is then carved from
    // where they actually end up.
    const stackIds = new Set(units.flatMap((u) => u.members.map((m) => m.id)));
    const bandTop = containerT.y + marginT;
    const bandBottom = containerT.y + containerT.height - marginT;
    const badgeUnits = this._refitUnits(
      out.children.filter(
        (el) =>
          !stackIds.has(el.id) &&
          !el.hidden &&
          el.type !== 'image' &&
          !(el.originId && PANEL_ORIGIN_IDS.has(el.originId)) &&
          el.width < containerT.width * 0.95 &&
          el.height < containerT.height * 0.95 &&
          (el.type === 'text' ||
            !!el.groupId ||
            !!el.originId?.endsWith('-bg')) &&
          el.x < colT.x + colT.width &&
          el.x + el.width > colT.x
      ),
      primary,
      key
    );
    const badges: Box[] = [];
    // A footer is bottom-anchored like a bottom badge but carves the band from
    // the OTHER end, so it is kept out of the badge list: folded in, the badge
    // bounding box spanned the whole panel (top badge + bottom footer), the
    // carve returned a zero-height band and the whole re-fit was skipped.
    const footers: Box[] = [];
    for (const unit of badgeUnits) {
      const box = { ...unit.box };
      const dx =
        this._placeUnitX(unit, colP, colT, box.width, false, out.width) - box.x;
      // A badge pinned to its container's margin at compose time keeps that
      // relationship: it re-derives to the TARGET margin rather than riding a
      // per-axis scale of the old one.
      const topInsetP = unit.source.y - containerP.y;
      const bottomInsetP =
        containerP.y + containerP.height - (unit.source.y + unit.source.height);
      let y = Math.round(box.y);
      if (Math.abs(topInsetP - marginP) <= 2) y = bandTop;
      else if (Math.abs(bottomInsetP - marginP) <= 2) {
        y = bandBottom - box.height;
      }
      const dy = y - box.y;
      for (const m of unit.members) {
        patches.set(m.id, {
          x: Math.round(m.x + dx),
          y: Math.round(m.y + dy),
        });
      }
      const placed = { ...box, x: box.x + dx, y };
      if (unit.members.some((m) => FOOTER_ROLE_RE.test(key(m).toLowerCase()))) {
        footers.push(placed);
      } else {
        badges.push(placed);
      }
    }

    const fonts = units.map((u) => u.font).filter((f) => f > 0);
    const gapFont = fonts.length ? Math.min(...fonts) : 10;
    const badgeBox = badges.length ? boundingBox(badges) : undefined;
    const band = this._carveCopyBand(
      badges,
      bandTop,
      footers.length
        ? Math.min(
            bandBottom,
            Math.min(...footers.map((f) => f.y)) - Math.round(gapFont * 0.9)
          )
        : bandBottom,
      Math.round(gapFont * 0.9),
      !!badgeBox &&
        badgeBox.y + badgeBox.height / 2 > (bandTop + bandBottom) / 2
    );
    if (band.height <= 0) return null;

    // Fit-to-band: the seeded type is sized by the shared aspect basis, which
    // knows the canvas but not this layout's band. When the packed stack does
    // not fit, the whole column scales back just enough — bounded below by the
    // min-axis size the seed alone would have produced, so a re-fit is never
    // worse than no re-fit.
    const gapAfter = (u: RefitUnit, k: number): number =>
      Math.round((u.font || u.box.height / 2) * k * 0.45);
    const packedHeight = (k: number): number =>
      units.reduce(
        (acc, u, i) =>
          acc +
          Math.max(1, Math.round(u.box.height * k)) +
          (i < units.length - 1 ? gapAfter(u, k) : 0),
        0
      );
    const seedRatio = typeScaleRatio(primary, out);
    const minAxis = Math.min(
      out.width / primary.width,
      out.height / primary.height
    );
    const natural = packedHeight(1);
    const k =
      natural > band.height && natural > 0
        ? Math.max(
            seedRatio > 0 ? Math.min(1, minAxis / seedRatio) : 1,
            band.height / natural
          )
        : 1;

    const consumed = packedHeight(k);
    // Same balance rule as `_copyStack`: a short column packed against the top
    // of a tall band leaves the bottom dead, so it drifts toward the band's
    // OPTICAL centre — capped, because splitting the whole leftover in half is
    // its own defect.
    const shift =
      consumed > 0 && consumed < band.height * STACK_BALANCE_RATIO
        ? Math.min(
            Math.round((band.height - consumed) / 2),
            Math.round(band.height * STACK_BALANCE_MAX_SHIFT)
          )
        : 0;

    let cursor = Math.round(band.y + shift);
    for (const u of units) {
      const unitH = Math.max(1, Math.round(u.box.height * k));
      const fills =
        u.members.length === 1 &&
        u.members[0].type === 'text' &&
        !u.members[0].groupId &&
        u.source.width >= colP.width * CONTAINER_FILL_RATIO;
      const unitW = fills
        ? colT.width
        : Math.max(1, Math.round(u.box.width * k));
      const unitX = this._placeUnitX(u, colP, colT, unitW, fills, out.width);
      for (const m of u.members) {
        const patch: Partial<DesignerElement> = {
          x:
            fills || u.members.length === 1
              ? unitX
              : unitX + Math.round((m.x - u.box.x) * k),
          y: cursor + Math.round((m.y - u.box.y) * k),
        };
        if (fills) {
          patch.width = unitW;
        } else if (k !== 1) {
          patch.width = Math.max(1, Math.round(m.width * k));
        }
        if (k !== 1) {
          patch.height = Math.max(1, Math.round(m.height * k));
          if (m.fontSize) {
            patch.fontSize = Math.max(
              roleFontFloorPx(m, out.width, out.height),
              Math.round(m.fontSize * k)
            );
          }
        }
        patches.set(m.id, patch);
      }
      cursor += unitH + gapAfter(u, k);
    }

    let changed = false;
    const children = out.children.map((el) => {
      const patch = patches.get(el.id);
      if (!patch) return el;
      const next = { ...el, ...patch };
      if (
        next.x === el.x &&
        next.y === el.y &&
        next.width === el.width &&
        next.height === el.height &&
        next.fontSize === el.fontSize
      ) {
        return el;
      }
      changed = true;
      return next;
    });
    return changed ? { ...out, children } : null;
  }

  /** Horizontal placement of one re-fit unit inside the target copy column,
   *  preserving the alignment it was authored with on the primary (the same
   *  centred / tighter-inset rule `smartReflow` places panel contents by). */
  private _placeUnitX(
    unit: RefitUnit,
    colP: { x: number; width: number },
    colT: { x: number; width: number },
    unitW: number,
    fills: boolean,
    canvasW: number
  ): number {
    let x: number;
    if (fills) {
      x = colT.x;
    } else {
      const left = unit.source.x - colP.x;
      const right = colP.x + colP.width - (unit.source.x + unit.source.width);
      const colScale = colT.width / colP.width;
      if (Math.abs(left - right) <= colP.width * 0.02) {
        x = colT.x + Math.round((colT.width - unitW) / 2);
      } else if (left <= right) {
        x = colT.x + Math.round(left * colScale);
      } else {
        x = colT.x + colT.width - Math.round(right * colScale) - unitW;
      }
    }
    return Math.min(Math.max(x, 0), Math.max(0, canvasW - unitW));
  }

  /** Collapse seeded elements into re-fit units — a group (CTA label +
   *  pill/underline, badge chip + label) is ONE unit that moves together —
   *  each paired with the box its members occupy on the primary, which is the
   *  authored alignment the re-fit preserves. A unit whose members have no
   *  primary counterpart (a doc that has diverged, or an element a fix added)
   *  is left where it is rather than half re-fit. */
  private _refitUnits(
    els: DesignerElement[],
    primary: DesignerOutput,
    key: (el: DesignerElement) => string
  ): RefitUnit[] {
    const primaryByOrigin = new Map<string, DesignerElement>();
    for (const el of primary.children) primaryByOrigin.set(key(el), el);
    const groups = new Map<string, DesignerElement[]>();
    const ordered: DesignerElement[][] = [];
    for (const el of els) {
      if (!el.groupId) {
        ordered.push([el]);
        continue;
      }
      const existing = groups.get(el.groupId);
      if (existing) {
        existing.push(el);
        continue;
      }
      const list = [el];
      groups.set(el.groupId, list);
      ordered.push(list);
    }
    const units: RefitUnit[] = [];
    for (const members of ordered) {
      const membersP = members
        .map((el) => primaryByOrigin.get(key(el)))
        .filter((el): el is DesignerElement => !!el);
      if (membersP.length !== members.length) continue;
      units.push({
        members,
        source: boundingBox(membersP),
        box: boundingBox(members),
        font: Math.max(0, ...members.map((m) => m.fontSize || 0)),
      });
    }
    return units.sort((a, b) => a.source.y - b.source.y);
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
   * Linked style invariants across outputs: `align`/`verticalAlign` describe
   * the DESIGN, not one canvas — a format-scoped critic fix that re-aligned a
   * headline on one output only left the same slot left-aligned on one format
   * and centered on another. The primary output (index 0) is the source of
   * truth; every matching `originId` on the secondary outputs is re-synced to
   * it. Text elements only (a shape never carries alignment), and it heals
   * already-saved docs on their next pass through the composer.
   *
   * Only element-for-element LINKED outputs (same `originId` set as the
   * primary — i.e. seeded copies) are synced: an output composed with its own
   * per-channel layout (`plan.channelLayouts`, e.g. a left-aligned split panel
   * next to a centered hero) is a different design and keeps its alignment.
   */
  private _linkStyleInvariants(doc: DesignerDoc): DesignerDoc {
    const primary = doc.outputs[0];
    if (!primary || !('children' in primary) || doc.outputs.length < 2) {
      return doc;
    }
    const styleByOrigin = new Map<
      string,
      { align?: DesignerElement['align']; verticalAlign?: DesignerElement['verticalAlign'] }
    >();
    for (const el of primary.children) {
      if (el.type !== 'text' || !el.originId) continue;
      styleByOrigin.set(el.originId, {
        align: el.align,
        verticalAlign: el.verticalAlign,
      });
    }
    if (styleByOrigin.size === 0) return doc;
    const primaryOrigins = new Set(
      primary.children.map((el) => el.originId).filter(Boolean)
    );

    let changed = false;
    const outputs = doc.outputs.map((out, index) => {
      if (index === 0 || !('children' in out)) return out;
      const origins = new Set(
        out.children.map((el) => el.originId).filter(Boolean)
      );
      const linkedOutput =
        origins.size === primaryOrigins.size &&
        [...origins].every((id) => primaryOrigins.has(id));
      if (!linkedOutput) return out;
      let outChanged = false;
      const children = out.children.map((el) => {
        if (el.type !== 'text' || !el.originId) return el;
        const linked = styleByOrigin.get(el.originId);
        if (!linked) return el;
        if (
          linked.align === el.align &&
          linked.verticalAlign === el.verticalAlign
        ) {
          return el;
        }
        this._logger.warn(
          `Re-linked alignment for slot "${el.originId}" on output "${out.formatId}" to the primary output's (${el.align ?? 'unset'} → ${linked.align ?? 'unset'}).`,
          AiDesignerComposerService.name
        );
        outChanged = true;
        return {
          ...el,
          align: linked.align,
          verticalAlign: linked.verticalAlign,
        } as DesignerElement;
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
   * fails the WCAG ratio for its size class — that MEASUREMENT is good and is
   * the detector. Round 8 (D2) changed only the CURE. The remedy ladder is now,
   * per failing text:
   *
   *   1. Flip the fill to whichever of #FFFFFF/#111111 contrasts with the
   *      sampled backdrop luminance.
   *   2. When neither flat fill passes (busy mid-luma imagery), back the GLYPHS
   *      with a type halo — a zero-offset `textShadow` in the opposite colour.
   *      This is what the good renders in the corpus actually do, and it costs
   *      no pixels of the photograph.
   *   3. Only when a halo is ALREADY on the element and the audit still fails
   *      does a backing shape appear, and it is a SOFT GRADIENT that fades out
   *      at both edges — never the hard-edged opaque slab this used to insert.
   *
   * Painting a flat dark rectangle over the photograph satisfied the predicate
   * and wrecked the design; every good output in the five-round corpus has no
   * scrim at all. This is now the ONLY code path that can add a backing shape.
   *
   * One bounded pass; never throws; returns the (possibly unchanged) doc plus
   * human-readable notes for the conductor's degradation trail.
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

      // A `busy` violation already PASSES the ratio against the sampled mean —
      // flipping the fill only re-picks between two flat colors over the same
      // high-frequency imagery, which is exactly what shipped a headline
      // legible through its text shadow alone. Straight to the halo.
      if (violation.reason !== 'busy' && Math.max(whiteRatio, blackRatio) >= required) {
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

      // Neither flat fill reads (or the audit flagged high-variance imagery
      // under the glyphs). Cure the TYPE, not the photograph: a zero-offset
      // halo in the opposite colour of the fill, blurred at ~0.5em so it reads
      // as a glow rather than an outline.
      const halo = this._contrastHalo(flipped, fontSize);
      const existingShadow = textEl.textShadow;
      const haloAlreadyApplied =
        !!existingShadow &&
        existingShadow.color === halo.color &&
        (existingShadow.blur ?? 0) >= halo.blur;

      if (!haloAlreadyApplied) {
        ops.push({
          op: 'updateElement',
          outputIndex: violation.outputIndex,
          elementId: textEl.id,
          scope: 'format-only',
          patch: { fill: flipped, textShadow: halo },
        });
        notes.push(
          `backed "${label}" with a ${
            flipped === '#FFFFFF' ? 'dark' : 'light'
          } type halo over the imagery`
        );
        continue;
      }

      // Last resort: the halo is already on and the audit STILL fails. Fade a
      // soft gradient band in behind the glyphs — transparent at both edges, so
      // it never reads as the hard-edged slab the old remedy painted.
      const pad = Math.round(fontSize * 0.6);
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
          patch: { x, y, width, height, opacity: SOFT_SCRIM_OPACITY },
        });
        notes.push(`adjusted the soft gradient behind "${label}" over the imagery`);
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
            opacity: SOFT_SCRIM_OPACITY,
            locked: false,
            hidden: false,
            fillGradient: SOFT_SCRIM_GRADIENT,
            originId: scrimOriginId,
          },
        } as DesignerDocOp);
        notes.push(`added a soft gradient behind "${label}" over the imagery`);
      }
      // The text now sits on the darkened band — its fill must read against it.
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
        finding.formatId,
        targetOutputs
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
              slotScope.flatMap((id) => [
                id,
                `${id}-bg`,
                `${id}-underline`,
                `${id}-shadow`,
              ])
            )
          : undefined;

        for (const el of out.children) {
          // Whitelist keys against the strict updateElement patch schema — a
          // single LLM-invented key (e.g. `color`) would otherwise zod-reject
          // the whole ops array and silently discard every valid fix.
          const patch: Partial<DesignerElement> = {};
          if (fix.geometry && geometryTargetIds?.has(el.originId || el.id)) {
            const rawPicked = this._pickPatchKeys(fix.geometry, GEOMETRY_PATCH_KEYS, 'number');
            // A shared-scope box is authored against the PRIMARY output and
            // used to be written verbatim to every other one, so a fix that
            // moved a headline to y=800 landed off-canvas on a 675-tall
            // output. Re-fit it (sizes through the shared type basis,
            // positions per-axis) before it is applied anywhere else.
            const picked =
              fix.scope === 'shared' && doc.outputs[0] && doc.outputs[0] !== out
                ? this._scaleGeometryToOutput(
                    rawPicked,
                    doc.outputs[0],
                    out,
                    el
                  )
                : rawPicked;
            // The fix box is authored for the LABEL. Writing it verbatim to
            // the `-bg`/`-underline` companions collapses the label/shape
            // inset (pill box === label box, byte-identical) — a companion
            // gets a box re-derived from the label's patched box instead.
            const companionOf = slotScope?.find(
              (id) =>
                (el.originId || el.id) === `${id}-bg` ||
                (el.originId || el.id) === `${id}-underline` ||
                (el.originId || el.id) === `${id}-shadow`
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
          // Design-language repairs. Without these the critic can SEE that a
          // photograph fights the palette and has no way to ask for the grade
          // that fixes it, so it re-requests a geometry nudge every round.
          if (targetIds?.has(el.originId || el.id)) {
            Object.assign(patch, this._designLanguagePatch(fix, el, out));
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
   * applyFixes/revise: (1) a label drifted inside its `${slotId}-bg` shape is
   * re-centered, (2) text spilling outside that shape is re-clamped inside and
   * shrunk to fit, (3) text running off the left/right canvas edge is pulled
   * back on-canvas (shrinking the box when it is wider than the canvas), (4)
   * text-on-text and badge/CTA-shape-on-text collisions are separated by
   * nudging the later element below the earlier one, inside the title-safe
   * area, (5) a copy stack left out of role order (headline/subhead/CTA) by a
   * cascade is re-packed top-down. The whole sweep runs as a bounded fixpoint
   * (up to 2 passes) so a group nudged by a LATER collider is re-tested
   * against the earlier ones. Anything it cannot resolve is logged as a
   * degradation note — it NEVER throws, and returns the SAME doc reference
   * when nothing needed fixing.
   */
  private _resolveOverlaps(doc: DesignerDoc): DesignerDoc {
    try {
      let changed = false;
      const outputs = doc.outputs.map((out) => {
        if (!('children' in out)) return out;
        let children: DesignerElement[] | null = null;
        const currentChildren = (): DesignerElement[] =>
          children ?? out.children;
        const replace = (index: number, el: DesignerElement) => {
          if (!children) children = [...out.children];
          children[index] = el;
          changed = true;
        };
        const currentAt = (index: number): DesignerElement =>
          currentChildren()[index];

        // Placement is bounded by the title-safe area, not the raw canvas: a
        // nudge that lands a subhead flush with the bottom edge is "resolved"
        // on paper and cropped by the platform's UI chrome in the feed.
        const safe = getSafeZoneInset(out.formatId || '', out.width, out.height);
        // Near-touching pairs (gap under ~8px at a 1080×1080 canvas, scaled by
        // the geometric mean of the canvas sides — min(w,h) collapsed to 5px
        // on 1200×675 landscapes) between unrelated elements count as
        // collisions so groups keep breathing room.
        const minGap = Math.max(
          2,
          Math.round((Math.sqrt(out.width * out.height) / 1080) * 8)
        );
        // A star badge only paints its five points — its AABB corners are
        // empty. Colliding against the raw box nudged copy that was nowhere
        // near a glyph, so every collider is resolved through its VISIBLE box.
        const colliderBox = (el: DesignerElement): Box =>
          el.type === 'shape' && el.shape === 'star'
            ? starVisualBox(el)
            : { x: el.x, y: el.y, width: el.width, height: el.height };

        // Bounded fixpoint: one pass separates each element from the elements
        // placed BEFORE it, so a group pushed by a later collider can drift
        // back onto an earlier one. Re-run while something moved, capped at 2.
        for (let pass = 0; pass < 2; pass++) {
          let moved = false;
          // Re-read every pass: a group nudged in the previous pass moved its
          // `-bg` shape too, and a stale box would "spill" its own label.
          const shapesByOrigin = new Map<string, DesignerElement>();
          for (const el of currentChildren()) {
            if (el.type === 'shape' && el.originId?.endsWith('-bg')) {
              shapesByOrigin.set(el.originId, el);
            }
          }

          // (1) Label re-center: reflow clamps and collision nudges can leave
          // a label flush against (or drifted inside) its `${slotId}-bg`
          // shape. Re-center each visible label horizontally in its shape's
          // CURRENT box — vertically too for middle-aligned labels and star
          // bursts. Only the label moves, never the shape. Runs BEFORE the
          // collision loop so a re-centered label is re-validated by it.
          {
            const current = currentChildren();
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
              moved = true;
            }
          }

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

            // (2) Text spilling outside its containing shape: clamp the box
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
              moved = true;
            }

            // (3) Canvas-edge clamp (x/width): text hanging off the left or
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
                moved = true;
              }
            }

            // (4) Collision pass: text-on-text, plus badge/CTA `*-bg` shapes
            // covering a text outside their own group (a starburst over the
            // headline). The moving unit is the text's whole GROUP — the label
            // and its `${slotId}-bg` / `${slotId}-underline` companions (shared
            // groupId, or the companion originId convention) translate by the
            // same delta, so a nudge never rips a label out of its pill.
            // Placement: below the collider's group first, above it when there
            // is no room below (both bounded by the title-safe area); when
            // neither fits a TEXT collider, the group is reordered to paint
            // behind the collider instead of overlapping.
            const nextKey = groupKeyOf(next);
            const groupIndexes: number[] = [];
            for (let m = 0; m < out.children.length; m++) {
              if (m === i || (nextKey && groupKeyOf(currentAt(m)) === nextKey)) {
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
                const movedMember = { ...member, y: member.y + deltaY };
                replace(m, movedMember);
                const p = placed.findIndex((entry) => entry.index === m);
                if (p >= 0) placed[p].el = movedMember;
              }
            };

            for (const entry of placed) {
              const other = entry.el;
              // Own-group members (the pill under its label) never collide.
              if (nextKey && groupKeyOf(other) === nextKey) continue;
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
              const otherBox = colliderBox(other);
              const otherKey = groupKeyOf(other);
              let colliderTop = otherBox.y;
              let colliderBottom = otherBox.y + otherBox.height;
              if (otherKey) {
                for (const peer of placed) {
                  if (groupKeyOf(peer.el) !== otherKey) continue;
                  const peerBox = colliderBox(peer.el);
                  colliderTop = Math.min(colliderTop, peerBox.y);
                  colliderBottom = Math.max(
                    colliderBottom,
                    peerBox.y + peerBox.height
                  );
                }
              }

              let hit = this._boxesOverlap(next, otherBox);
              if (!hit) {
                // Near-touch: boxes separated by less than the minimum gap.
                const dx = Math.max(
                  otherBox.x - (next.x + next.width),
                  next.x - (otherBox.x + otherBox.width),
                  0
                );
                const dy = Math.max(
                  otherBox.y - (next.y + next.height),
                  next.y - (otherBox.y + otherBox.height),
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
              if (box.y + box.height + belowDelta <= safe.bottom) {
                this._logger.warn(
                  `Overlap guard: text "${next.text.slice(0, 40)}" overlapped ${otherLabel} — nudged its group down by ${belowDelta}px.`,
                  AiDesignerComposerService.name
                );
                moveGroup(belowDelta);
                next = { ...next, y: next.y + belowDelta };
                replace(i, next);
                moved = true;
                continue;
              }
              const aboveDelta = colliderTop - gap - (box.y + box.height);
              if (box.y + aboveDelta >= safe.top) {
                this._logger.warn(
                  `Overlap guard: text "${next.text.slice(0, 40)}" overlapped ${otherLabel} with no room below — moved its group above it.`,
                  AiDesignerComposerService.name
                );
                moveGroup(aboveDelta);
                next = { ...next, y: next.y + aboveDelta };
                replace(i, next);
                moved = true;
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

          // (5) Copy-stack order: within a column, headline sits above
          // subhead sits above CTA. A "no room below — moved above" cascade
          // can invert that (a subhead landing under its own CTA), which no
          // pairwise collision test can see.
          if (this._enforceStackOrder(out, safe, minGap, currentChildren, replace)) {
            moved = true;
          }

          if (!moved) break;
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

  /** Copy-stack roles the order assertion pins, by slot id convention.
   *  Footer/legal copy ranks LAST: without a rank it fell out of the column
   *  entirely, so a re-pack could leave it above the CTA it must sit under. */
  private _stackRoleOf(el: DesignerElement): 0 | 1 | 2 | 3 | undefined {
    const id = (el.originId || el.id || '').toLowerCase();
    if (FOOTER_ROLE_RE.test(id)) return 3;
    if (/cta|button|action/.test(id)) return 2;
    if (/headline|title|hero/.test(id)) return 0;
    if (/sub|caption|body|desc|tagline/.test(id)) return 1;
    return undefined;
  }

  /**
   * Assert headline → subhead → CTA vertical order for the visible copy of
   * each column (texts whose x-ranges overlap). A violated column is re-packed
   * top-down inside the title-safe area, moving whole groups (a CTA label
   * keeps its pill/underline). Returns whether anything moved.
   */
  private _enforceStackOrder(
    out: DesignerOutput,
    safe: { top: number; bottom: number },
    minGap: number,
    currentChildren: () => DesignerElement[],
    replace: (index: number, el: DesignerElement) => void
  ): boolean {
    const current = currentChildren();
    const entries = current
      .map((el, index) => ({ el, index, rank: this._stackRoleOf(el) }))
      .filter(
        (e): e is { el: DesignerElement; index: number; rank: 0 | 1 | 2 | 3 } =>
          e.rank !== undefined &&
          e.el.type === 'text' &&
          !!e.el.text &&
          !e.el.hidden &&
          !e.el.rotation
      );
    if (entries.length < 2) return false;

    const columns: (typeof entries)[] = [];
    for (const entry of entries) {
      const column = columns.find((c) =>
        c.some(
          (o) =>
            Math.min(o.el.x + o.el.width, entry.el.x + entry.el.width) -
              Math.max(o.el.x, entry.el.x) >
            0
        )
      );
      if (column) column.push(entry);
      else columns.push([entry]);
    }

    let moved = false;
    for (const rawColumn of columns) {
      if (rawColumn.length < 2) continue;
      // Re-read: an earlier column's re-pack may have moved a shared group.
      const column = rawColumn.map((e) => ({
        ...e,
        el: currentChildren()[e.index],
      }));
      const byY = [...column].sort((a, b) => a.el.y - b.el.y);
      const inOrder = byY.every(
        (entry, idx) => idx === 0 || byY[idx - 1].rank <= entry.rank
      );
      if (inOrder) continue;

      // Re-pack the column top-down in role order, whole groups at a time.
      const ordered = [...column].sort(
        (a, b) => a.rank - b.rank || a.el.y - b.el.y
      );
      const seenGroups = new Set<string>();
      const units: { indexes: number[]; box: Box }[] = [];
      for (const entry of ordered) {
        const key = groupKeyOf(entry.el) || `#${entry.index}`;
        if (seenGroups.has(key)) continue;
        seenGroups.add(key);
        const indexes: number[] = [];
        for (let m = 0; m < current.length; m++) {
          const memberKey = groupKeyOf(current[m]);
          if (m === entry.index || (memberKey && memberKey === key)) {
            indexes.push(m);
          }
        }
        const members = indexes.map((m) => currentChildren()[m]);
        const x = Math.min(...members.map((m) => m.x));
        const y = Math.min(...members.map((m) => m.y));
        units.push({
          indexes,
          box: {
            x,
            y,
            width: Math.max(...members.map((m) => m.x + m.width)) - x,
            height: Math.max(...members.map((m) => m.y + m.height)) - y,
          },
        });
      }
      const gap = minGap + 2;
      const total =
        units.reduce((sum, unit) => sum + unit.box.height, 0) +
        gap * (units.length - 1);
      let top = Math.min(...units.map((unit) => unit.box.y));
      top = Math.min(
        Math.max(top, safe.top),
        Math.max(safe.top, safe.bottom - total)
      );
      this._logger.warn(
        `Overlap guard: copy stack out of order (${ordered
          .map((e) => e.el.originId || e.el.id)
          .join(' → ')}) — re-packed top-down from y=${Math.round(top)}.`,
        AiDesignerComposerService.name
      );
      for (const unit of units) {
        const delta = Math.round(top - unit.box.y);
        if (delta !== 0) {
          for (const m of unit.indexes) {
            const member = currentChildren()[m];
            replace(m, { ...member, y: member.y + delta });
          }
          moved = true;
        }
        top += unit.box.height + gap;
      }
    }
    return moved;
  }

  private _boxInside(el: DesignerElement, shape: DesignerElement): boolean {
    return (
      el.x >= shape.x - 1 &&
      el.y >= shape.y - 1 &&
      el.x + el.width <= shape.x + shape.width + 1 &&
      el.y + el.height <= shape.y + shape.height + 1
    );
  }

  private _boxesOverlap(a: Box, b: Box): boolean {
    return (
      a.x < b.x + b.width - 2 &&
      a.x + a.width > b.x + 2 &&
      a.y < b.y + b.height - 2 &&
      a.y + a.height > b.y + 2
    );
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
      'You may also emit {"op":"addElement","outputIndex":<n>,"element":{...}} with a constrained TEXT element (type:"text", x, y, width, height, rotation: 0, opacity: 1, locked: false, hidden: false, plus text, fontSize, fill, align, textStroke, textShadow, originId), or {"op":"removeElement","outputIndex":<n>,"elementId":"<existing id>"} to delete an element. Do NOT add shape elements: scrims, plates and bands behind copy are rejected. When text is hard to read over imagery, patch the TEXT — set its fill and give it a textShadow.',
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

    // Plain parse first (op arrays carry https:// URLs that repair()'s
    // string-unaware comment strip would mangle); repair() then throws
    // UnrepairableError when the reply is not salvageable (e.g. a refusal) —
    // that is "no valid ops", so the doc stays unchanged.
    let repaired: unknown;
    try {
      repaired = await parseOrRepair(DesignerDocOpsSchema, raw);
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
          const hardened = this._hardenAddedShape(
            element,
            out,
            'an LLM-added'
          );
          if (!hardened) continue;
          filtered.push({
            ...op,
            element: this._boundAddedElement(hardened.element, out),
            ...(hardened.beforeElementId
              ? { beforeElementId: hardened.beforeElementId }
              : {}),
          } as DesignerDocOp);
          continue;
        }
        // Every OTHER added element is bounded too. The critic adds elements
        // the deterministic layout system has no model for — a `legal` line
        // on a plan with no legal slot is the live case — and NOTHING else
        // bounds them: the overlap guard's canvas-edge clamp is x-only, its
        // collision pass needs an actual overlap, and a lone footer line has
        // none. That is how a 30px legal box shipped at y=1050 on a 1080
        // canvas, flush with the bottom edge.
        filtered.push({
          ...op,
          element: this._boundAddedElement(element, out),
        } as DesignerDocOp);
        continue;
      }

      filtered.push(op);
    }
    return filtered;
  }

  /**
   * The `-bg` / `-underline` element an added companion belongs to, when it
   * exists on this output. A shape with no base is free-floating.
   */
  private _companionBaseFor(
    originId: string | undefined,
    out: DesignerOutput
  ): DesignerElement | undefined {
    const id = originId || '';
    const baseId = id.endsWith('-bg')
      ? id.slice(0, -'-bg'.length)
      : id.endsWith('-underline')
      ? id.slice(0, -'-underline'.length)
      : undefined;
    if (!baseId) return undefined;
    return out.children.find((c) => (c.originId || c.id) === baseId);
  }

  /**
   * The hardening EVERY critic-added shape must pass, whichever path built it.
   *
   * There are two of those paths — `_filterReviseOps` (freeform re-emitted ops)
   * and `_buildAddElementOps` (the typed `fix.addElement` spec) — and each
   * round's shape rule kept landing on one of them: round 4's 0.6 opacity cap
   * went only to the filter, so the typed path still hardcoded `opacity: 1` and
   * shipped a fully-opaque backing plate. One helper, both callers.
   *
   * Returns null when the shape must be DROPPED:
   * - free-floating (round 8 D2): no `-bg`/`-underline` base on this output.
   *   A paired companion is bounded by its base's box and cannot stack; a
   *   free-floating plate is the backing slab that buried the photograph.
   * - no resolvable fill: the renderer defaults a fill-less shape to solid
   *   BLACK, so an unfilled plate is the very defect, arriving by omission.
   *
   * Otherwise the opacity is capped and the shape is placed under the copy.
   */
  private _hardenAddedShape<
    T extends {
      originId?: string;
      opacity?: number;
      fill?: unknown;
      fillGradient?: unknown;
    }
  >(
    element: T,
    out: DesignerOutput,
    label: string
  ): { element: T; beforeElementId?: string } | null {
    const originId = element.originId || '';
    if (!this._companionBaseFor(originId, out)) {
      this._logger.log(
        `Dropping ${label} free-floating shape ("${originId || 'unnamed'}"): backing plates are no longer a sanctioned remedy.`,
        AiDesignerComposerService.name
      );
      return null;
    }
    const hasFill =
      (typeof element.fill === 'string' && element.fill.trim().length > 0) ||
      (!!element.fillGradient && typeof element.fillGradient === 'object');
    if (!hasFill) {
      this._logger.log(
        `Dropping ${label} shape ("${originId || 'unnamed'}"): no resolvable fill, which the renderer paints as solid black.`,
        AiDesignerComposerService.name
      );
      return null;
    }
    // A companion shape must never paint OVER the copy: insert it just before
    // the output's first real text element instead of appending it topmost.
    const firstText = out.children.find(
      (c) =>
        c.type === 'text' &&
        !c.hidden &&
        typeof c.text === 'string' &&
        c.text.trim().length > 0
    );
    return {
      element: {
        ...element,
        opacity: Math.min(
          element.opacity ?? 1,
          AiDesignerComposerService.MAX_ADDED_SHAPE_OPACITY
        ),
      },
      ...(firstText ? { beforeElementId: firstText.id } : {}),
    };
  }

  /**
   * Clamp an LLM-added element's box into its output.
   *
   * TEXT is bounded by the TITLE-SAFE area, not the raw canvas: "on canvas"
   * is not the same as "not under the platform's UI chrome", and a critic-
   * added line is placed by a model that never saw the layout grid. Every
   * other type keeps the raw canvas — a scrim is SUPPOSED to be able to bleed
   * to the edge.
   */
  private _boundAddedElement(
    element: DesignerElement,
    out: DesignerOutput
  ): DesignerElement {
    const finite = (v: unknown): v is number =>
      typeof v === 'number' && Number.isFinite(v);
    if (
      !finite(element.x) ||
      !finite(element.y) ||
      !finite(element.width) ||
      !finite(element.height) ||
      !finite(out.width) ||
      !finite(out.height)
    ) {
      return element;
    }
    const width = Math.min(element.width, out.width);
    const height = Math.min(element.height, out.height);
    // Per axis, and only where the box FITS the safe area (the same rule
    // `smartReflow` applies) — a full-bleed box keeps the canvas rather than
    // being shrunk out of its own layout.
    const safe =
      element.type === 'text'
        ? getSafeZoneInset(out.formatId || '', out.width, out.height)
        : undefined;
    const bounds = {
      left: safe && width <= safe.right - safe.left ? safe.left : 0,
      right: safe && width <= safe.right - safe.left ? safe.right : out.width,
      top: safe && height <= safe.bottom - safe.top ? safe.top : 0,
      bottom:
        safe && height <= safe.bottom - safe.top ? safe.bottom : out.height,
    };
    return {
      ...element,
      width,
      height,
      x: Math.min(
        Math.max(element.x, bounds.left),
        Math.max(bounds.left, bounds.right - width)
      ),
      y: Math.min(
        Math.max(element.y, bounds.top),
        Math.max(bounds.top, bounds.bottom - height)
      ),
    };
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
    // Resolved BEFORE the elements: the layouts validate plan-supplied text
    // fills against whatever is painted beneath them, and outside a panel
    // that is this background.
    const bg = this._backgroundToDesignerBg(
      plan.background,
      assets,
      primaryPreset,
      plan.variantId,
      plan.assetNeeds?.length ?? 0
    );
    const primaryOpts = {
      outputBg: bg.bg ? undefined : bg.background,
      bgIsImage: bg.bg?.type === 'image',
    };
    const primaryElements = this._buildElements(
      plan,
      copy,
      assets,
      primaryPreset,
      layout,
      style,
      primaryOpts
    );

    const primaryOutput: DesignerOutput = {
      id: '',
      formatId: primaryPreset.formatId,
      name: primaryPreset.name || primaryPreset.formatId,
      width: primaryPreset.width,
      height: primaryPreset.height,
      background: bg.background,
      bg: bg.bg,
      // The rule this output's type was sized under, so the seeded formats are
      // re-fit from the basis the primary actually composed at — not from the
      // unbounded geometric mean (see `typeBasisPx`).
      typeBudget: this._typeBudget(
        this._effectiveLayout(plan, layout, primaryOpts),
        this._stackSlotCount(plan)
      ),
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
      const buildOpts = {
        heroTop: intent === 'hero-top',
        // Seeded from the primary, so this output carries the same
        // background; an image/gradient one has no single hex to judge.
        outputBg: out.bg ? undefined : out.background,
        bgIsImage: out.bg?.type === 'image',
      };
      const children = this._buildElements(
        plan,
        copy,
        assets,
        outputs[i],
        template,
        style,
        buildOpts
      ).map((el) => ({ ...el, id: randomUUID() }));
      // Composed fresh with a different template — so is its type budget.
      const typeBudget = this._typeBudget(
        this._effectiveLayout(plan, template, buildOpts),
        this._stackSlotCount(plan)
      );
      next = {
        ...next,
        outputs: next.outputs.map((o, idx) =>
          idx === i ? { ...o, children, typeBudget } : o
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
    // Plain parse first (see _llmReviseOps — repair() mangles https:// URLs);
    // repair() then throws UnrepairableError on unsalvageable input — fall
    // through to the deterministic compose instead of aborting the variant.
    let repaired: unknown = null;
    try {
      repaired = await parseOrRepair(DesignerDocOpsSchema, rawOps);
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
    const margin = canvasMarginPx(w, h);
    const fontSize = Math.max(MIN_FONT_SIZE_PX, Math.round(Math.min(w, h) * 0.08));

    // The fallback is triggered by a copy/layout failure — assets that DID
    // generate still resolve here (same variant-scoped → slotId:aspect →
    // slotId → any-aspect lookup as the primary compose), so a copy-side
    // failure doesn't also lose the imagery.
    const bg = this._backgroundToDesignerBg(
      plan.background,
      assets,
      primaryPreset,
      plan.variantId,
      plan.assetNeeds?.length ?? 0
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
    // Alignment is a TEXT property — a shape carrying `align` is noise that
    // then propagates as a linked style invariant across every output.
    if (
      el.type === 'text' &&
      (style.align === 'left' || style.align === 'center' || style.align === 'right')
    ) {
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

  /**
   * The type halo `fixContrast` reaches for when neither flat fill reads over
   * the imagery: zero offset (so it haloes rather than skews the glyph) in the
   * opposite colour of the fill, blurred at ~0.5em. Deliberately stronger and
   * rounder than `_defaultShadow`, which is a decorative offset drop shadow.
   */
  private _contrastHalo(fill: string, fontSize: number): DesignerTextShadow {
    return {
      color: fill === '#FFFFFF' ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.85)',
      blur: Math.max(4, Math.round(fontSize * 0.5)),
      offsetX: 0,
      offsetY: 0,
    };
  }

  /** `[surface, ink, accent]` recovered from a composed output. */
  private _paletteFromOutput(out: DesignerOutput, el: DesignerElement): string[] {
    const surface = parseSolidHexColor(out.background) || '#ffffff';
    const ink = parseSolidHexColor(el.fill) || (hexLuminance(surface) < 0.5 ? '#ffffff' : '#111111');
    const accent =
      out.children
        .map((c) => parseSolidHexColor(c.fill))
        .find((c): c is string => !!c && c !== surface && c !== ink) || ink;
    return [surface, ink, accent];
  }

  /**
   * The document fields a critic's design-language fix contributes.
   *
   * Deliberately narrow: a fix may re-grade, re-mask, re-blend or add an effect
   * to an element that already exists. It may NOT introduce an adjustment
   * LAYER, because inserting a layer mid-repair would re-point every clipped
   * grade below it — the treatment here therefore applies through the element's
   * own filter stack, which needs no ordering.
   */
  private _designLanguagePatch(
    fix: Fix,
    el: DesignerElement,
    out: DesignerOutput
  ): Partial<DesignerElement> {
    if (!fix.effects && !fix.treatment && !fix.mask && !fix.blend) return {};

    const kind: 'text' | 'image' | 'shape' | 'other' =
      el.type === 'text'
        ? 'text'
        : el.type === 'image'
          ? 'image'
          : el.type === 'shape'
            ? 'shape'
            : 'other';
    const basis =
      kind === 'text'
        ? el.fontSize || Math.min(el.width, el.height)
        : Math.min(el.width, el.height);

    // A repair runs long after the style preset has been resolved away, so the
    // palette is recovered from the document itself. Without it every
    // critic-applied effect would fall back to black-and-white and quietly
    // undo the brand colour the plan chose.
    const surface = parseSolidHexColor(out.background);
    const backdrop: 'light' | 'dark' =
      surface && hexLuminance(surface) < 0.5 ? 'dark' : 'light';

    const patch = applySlotRecipes(
      { effects: fix.effects, treatment: fix.treatment, mask: fix.mask, blend: fix.blend },
      { width: el.width, height: el.height },
      { basis, palette: this._paletteFromOutput(out, el), backdrop, kind },
      el.text
    );

    // Freeze the original the first time a stack is attached, exactly as the
    // build path does — otherwise the next re-bake reads already-filtered
    // pixels and the effect compounds.
    if (patch.smartFilters?.length && el.src && !el.originalSrc) {
      patch.originalSrc = el.src;
      if (el.fileId) patch.originalFileId = el.fileId;
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
   * Re-fit a primary-output px type size onto another output through the
   * shared aspect-aware basis (`typeScaleRatio` — the same rule as smartReflow,
   * applyLinked and the variant re-fit), floored at 10px. Using
   * `min(scaleX, scaleY)` here re-imposed short-edge typography on every wider
   * output the moment a shared-scope fix landed.
   */
  private _scaleFontSizeToOutput(
    fontSize: number,
    doc: DesignerDoc,
    out: DesignerOutput
  ): number {
    const primary = doc.outputs[0];
    if (!primary || primary === out) return fontSize;
    return Math.max(10, Math.round(fontSize * typeScaleRatio(primary, out)));
  }

  /**
   * Re-fit a primary-authored geometry patch (a shared-scope critic fix, or an
   * addElement box) onto another output.
   *
   * SIZES ride the shared type basis — same helper as every other cross-output
   * adjustment. POSITIONS ride each axis's own fraction: a shared "move the
   * headline to y=800" is a position in the primary's 1080 column, and the
   * uniform basis would land it at 666 on a 675-tall output — off-canvas once
   * the box height is added. The re-fit box is finally clamped inside the
   * target canvas so no fix can push an element off the edge.
   */
  private _scaleGeometryToOutput(
    picked: Record<string, unknown>,
    source: { width: number; height: number },
    target: { width: number; height: number },
    current?: Pick<DesignerElement, 'x' | 'y' | 'width' | 'height'>
  ): Record<string, unknown> {
    if (source.width === target.width && source.height === target.height) {
      return picked;
    }
    const sizeScale = typeScaleRatio(source, target);
    const num = (key: string): number | undefined =>
      typeof picked[key] === 'number' ? (picked[key] as number) : undefined;
    const out: Record<string, unknown> = { ...picked };
    const width = num('width');
    const height = num('height');
    const fontSize = num('fontSize');
    if (width !== undefined) out.width = Math.round(width * sizeScale);
    if (height !== undefined) out.height = Math.round(height * sizeScale);
    if (fontSize !== undefined) {
      out.fontSize = Math.max(10, Math.round(fontSize * sizeScale));
    }
    const x = num('x');
    const y = num('y');
    if (x !== undefined) out.x = Math.round(x * (target.width / source.width));
    if (y !== undefined) out.y = Math.round(y * (target.height / source.height));

    // Clamp the re-fit box on-canvas, filling missing sides from the element
    // the patch lands on (a patch carrying only `y` still has to respect the
    // element's own height).
    const boxW = (out.width as number | undefined) ?? current?.width ?? 0;
    const boxH = (out.height as number | undefined) ?? current?.height ?? 0;
    if (out.x !== undefined) {
      out.x = Math.min(
        Math.max(out.x as number, 0),
        Math.max(0, target.width - boxW)
      );
    }
    if (out.y !== undefined) {
      out.y = Math.min(
        Math.max(out.y as number, 0),
        Math.max(0, target.height - boxH)
      );
    }
    return out;
  }

  /**
   * Companion half of a slot-scoped geometry fix: the fix box targets the
   * LABEL, so a `${slotId}-bg` shape re-derives x/width from the label's
   * patched box via the badge inset convention (insetX = round(fontSize ×
   * 0.6), symmetric — see `_badgeElements`), a `${slotId}-underline` bar
   * keeps the label's x/width with its y sitting below the label, and a
   * `${slotId}-shadow` rect (the neobrutalism CTA's offset solid shadow)
   * keeps the label's box shifted by the compose-time offset. Only keys the
   * fix actually carries are derived; a missing label falls back to the raw
   * patch (better than detaching the pair).
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
      if (picked.y !== undefined || picked.height !== undefined) {
        // Below the label's BOTTOM, same offset as compose time — a rule
        // derived from the label's TOP lands inside the copy, across its
        // descenders.
        patch.y =
          merged.y + merged.height + this._underlineOffset(fontSize);
      }
      // The rule's own height is never the label's: a geometry fix that
      // resized the label must not fatten a hairline into a slab.
      if (picked.height !== undefined) {
        patch.height = this._underlineThickness(fontSize);
      }
      return patch;
    }
    if ((companion.originId || companion.id).endsWith('-shadow')) {
      // The shadow IS the button box, offset — the button box is the label
      // box exactly (see `_ctaElements`), so no inset applies here.
      const offset = this._ctaShadowOffset(fontSize);
      if (picked.x !== undefined) patch.x = merged.x + offset;
      if (picked.y !== undefined) patch.y = merged.y + offset;
      if (picked.width !== undefined) patch.width = merged.width;
      if (picked.height !== undefined) patch.height = merged.height;
      return patch;
    }
    if (companion.type === 'shape' && companion.shape === 'star') {
      // A star is NOT a pill: its label lives in the inner `STAR_LABEL_SAFE`
      // box, not inset by a font-derived padding. Running the pill convention
      // on one re-derived the frame from the label's own aspect on every pass
      // — the measured 1.22:1 → 2.04 → 2.75 → 4.59 ratchet. Invert
      // `starVisualBox` instead, and keep the frame SQUARE (a star's glyph is).
      const side = Math.round(
        Math.max(merged.width, merged.height) / STAR_LABEL_SAFE_RATIO
      );
      if (picked.width !== undefined) patch.width = side;
      if (picked.height !== undefined) patch.height = side;
      if (picked.x !== undefined) {
        patch.x = Math.round(merged.x - (side - merged.width) / 2);
      }
      if (picked.y !== undefined) {
        patch.y = Math.round(merged.y - (side - merged.height) / 2);
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

      const refit =
        scope === 'shared' && primary && primary !== out
          ? (box: Record<string, number>) =>
              this._scaleGeometryToOutput(box, primary, out) as Record<
                string,
                number
              >
          : (box: Record<string, number>) => box;

      let x: number;
      let y: number;
      let width: number;
      let height: number;
      if (spec.box) {
        // Explicit boxes are authored against the primary output and re-fit
        // through the shared basis (sizes) / per-axis fractions (positions).
        const authored: Record<string, number> = {};
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          const value = spec.box[key];
          if (typeof value === 'number') authored[key] = value;
        }
        const box = refit(authored);
        // Anything the spec left out defaults to the TARGET canvas's own
        // centered band — a default is not an authored value, so it is never
        // re-fit.
        width = Math.round(box.width ?? out.width * 0.6);
        height = Math.round(box.height ?? out.height * 0.12);
        x = Math.round(box.x ?? (out.width - width) / 2);
        y = Math.round(box.y ?? (out.height - height) / 2);
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

      // A genuinely-new companion (`${base}-bg` / `${base}-underline`) whose
      // base element exists joins the base's move group so overlap nudges
      // and reflow keep the new pair glued.
      const base = this._companionBaseFor(spec.slotId, out);

      // The new pair's shared move unit. An UNGROUPED base (a bare headline —
      // most copy slots carry no groupId) used to leave the companion with
      // none either, so it reflowed on its own `deriveAnchor` thirds instead
      // of the base's stack frame: a `headline-accent-rule` seeded from a
      // banner landed dead centre on the story, striking through the headline.
      // Backfilling the group onto the base is what glues them.
      const groupId = base
        ? base.groupId ??
          (spec.slotId.endsWith('-bg')
            ? spec.slotId.slice(0, -'-bg'.length)
            : spec.slotId.slice(0, -'-underline'.length))
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
        ...(groupId ? { groupId } : {}),
      };

      if (spec.type === 'text') {
        element.text = spec.text;
        if (
          typeof spec.style?.fontSize === 'number' &&
          Number.isFinite(spec.style.fontSize)
        ) {
          element.fontSize = Math.max(
            10,
            Math.round(refit({ fontSize: spec.style.fontSize }).fontSize)
          );
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
          // No authored size to derive the shadow from: fall back to the
          // canvas frame unit, which tracks the TYPE BASIS rather than the
          // short edge (a 1584×396 banner used to fall back to 20px).
          element.textShadow = this._defaultShadow(
            (element.fontSize as number) ?? canvasMarginPx(out.width, out.height)
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

      // Shared with `_filterReviseOps` — the typed path used to hardcode
      // `opacity: 1` and skip round 4's cap entirely because the rule only ever
      // landed on the other copy.
      let beforeElementId: string | undefined;
      if (spec.type === 'shape') {
        const hardened = this._hardenAddedShape(element, out, 'an addElement fix\'s');
        if (!hardened) continue;
        Object.assign(element, hardened.element);
        beforeElementId = hardened.beforeElementId;
      }

      // Backfilling the group onto the base glues the new pair — emitted only
      // once the companion itself is known to survive hardening, so a dropped
      // shape never leaves a stray patch behind.
      if (base && !base.groupId && groupId) {
        ops.push({
          op: 'updateElement',
          outputIndex,
          elementId: base.id,
          scope: 'format-only',
          patch: { groupId },
        });
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

  /**
   * Output indexes a fix applies to.
   *
   * A `format-only` fix used to return `[]` (a silent no-op behind a
   * `logger.warn`) whenever its `formatId` was missing or unknown — and
   * nothing derived one from the request's `targetOutputs`, so a format-scoped
   * revision whose classifier volunteered no per-finding formatId simply did
   * nothing. Now the request's own target list is the fallback source, and an
   * unresolvable format degrades to SHARED scope: applying the user's change
   * everywhere is wrong-ish, applying it nowhere is useless.
   */
  private _resolveTargetOutputIndexes(
    doc: DesignerDoc,
    scope: Fix['scope'],
    formatId?: string,
    targetOutputs?: string[]
  ): number[] {
    const all = () => doc.outputs.map((_, i) => i);
    if (scope !== 'format-only') return all();

    const candidates = [formatId, ...(targetOutputs ?? [])].filter(
      (id): id is string => !!id
    );
    for (const candidate of candidates) {
      // Alias-aware (see `canResolveFormatScope`): the two resolvers MUST agree
      // or the conductor promises a scope the composer then ignores.
      const resolved = resolveFormatAlias(
        candidate,
        AiDesignerComposerService._formatCandidates(doc)
      );
      const idx = resolved
        ? doc.outputs.findIndex((o) => o.formatId === resolved)
        : -1;
      if (idx >= 0) return [idx];
    }

    this._logger.warn(
      candidates.length === 0
        ? 'format-only fix carried no formatId; falling back to shared scope.'
        : `format-only fix named no known output (${candidates.join(', ')}); falling back to shared scope.`,
      AiDesignerComposerService.name
    );
    return all();
  }

  /**
   * Whether a `format-only` request can actually be pinned to an output of
   * this doc. The conductor calls it to decide between honouring the scope and
   * degrading to shared WITH a note the user sees — `_resolveTargetOutputIndexes`
   * makes the same call internally but has no channel to say so.
   *
   * Both go through `resolveFormatAlias`: users say "Facebook" and "the story",
   * never "fb-post" / "ig-story", and strict id equality degraded every one of
   * those to shared scope.
   */
  canResolveFormatScope(doc: DesignerDoc, targetOutputs?: string[]): boolean {
    const candidates = AiDesignerComposerService._formatCandidates(doc);
    return (targetOutputs ?? []).some((formatId) =>
      Boolean(resolveFormatAlias(formatId, candidates))
    );
  }

  /** The doc's outputs as alias-resolution candidates (id + display name). */
  private static _formatCandidates(doc: DesignerDoc): FormatCandidate[] {
    return doc.outputs.map((out) => ({
      formatId: out.formatId,
      name: out.name,
    }));
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

  /**
   * The gallery template an output is ACTUALLY composed with — the D4 redirect
   * (a panel layout with no image slot over a full-canvas backdrop is a hero)
   * resolved once, so `_buildElements` and the `typeBudget` stamp can never
   * disagree about which layout's budget the type was sized under.
   */
  private _effectiveLayout(
    plan: DesignPlan,
    layout: LayoutId,
    opts: { outputBg?: string }
  ): LayoutId {
    const isPanelLayout =
      layout === 'split-panel' || layout === 'editorial-sidebar';
    if (!isPanelLayout || opts.outputBg !== undefined) return layout;
    const imageSlot = plan.slots.find(
      (s) => s.kind === 'image' || s.role === 'image'
    );
    return imageSlot ? layout : 'hero-fullbleed';
  }

  /** How many copy slots actually stack (badges and footers are placed on
   *  their own edges, so they are not part of the stack's vertical rhythm). */
  private _stackSlotCount(plan: DesignPlan): number {
    const copySlots = plan.slots.filter(
      (s) => isCopySlot(s) && s.role !== 'image'
    );
    return copySlots.filter((s, i) => {
      const role = this._slotRole(s, i);
      return role !== 'badge' && role !== 'legal';
    }).length;
  }

  /**
   * The vertical budget of this design's copy stack, as a multiple of the
   * canvas HEIGHT — the parameter `typeBasisPx` bounds the geometric mean
   * with, and the one number the reflow needs to measure a re-fit's two
   * canvases the way this compose measured them (it is stamped on every
   * composed output as `typeBudget`).
   *
   * The layout's copy band divided by the stack's own rhythm: whatever share
   * of the height the band leaves has to hold `stackHeightFactor` base-type
   * multiples of copy.
   */
  private _typeBudget(layout: LayoutId, stackSlots: number): number {
    return (
      LAYOUT_COPY_BAND_RATIO[layout] /
      (stackHeightFactor(stackSlots) * BASE_TYPE_RATIO * LAYOUT_TYPE_SCALE[layout])
    );
  }

  /**
   * The canvas size this output's type is derived from.
   *
   * The shared aspect-aware basis (`typeBasisPx` — the geometric mean of the
   * canvas sides, so a 1200×675 is typeset for 900 rather than for its 675
   * short edge), bounded by the VERTICAL BUDGET the chosen layout leaves: on a
   * 4:1 banner the geometric mean would size a headline whose full stack no
   * longer fits the copy band. Floored at `min(w, h)` — the pre-basis value —
   * so the budget can only ever pull the type back to what it used to be,
   * never below it.
   */
  private _typeBasisPx(
    w: number,
    h: number,
    layout: LayoutId,
    stackSlots: number
  ): number {
    return typeBasisPx(w, h, this._typeBudget(layout, stackSlots));
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
    const basis = this._typeBasisPx(w, h, layout, this._stackSlotCount(plan));
    const base = basis * BASE_TYPE_RATIO * LAYOUT_TYPE_SCALE[layout];
    const ratios = style.preset.typeScale;
    const px = (key: keyof TypeScalePx): number => {
      const floor = Math.max(
        MIN_FONT_SIZE_PX,
        Math.round(basis * ROLE_FLOOR_RATIO[key])
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
    if (FOOTER_ROLE_RE.test(role)) return 'legal';
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
      /** Solid color painted directly beneath this text (panel surface or
       *  output background) — a plan-supplied fill is validated against it.
       *  Omit when the backdrop is imagery/unknown. */
      backdrop?: string;
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
    const planFill = override.fill ?? override.gradient?.[0];
    // A plan-supplied fill is validated against what will actually be painted
    // beneath it — the same guard `_resolveAccent` makes for shapes. The
    // planner repeatedly emitted text in its own background color (#FFFFFF on
    // a #FFFFFF panel surface) and only the doc validator caught it. An
    // explicit `opts.fill` (the badge/CTA computed label) still wins: it is
    // already contrast-derived.
    const fill =
      opts.fill ??
      (planFill && opts.backdrop
        ? contrastRatio(planFill, opts.backdrop) >= MIN_CONTRAST_RATIO
          ? planFill
          : this._contrastOn(opts.backdrop, ctx.style)
        : planFill) ??
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
      // Leading belongs to the size of the type, not to the document. 1.1 is
      // right for a display headline, where tight leading is the whole look,
      // and wrong for everything else: a two-line subhead or a legal line set
      // solid reads as a block rather than as lines, which is the single most
      // common way otherwise-correct copy looks amateur.
      lineHeight: isDisplay ? 1.1 : 1.35,
      letterSpacing: isDisplay ? treatments.letterSpacing || 0 : undefined,
      textStroke,
      textShadow,
      verticalAlign: opts.verticalAlign,
      groupId: opts.groupId,
      originId: slot.id,
    } as DesignerElement;
  }

  /** Gap between an underline-CTA label box and its accent rule. */
  private _underlineOffset(fontSize: number): number {
    return Math.max(2, Math.round(fontSize * 0.12));
  }

  /** Thickness of an underline-CTA accent rule (a hairline, never a slab). */
  private _underlineThickness(fontSize: number): number {
    return Math.max(2, Math.round(fontSize * 0.07));
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
    const treatments = ctx.style.preset.treatments;
    const ctaStyle = override.ctaStyle ?? treatments.ctaStyle;
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
      // Text-only CTA with an accent underline bar. The bar sits BELOW the
      // label box — inside it, the rule cuts through the descenders of the
      // copy it is supposed to underline.
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
        y: box.y + box.height + this._underlineOffset(fontSize),
        width,
        height: this._underlineThickness(fontSize),
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
    // One shared `round(height * 0.14)` used to serve every non-pill CTA, so
    // the presets whose promptFragment demands hard edges (neobrutalism's
    // "hard-edged rectangle", minimal's "plain rectangular CTA") shipped a
    // 9px radius. The corner treatment is per-preset now.
    const radius = ctaStyle === 'pill' ? 'pill' : treatments.ctaRadius ?? 'small';
    const borderRadius =
      radius === 'pill'
        ? Math.round(height / 2)
        : radius === 'square'
        ? 0
        : Math.round(height * 0.14);
    // Neobrutalism's prompt promises "a thick border and an offset solid
    // shadow"; neither ever rendered (stroke was set only on the outline
    // branch, and the renderer has no shape drop-shadow — the shadow has to
    // be its own offset rect behind the button).
    const hardBorder = !outline && treatments.ctaBorder === true;
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
      borderRadius,
      stroke: outline ? accent : hardBorder ? ctx.style.text : undefined,
      strokeWidth: outline
        ? Math.max(2, Math.round(fontSize * 0.09))
        : hardBorder
        ? Math.max(2, Math.round(fontSize * 0.12))
        : undefined,
      groupId: slot.id,
      originId: `${slot.id}-bg`,
    } as DesignerElement;

    // A filled button paints the accent, so the label is judged against the
    // accent. An OUTLINE button paints nothing inside its box — the label sits
    // on whatever is behind it — yet the label fill equalled the stroke accent
    // by construction, so the pair was never checked against anything. That
    // shipped a #FF00E5 label inside a #FF00E5 stroked box over a magenta
    // photo at 1.73:1. Validate the accent against the surface the button
    // sits on and fall back to a readable label when it fails; the render-time
    // audit stays the backstop for imagery it cannot see here.
    const backdrop = ctx.style.surface;
    const labelFill = outline
      ? contrastRatio(accent, backdrop) >= MIN_CONTRAST_RATIO
        ? accent
        : this._contrastOn(backdrop, ctx.style)
      : this._contrastOn(accent, ctx.style);

    const text = this._styledTextElement(slot, 'cta', rawText, box, ctx, {
      // The label always centers inside the button shape (align only
      // positions the pill within its area); box === shape box exactly.
      align: 'center',
      verticalAlign: 'middle',
      fill: labelFill,
      groupId: slot.id,
    });

    if (!outline && treatments.ctaShadow === true) {
      const offset = this._ctaShadowOffset(fontSize);
      const shadow: DesignerElement = {
        id: '',
        type: 'shape',
        shape: 'rect',
        x: box.x + offset,
        y: box.y + offset,
        width: box.width,
        height: box.height,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        fill: ctx.style.text,
        borderRadius,
        groupId: slot.id,
        originId: `${slot.id}-shadow`,
      } as DesignerElement;
      // Behind the button, and grouped with it so the overlap guard and the
      // geometry fan-out move the whole stack together.
      return [shadow, shape, text];
    }
    return [shape, text];
  }

  /** Offset of a neobrutalism CTA's solid drop shadow, in px. */
  private _ctaShadowOffset(fontSize: number): number {
    return Math.max(3, Math.round(fontSize * 0.18));
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
      /** `opts.align` was resolved from `plan.badgePosition` — a PLACEMENT
       *  CONTRACT, so it outranks the art director's per-slot `style.align`
       *  (which it emits on essentially every slot, silently overruling the
       *  plan's own corner: 8 of 9 outputs in one live run rendered the badge
       *  dead centre). */
      alignIsContract?: boolean;
    } = {}
  ): DesignerElement[] {
    // ROUND 8 (D1): `burst` RESOLVES TO A PILL. Across five render rounds every
    // output carrying a star badge was worse than its pill equivalent without a
    // single exception: the square star frame deforms on each re-fit (measured
    // 1.22:1 → 2.04 → 2.75 → 4.59 across passes), and its label spills past the
    // points — the case that kept the doc-validator's clamp→shrink→grow→revert
    // ladder running 18 times in one run and still shipped illegible seals.
    // The enum value is deliberately KEPT in the types/schemas/presets so stored
    // plans and `_extractBriefConstraints`' "starburst" detection still parse;
    // it just never reaches a star on the happy path.
    const requestedBadgeStyle =
      slot.style?.badgeStyle ??
      opts.badgeStyle ??
      ctx.style.preset.treatments.badgeStyle ??
      'pill';
    const badgeStyle = requestedBadgeStyle === 'burst' ? 'pill' : requestedBadgeStyle;
    const accent = this._resolveAccent(slot.style?.fill, ctx.style);
    const fontSize = Math.max(12, Math.round(ctx.scale.cta * 0.85));
    const align =
      (opts.alignIsContract ? opts.align : slot.style?.align ?? opts.align) ??
      'center';

    const padX = Math.round(fontSize * 1.1);
    // Estimate on the generous side (0.66 em/char) so heavy display fonts and
    // wide glyphs (%, !) don't overflow the pill and clip.
    const width = Math.min(area.width, Math.round(rawText.length * fontSize * 0.66) + padX * 2);
    const height = Math.round(fontSize * 2);
    let x = area.x;
    if (align === 'center') x = area.x + Math.round((area.width - width) / 2);
    else if (align === 'right') x = area.x + area.width - width;
    const box: Box = { x, y: area.y, width, height };

    const shape: DesignerElement = {
      id: '',
      type: 'shape',
      shape: 'rect',
      ...box,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      fill: accent,
      borderRadius:
        badgeStyle === 'pill' ? Math.round(height / 2) : Math.round(height * 0.12),
      groupId: slot.id,
      originId: `${slot.id}-bg`,
    } as DesignerElement;

    // The label sits inside the shape with a horizontal inset so glyphs never
    // touch or clip the edge.
    const insetX = Math.round(fontSize * 0.6);
    const textBox: Box = {
      x: box.x + insetX,
      y: box.y,
      width: Math.max(10, box.width - insetX * 2),
      height: Math.max(10, box.height),
    };
    // Auto-fit: shrink the font (same 60%/8px floor as the renderer's
    // shrink-to-fit) until the estimated wrap fits the inner box — badge text
    // must never spill outside its shape.
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
    output: { width: number; height: number; formatId?: string },
    layout: LayoutId,
    style: ResolvedStyle,
    opts: { heroTop?: boolean; outputBg?: string; bgIsImage?: boolean } = {}
  ): DesignerElement[] {
    const w = output.width;
    const h = output.height;
    const margin = canvasMarginPx(w, h);

    const imageSlot = plan.slots.find(
      (s) => s.kind === 'image' || s.role === 'image'
    );

    // ROUND 8 (D4): THE BACKDROP MUST COVER THE FULL CANVAS.
    //
    // The two panel layouts open with an opaque `style.surface` slab over one
    // column. That slab IS the layout when an image slot fills the other column.
    // But when the plan carries NO image slot the imagery lives on `output.bg`
    // and already covers the whole canvas — and the slab then paints a flat
    // colour block over 38–46% of the photograph with a hard vertical seam,
    // while the copy (re-centred on the canvas by the re-fit) does not even sit
    // inside it. That is the r7 banner/yt/igstory family, the three worst
    // renders in the corpus.
    //
    // `outputBg` is undefined exactly when the output carries a real `bg`
    // (image or gradient), so this is the precise "backdrop already fills the
    // canvas" test. There, a panel layout IS a hero — compose it as one, which
    // is a layout the corpus shows we do well. (Shared with the `typeBudget`
    // stamp — see `_effectiveLayout`.)
    const effectiveLayout = this._effectiveLayout(plan, layout, opts);

    const scale = this._typeScalePx(plan, style, w, h, effectiveLayout);
    const ctx: ComposeContext = {
      plan,
      copy,
      assets,
      w,
      h,
      margin,
      formatId: output.formatId,
      style,
      scale,
      outputBg: opts.outputBg,
      bgIsImage: opts.bgIsImage,
    };
    const copySlots = plan.slots.filter(
      (s) => isCopySlot(s) && s.role !== 'image'
    );
    const roles = new Map<string, SlotRole>(
      copySlots.map((s, i) => [s.id, this._slotRole(s, i)])
    );
    const badgeSlots = copySlots.filter((s) => roles.get(s.id) === 'badge');
    // Footer/legal copy is split out of the stack the same way badges are: it
    // is bottom-anchored, and the stack's band is carved above its measured
    // extent. Left in `textSlots` it packed as just another line under the
    // CTA, which is how the layout system ended up with no model for the one
    // element the vision critic likes to add.
    const legalSlots = copySlots.filter((s) => roles.get(s.id) === 'legal');
    const textSlots = copySlots.filter((s) => {
      const role = roles.get(s.id);
      return role !== 'badge' && role !== 'legal';
    });
    // Accent shapes paint behind text (they are pushed before text elements
    // in every layout below).
    const accents = plan.slots
      .filter((s) => s.kind === 'accent-shape')
      .map((s, i) => this._accentShapeElement(s, i, ctx));

    let elements: DesignerElement[];
    switch (effectiveLayout) {
      case 'split-panel':
        elements = this._layoutSplitPanel(ctx, imageSlot, textSlots, badgeSlots, legalSlots, accents, roles);
        break;
      case 'top-bottom':
        elements = this._layoutTopBottom(ctx, imageSlot, textSlots, badgeSlots, legalSlots, accents, roles);
        break;
      case 'badge-burst':
        elements = this._layoutBadgeBurst(ctx, imageSlot, textSlots, badgeSlots, legalSlots, accents, roles);
        break;
      case 'editorial-sidebar':
        elements = this._layoutEditorialSidebar(ctx, imageSlot, textSlots, badgeSlots, legalSlots, accents, roles);
        break;
      case 'minimal-centered':
        elements = this._layoutMinimalCentered(ctx, imageSlot, textSlots, badgeSlots, legalSlots, accents, roles);
        break;
      case 'hero-fullbleed':
      default:
        elements = this._layoutHero(ctx, imageSlot, textSlots, badgeSlots, legalSlots, accents, roles, opts.heroTop);
        break;
    }

    const withOrigins = elements.map((el) => ({
      ...el,
      originId: el.originId || el.id,
    }));

    const styled = this._applyDesignLanguage(withOrigins, ctx);

    // Companions already share a `groupId` so they travel together through a
    // re-fit; this gives them a real folder as well, so the design opens in the
    // Designer as a CTA rather than as two unrelated rows in the layers panel.
    //
    // Runs LAST, after every geometry pass in this method has finished: a
    // container is zero-sized by design (its extent is derived from its
    // members), so anything that takes a bounding box over the children would
    // drag the box back to the origin.
    // Decoration goes UNDER everything: a mark that lands on top of a headline
    // is not decoration. Placed after the copy exists so a rule can attach to
    // the headline it belongs to rather than to a guessed band.
    const headline = styled.find(
      (el) => el.type === 'text' && (el.originId || '').includes('headline')
    );
    const decorated = [
      ...emitDecor(ctx.plan.decor, {
        canvas: { width: w, height: h },
        margin,
        headline: headline
          ? { x: headline.x, y: headline.y, width: headline.width, height: headline.height }
          : undefined,
        palette: ctx.style.palette,
      }),
      ...styled,
    ];

    // Declare the fillable fields last, so a delivered design opens straight
    // into the Designer's Template Fill panel instead of as a canvas of loose
    // layers the user has to hunt through.
    const marked = markTemplateSlots(decorated, ctx.plan.slots);

    return wrapMoveUnitsInGroups(marked, { genId: () => `grp-${randomUUID()}` });
  }

  /**
   * Keep every clipped adjustment directly above the layer it grades.
   *
   * Returns the doc UNCHANGED — same reference — when nothing moved.
   * `sanitizeDoc` is called on paths whose contract is "no edits means the same
   * object back", and several callers compare by identity to decide whether a
   * re-render is needed; allocating unconditionally would make every one of
   * them think the document had changed.
   */
  private _recoupleAdjustments(doc: DesignerDoc): DesignerDoc {
    let moved = false;
    const outputs = doc.outputs.map((out) => {
      if (!('children' in out) || !Array.isArray(out.children)) return out;
      const children = recoupleClippedAdjustments(out.children);
      if (children === out.children) return out;
      moved = true;
      return { ...out, children };
    });
    return moved ? ({ ...doc, outputs } as DesignerDoc) : doc;
  }

  /**
   * Apply the plan's named recipes to the elements that were just built.
   *
   * A post-pass keyed by `originId` rather than an argument threaded through
   * nine element factories: the factories are about geometry, and the design
   * language is about surface. Keeping them apart is what stops every new
   * recipe kind from touching every builder.
   *
   * Runs BEFORE the group wrap, so an image and the adjustment layers clipped
   * to it end up inside the same folder.
   */
  private _applyDesignLanguage(
    elements: DesignerElement[],
    ctx: ComposeContext
  ): DesignerElement[] {
    const slots = new Map(ctx.plan.slots.map((s) => [s.id, s]));
    if (!slots.size) return elements;

    const strength = strengthForDepth(ctx.plan.depth);
    const backdrop: 'light' | 'dark' = ctx.style.surfaceIsDark ? 'dark' : 'light';
    const out: DesignerElement[] = [];

    for (const el of elements) {
      const slot = el.originId ? slots.get(el.originId) : undefined;
      if (!slot) {
        out.push(el);
        continue;
      }

      const kind: 'text' | 'image' | 'shape' | 'other' =
        el.type === 'text' ? 'text' : el.type === 'image' ? 'image' : el.type === 'shape' ? 'shape' : 'other';

      // Effect geometry scales from the TYPE for text and from the box
      // otherwise. A headline's shadow belongs to its letterforms; deriving it
      // from a 1200x200 banner box would shadow 96px type as if it were 200px.
      const basis = kind === 'text' ? el.fontSize || Math.min(el.width, el.height) : Math.min(el.width, el.height);

      const patch = applySlotRecipes(
        slot,
        { width: el.width, height: el.height },
        { basis, palette: ctx.style.palette, backdrop, kind, strength },
        el.text
      );

      const next = { ...el, ...patch } as DesignerElement;

      // Freeze the pre-filter pixels the moment a stack is attached. Nothing
      // has been baked yet, so `src` IS the original — but saying so explicitly
      // is what lets the client re-bake later without having to guess, and
      // stops the first parameter tweak in the Designer from evaluating the
      // stack over its own output.
      if (next.smartFilters?.length && next.src && !next.originalSrc) {
        next.originalSrc = next.src;
        if (next.fileId) next.originalFileId = next.fileId;
      }

      out.push(next);

      // An adjustment is a LAYER, not a property, so it is emitted above the
      // image it grades rather than folded into it.
      if (kind === 'image') {
        out.push(...treatmentAdjustmentLayers(slot, next, { palette: ctx.style.palette, strength }));
      }
    }

    return out;
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
    legalSlots: DesignSlot[],
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

    // Copy sits on imagery either because this layout painted an image element,
    // or because the canvas backdrop IS a full-bleed photo (the D4 redirect
    // lands panel layouts here with no image slot).
    const onImage = (!!imageSlot || !!ctx.bgIsImage) && !heroTop;
    this._pushBadges(ctx, elements, badgeSlots, roles, {
      x: margin,
      y: margin,
      width: w - margin * 2,
      bottom: h - margin,
    });

    const backdrop = onImage ? undefined : ctx.outputBg;
    const footers = this._pushFooter(ctx, elements, legalSlots, roles, {
      x: margin,
      width: w - margin * 2,
      bottom: this._footerBottom(ctx),
    }, { align: 'center', onImage, backdrop });

    const stackY = heroTop ? Math.round(h * 0.58) : Math.round(h * 0.46);
    elements.push(
      ...this._copyStack(ctx, textSlots, roles, {
        x: margin,
        y: stackY,
        width: w - margin * 2,
        height: this._bandBottom(ctx, footers, h - margin) - stackY,
      }, { align: 'center', onImage, backdrop, centerInBand: footers.length > 0 })
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
    legalSlots: DesignSlot[],
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
    // The copy column, inside the title-safe area (see `_safeColumn`).
    const col = this._safeColumn(ctx, panelX + margin, panelW - margin * 2);
    const badges = this._pushBadges(ctx, elements, badgeSlots, roles, {
      ...col,
      y: margin,
      bottom: h - margin,
    }, 'left');
    const footers = this._pushFooter(ctx, elements, legalSlots, roles, {
      ...col,
      bottom: this._footerBottom(ctx),
    }, { align: 'left', backdrop: style.surface });
    const band = this._copyBand(ctx, badges, margin, h - margin, footers);
    elements.push(
      ...this._copyStack(ctx, textSlots, roles, {
        ...col,
        y: band.y,
        height: band.height,
        // The copy sits on the panel — a plan fill equal to the surface is
        // invisible text, so the stack validates against it.
      }, { align: 'left', backdrop: style.surface, centerInBand: footers.length > 0 })
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
    legalSlots: DesignSlot[],
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
      bottom: h - margin,
    });

    const onImage = !!imageSlot;
    // Over the fullbleed image there is no flat color to judge a plan fill
    // against; without one the copy sits on the output background.
    const backdrop = onImage ? undefined : ctx.outputBg;
    const footers = this._pushFooter(ctx, elements, legalSlots, roles, {
      x: margin,
      width: w - margin * 2,
      bottom: this._footerBottom(ctx),
    }, { align: 'center', onImage, backdrop });
    // The pinned bottom slot hangs off whatever edge the footer left.
    const bottomEdge = this._bandBottom(ctx, footers, h - margin);
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
          { align: 'center', onImage, backdrop }
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
        }, { align: 'center', onImage, backdrop })
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
            { x: margin, y: bottomEdge - Math.round(fontSize * 2.4), width: w - margin * 2 },
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
              y: bottomEdge - Math.round(fontSize * 2.5),
              width: w - margin * 2,
              height: Math.round(fontSize * 2.5),
            },
            ctx,
            { align: 'center', onImage, backdrop }
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
    legalSlots: DesignSlot[],
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
    // The badge IS this layout's centerpiece, so it is forced and centered —
    // but as a PILL, not a star (see `_badgeElements`, round 8 / D1). The
    // template keeps its `badge-burst` id: skills and stored plans reference it.
    this._pushBadges(ctx, elements, badgeSlots, roles, {
      x: margin,
      y: Math.round(h * 0.14),
      width: w - margin * 2,
    }, 'center', 'pill', true);
    const backdrop = onImage ? undefined : ctx.outputBg;
    const footers = this._pushFooter(ctx, elements, legalSlots, roles, {
      x: margin,
      width: w - margin * 2,
      bottom: this._footerBottom(ctx),
    }, { align: 'center', onImage, backdrop });
    const stackY = Math.round(h * 0.36);
    elements.push(
      ...this._copyStack(ctx, textSlots, roles, {
        x: margin,
        y: stackY,
        width: w - margin * 2,
        height: this._bandBottom(ctx, footers, h - margin) - stackY,
      }, { align: 'center', onImage, backdrop, centerInBand: footers.length > 0 })
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
    legalSlots: DesignSlot[],
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
    // The copy column, inside the title-safe area (see `_safeColumn`).
    const col = this._safeColumn(ctx, sidebarX + margin, sidebarW - margin * 2);
    const badges = this._pushBadges(ctx, elements, badgeSlots, roles, {
      ...col,
      y: margin,
      bottom: h - margin,
    }, 'left');
    const footers = this._pushFooter(ctx, elements, legalSlots, roles, {
      ...col,
      bottom: this._footerBottom(ctx),
    }, { align: 'left', backdrop: style.surface });
    const band = this._copyBand(ctx, badges, margin, h - margin, footers);
    elements.push(
      ...this._copyStack(ctx, textSlots, roles, {
        ...col,
        y: band.y,
        height: band.height,
        // Same guard as split-panel: the copy sits on the sidebar surface.
      }, { align: 'left', backdrop: style.surface, centerInBand: footers.length > 0 })
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
    legalSlots: DesignSlot[],
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
      bottom: h - margin,
    }, 'center');
    const footers = this._pushFooter(ctx, elements, legalSlots, roles, {
      x: margin,
      width: w - margin * 2,
      bottom: this._footerBottom(ctx),
    }, { align: 'center', backdrop: ctx.outputBg });

    // Center the stack vertically in the space below the image.
    const stackH = this._stackHeight(ctx, textSlots, roles);
    const availTop =
      imageBottom +
      (badgeSlots.length && !this._badgeAtBottom(ctx)
        ? Math.round(ctx.scale.cta * 2.6)
        : 0);
    const bandBottom = this._bandBottom(ctx, footers, h - margin);
    // Centered against the canvas, or against the footer's edge when one took
    // the bottom of it.
    const startY = Math.max(
      availTop,
      Math.round(((footers.length ? bandBottom : h) - stackH) / 2),
    );
    elements.push(
      ...this._copyStack(ctx, textSlots, roles, {
        x: margin,
        y: startY,
        width: w - margin * 2,
        height: bandBottom - startY,
        // The stack always starts below the image band, so its backdrop is
        // the output background.
      }, { align: 'center', noStroke: true, verticalAlign: 'middle', backdrop: ctx.outputBg })
    );
    return elements;
  }

  // ---------------------------------------------------------------------
  // Shared stack helpers
  // ---------------------------------------------------------------------

  /** True when `plan.badgePosition` parks the badge on its band's BOTTOM edge
   *  — the copy stack then reclaims the top reservation it normally makes. */
  private _badgeAtBottom(ctx: ComposeContext): boolean {
    return (
      ctx.plan.badgePosition === 'bottom-left' ||
      ctx.plan.badgePosition === 'bottom-right'
    );
  }

  /**
   * Place the badge slots inside their layout band (the text panel for
   * split/sidebar layouts, the full canvas otherwise). `plan.badgePosition`
   * overrides the template's hardcoded corner: the horizontal half picks the
   * alignment, a bottom corner parks the badge block on `area.bottom`.
   * `ignorePlanPosition` is for badge-burst, where the badge IS the layout.
   *
   * Returns the elements it appended, so a caller can carve their MEASURED
   * extent out of its copy band.
   */
  private _pushBadges(
    ctx: ComposeContext,
    elements: DesignerElement[],
    badgeSlots: DesignSlot[],
    roles: Map<string, SlotRole>,
    area: { x: number; y: number; width: number; bottom?: number },
    align: 'left' | 'center' | 'right' = 'right',
    badgeStyle?: 'pill' | 'burst' | 'ribbon',
    ignorePlanPosition = false
  ): DesignerElement[] {
    const position = ignorePlanPosition ? undefined : ctx.plan.badgePosition;
    const resolvedAlign = !position
      ? align
      : position === 'center'
      ? 'center'
      : position.endsWith('right')
      ? 'right'
      : 'left';
    const advance = Math.round(ctx.scale.cta * 2.6);
    const built: DesignerElement[] = [];
    badgeSlots.forEach((slot, i) => {
      const text = this._slotText(ctx.copy, slot, ctx.plan, i);
      if (!text) return;
      built.push(
        ...this._badgeElements(
          slot,
          text,
          { x: area.x, y: area.y + i * advance, width: area.width },
          ctx,
          { align: resolvedAlign, badgeStyle, alignIsContract: !!position }
        )
      );
    });
    // Bottom corners: translate the built block so its real extent (a burst is
    // square, not `advance` tall) rests on the band's bottom edge.
    if (
      built.length > 0 &&
      area.bottom !== undefined &&
      (position === 'bottom-left' || position === 'bottom-right')
    ) {
      const extent = Math.max(...built.map((el) => el.y + el.height));
      const delta = area.bottom - extent;
      if (delta !== 0) {
        for (const el of built) el.y += delta;
      }
    }
    // A plan-authored corner is a placement CONTRACT — stamp it on every
    // member so a reflow to another aspect re-resolves the SAME corner instead
    // of re-deriving one from canvas thirds. Those two disagree whenever the
    // badge lives in a panel: a panel's right edge sits inside the canvas's
    // LEFT third, which is how a `top-right` badge landed left. `center`
    // carries no vertical half, so it keeps the derived anchor.
    if (position && position !== 'center') {
      for (const el of built) el.anchor = position;
    }
    elements.push(...built);
    return built;
  }

  /**
   * Place the footer/legal slots on the BOTTOM edge of their band — the same
   * bottom-corner translate `_pushBadges` does for a bottom-anchored badge.
   *
   * Legal copy is the one copy role whose position is an edge contract, so it
   * is placed by the layout rather than packed into the copy stack. The band
   * bottom is the canvas margin, pulled up to the title-safe area when the
   * format has platform chrome down there (a story's CTA bar).
   *
   * Returns the elements it appended, so the caller can carve their MEASURED
   * extent out of its copy band — without that carve `_copyStack`'s balance
   * pass centres the copy in a band that still spans the footer, which is
   * exactly how a 429px (39.7% of canvas height) dead vertical band opened up
   * above a live `legal` line.
   */
  private _pushFooter(
    ctx: ComposeContext,
    elements: DesignerElement[],
    legalSlots: DesignSlot[],
    roles: Map<string, SlotRole>,
    area: { x: number; width: number; bottom: number },
    opts: {
      align?: 'left' | 'center' | 'right';
      onImage?: boolean;
      backdrop?: string;
    } = {}
  ): DesignerElement[] {
    if (!legalSlots.length) return [];
    const built: DesignerElement[] = [];
    let y = 0;
    legalSlots.forEach((slot, i) => {
      const text = this._slotText(ctx.copy, slot, ctx.plan, i);
      if (!text) return;
      const role = roles.get(slot.id) || 'legal';
      const fontSize = this._roleFontSize(role, ctx.scale);
      const boxH = Math.round(fontSize * 1.8);
      built.push(
        this._styledTextElement(
          slot,
          role,
          text,
          { x: area.x, y, width: area.width, height: boxH },
          ctx,
          {
            align: opts.align ?? 'center',
            onImage: opts.onImage,
            backdrop: opts.backdrop,
          }
        )
      );
      y += boxH + Math.round(fontSize * 0.45);
    });
    if (built.length > 0) {
      const extent = Math.max(...built.map((el) => el.y + el.height));
      const delta = area.bottom - extent;
      if (delta !== 0) for (const el of built) el.y += delta;
    }
    elements.push(...built);
    return built;
  }

  /** The bottom edge a bottom-anchored footer hangs off: the canvas margin,
   *  pulled up to the title-safe area when the format's chrome sits lower
   *  (a story's CTA bar covers the bottom 140px). */
  private _footerBottom(ctx: ComposeContext): number {
    const safe = getSafeZoneInset(ctx.formatId || '', ctx.w, ctx.h);
    return Math.min(ctx.h - ctx.margin, safe.bottom);
  }

  /**
   * A panel's copy column, pulled inside the title-safe area — the same edge
   * contract `_footerBottom` applies to the bottom of a band.
   *
   * A sidebar sits hard against a canvas edge, so its margin alone does not
   * clear the safe zone: a live 1584×396 banner placed its copy at x=1002 with
   * a 562px box (right edge 1564 against a 1504.8 safe edge), the doc validator
   * clamped the box back to x=942.8 — 59px OUTSIDE the panel it belongs to —
   * and the escaped box then failed panel containment and reflowed against the
   * canvas, so the seeded story spanned the full width across an empty sidebar.
   * The layout owes the validator a box it never has to move.
   *
   * A column that cannot keep at least half its width inside the safe area is
   * left alone: the format's chrome data would be dictating the layout.
   */
  private _safeColumn(
    ctx: ComposeContext,
    x: number,
    width: number
  ): { x: number; width: number } {
    const safe = getSafeZoneInset(ctx.formatId || '', ctx.w, ctx.h);
    const left = Math.max(x, Math.ceil(safe.left));
    const right = Math.min(x + width, Math.floor(safe.right));
    if (right - left < width * 0.5) return { x, width };
    return { x: left, width: right - left };
  }

  /** The band bottom left once a footer has taken its bottom edge. */
  private _bandBottom(
    ctx: ComposeContext,
    footers: DesignerElement[],
    bottom: number
  ): number {
    if (!footers.length) return bottom;
    const gap = Math.round(ctx.scale.cta * 0.9);
    return Math.min(bottom, Math.min(...footers.map((el) => el.y)) - gap);
  }

  /**
   * The copy band a panel layout's badges leave behind.
   *
   * The badges' MEASURED extent is carved out, replacing a
   * `round(cta × 2.6 × n)` estimate that never matched a burst badge's square
   * extent and — critically — reserved nothing at all in the BOTTOM case. With
   * the band still spanning the whole panel there, `_copyStack`'s balance pass
   * centred the copy straight into the badge's half of it.
   */
  private _copyBand(
    ctx: ComposeContext,
    badges: DesignerElement[],
    top: number,
    bottom: number,
    footers: DesignerElement[] = []
  ): { y: number; height: number } {
    return this._carveCopyBand(
      badges,
      top,
      this._bandBottom(ctx, footers, bottom),
      Math.round(ctx.scale.cta * 0.9),
      this._badgeAtBottom(ctx)
    );
  }

  /** The badge-extent carve itself, free of a ComposeContext so the seeded
   *  outputs' re-fit (`refitSeededOutputs`) can measure the same band from
   *  geometry alone. */
  private _carveCopyBand(
    badges: { y: number; height: number }[],
    top: number,
    bottom: number,
    gap: number,
    badgeAtBottom: boolean
  ): { y: number; height: number } {
    if (!badges.length) return { y: top, height: bottom - top };
    if (badgeAtBottom) {
      const badgeTop = Math.min(...badges.map((el) => el.y));
      return { y: top, height: Math.max(0, badgeTop - gap - top) };
    }
    const y = Math.max(...badges.map((el) => el.y + el.height)) + gap;
    return { y, height: Math.max(0, bottom - y) };
  }

  /** Stack copy slots vertically inside `area`, top-down, with role-driven
   *  box heights. Slots that would start below the area are dropped (the
   *  vision critic, not silent overlap, owns fixing an over-full layout).
   *  A stack that fills less than `STACK_BALANCE_RATIO` of its band is
   *  centered in it rather than left hugging the top over a dead half-panel. */
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
      /** Solid color painted beneath this stack (panel surface / output
       *  background); omitted when the copy sits on imagery. */
      backdrop?: string;
      /** The band is bounded below by real content (a bottom-anchored
       *  footer), so the balance pass centres in it WITHOUT the
       *  STACK_BALANCE_MAX_SHIFT cap — see the balance comment below. */
      centerInBand?: boolean;
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
        // The advance must clear the whole CTA unit — an underline rule sits
        // BELOW the label box, so the nominal advance alone can leave the next
        // element sitting on the bar.
        y = Math.max(
          y + Math.round(ctx.scale.cta * 2.7),
          Math.max(...ctaEls.map((el) => el.y + el.height)) +
            Math.round(ctx.scale.cta * 0.45)
        );
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
            backdrop: opts.backdrop,
          }
        )
      );
      y += boxH + Math.round(fontSize * 0.45);
    }

    // Vertical balance: a short stack packed against the top of a tall band
    // leaves the lower half of the panel dead. Drift the whole block down —
    // toward the band's optical centre, capped by STACK_BALANCE_MAX_SHIFT so a
    // very short stack doesn't get parked halfway down the panel with a dead
    // gap on both sides of it. Skipped for `verticalAlign: 'middle'` callers —
    // minimal-centered already centers its band start, and shifting again
    // would double-center it.
    const consumed = elements.length
      ? Math.max(...elements.map((el) => el.y + el.height)) - area.y
      : 0;
    if (
      opts.verticalAlign !== 'middle' &&
      consumed > 0 &&
      consumed < area.height * STACK_BALANCE_RATIO
    ) {
      // The cap is there because the leftover below a short stack is dead
      // space nothing occupies. When a FOOTER closes the band that objection
      // does not apply — the leftover is the gap between two real elements —
      // so a footer-bounded band centres properly instead of leaving the
      // whole difference under the copy (a live split-panel measured a 429px,
      // 39.7%-of-canvas void between its CTA and its legal line).
      const half = Math.round((area.height - consumed) / 2);
      const shift = opts.centerInBand
        ? half
        : Math.min(half, Math.round(area.height * STACK_BALANCE_MAX_SHIFT));
      if (shift > 0) return elements.map((el) => ({ ...el, y: el.y + shift }));
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
      naturalWidth: asset?.naturalWidth,
      naturalHeight: asset?.naturalHeight,
      focalPoint: this._focalPointFor(asset, width, height),
      // `focalPoint` is only valid for THIS box's aspect; the centroid rides
      // along so `smartReflow` can re-derive it for the next one.
      subjectPoint: this._subjectCentroid(asset),
      originId: slotId,
    } as DesignerElement;
  }

  /**
   * Crop focal point for an asset painted into a `width`x`height` box.
   *
   * The renderer's `computeCoverCrop` treats the focal point as the crop
   * WINDOW's position within the leftover slack — NOT "centre this point" — so
   * a subject centroid `c` has to be converted:
   * `fp = (c*srcDim - cropDim/2) / (srcDim - cropDim)`, clamped.
   *
   * Precedence: an explicit provider focal point (already a crop position)
   * wins; then the asset's `subjectPoint`; then the subject placement the
   * GENERATION prompt asked for. Nothing known → centre. A risky crop can
   * still overwrite this afterwards from the real detector — see
   * `applySubjectFocalPoints`.
   *
   * The conversion (and its saturation rail) lives in
   * `designer-doc/focal-point` so `smartReflow` can redo it verbatim when the
   * element is re-placed into a different-aspect box.
   */
  private _focalPointFor(
    asset: AssetResult | undefined,
    width: number,
    height: number
  ): { x: number; y: number } {
    if (asset?.focalPoint) return asset.focalPoint;
    const centroid = this._subjectCentroid(asset);
    if (!centroid) return { x: 0.5, y: 0.5 };
    return subjectPointToFocalPoint(
      centroid,
      asset?.naturalWidth ?? 0,
      asset?.naturalHeight ?? 0,
      width,
      height
    );
  }

  /**
   * Subject-aware crop repair, run once on the freshly composed doc.
   *
   * The default focal point is CENTRE (or the timid `LAYOUT_SUBJECT_CENTROID`
   * guess about what the generation prompt asked for). That is right for the
   * overwhelming majority of placements — the asset is generated in the
   * primary output's aspect class, so its crop usually has almost no slack.
   *
   * The offline saliency probe that used to fill this gap is gone: sharp's
   * `attention` is a heuristic, and live it reported centroids of 0.0625 and
   * 0.281 where the subjects actually sat at 0.398 and 0.520 (both locking
   * onto a drop shadow), costing 45% of one product that centring kept whole.
   *
   * So the REAL detector (`AiDefaultsService.imageFocalPoint`, the same
   * governed/budgeted vision path the rest of the app uses) is called — but
   * only where a wrong crop can actually hurt: a box whose cover crop has to
   * throw away more than `RISKY_CROP_SLACK_RATIO` of the source along an
   * axis. A full-bleed hero never triggers it; a split-panel column does.
   *
   * Fail-soft in every direction: no vision provider, a timeout, a malformed
   * or `fallback` answer, or no intrinsic size to convert with → the doc comes
   * back untouched and centred. It never throws.
   *
   * PUBLIC because compose only ever sees the PRIMARY format (the conductor
   * hands it `outputs.slice(0, 1)`), which is the one output least likely to
   * need this — a portrait primary discarding 1.6% of its source triggered a
   * lookup while a banner secondary discarding 85.7% was never even eligible.
   * The conductor runs it again over the EXPANDED doc; the centroid is
   * box-independent, so one lookup keyed on the worst-crop format repairs
   * every format at once.
   */
  async applySubjectFocalPoints(
    doc: DesignerDoc,
    orgId: string
  ): Promise<DesignerDoc> {
    if (!this._aiDefaults || !orgId) return doc;

    // Distinct source images whose crop is risky ANYWHERE in the doc.
    const risky = new Set<string>();
    for (const out of doc.outputs) {
      if (!('children' in out)) continue;
      const bg = out.bg;
      if (
        bg?.type === 'image' &&
        bg.src &&
        this._cropIsRisky(bg.naturalWidth, bg.naturalHeight, out.width, out.height)
      ) {
        risky.add(bg.src);
      }
      for (const el of out.children) {
        if (el.type !== 'image' || !el.src) continue;
        if (this._cropIsRisky(el.naturalWidth, el.naturalHeight, el.width, el.height)) {
          risky.add(el.src);
        }
      }
    }
    if (risky.size === 0) return doc;

    const points = new Map<string, { x: number; y: number }>();
    for (const src of [...risky].slice(0, MAX_SUBJECT_POINT_LOOKUPS)) {
      const point = await this._detectSubjectPoint(orgId, src);
      if (point) points.set(src, point);
    }
    if (points.size === 0) return doc;

    // The centroid is box-independent, so it lands on EVERY placement of that
    // image (risky or not) and each box re-derives its own focal point from it
    // — exactly what `smartReflow` does later for the seeded formats.
    const outputs = doc.outputs.map((out) => {
      if (!('children' in out)) return out;
      let changed = false;
      let bg = out.bg;
      const bgPoint = bg?.type === 'image' && bg.src ? points.get(bg.src) : undefined;
      if (bg?.type === 'image' && bgPoint) {
        bg = {
          ...bg,
          subjectPoint: bgPoint,
          focalPoint: subjectPointToFocalPoint(
            bgPoint,
            bg.naturalWidth ?? 0,
            bg.naturalHeight ?? 0,
            out.width,
            out.height
          ),
        };
        changed = true;
      }
      const children = out.children.map((el) => {
        const point = el.type === 'image' && el.src ? points.get(el.src) : undefined;
        if (!point) return el;
        changed = true;
        return {
          ...el,
          subjectPoint: point,
          focalPoint: subjectPointToFocalPoint(
            point,
            el.naturalWidth ?? 0,
            el.naturalHeight ?? 0,
            el.width,
            el.height
          ),
        } as DesignerElement;
      });
      return changed ? ({ ...out, bg, children } as DesignerOutput) : out;
    });

    return { ...doc, outputs } as DesignerDoc;
  }

  /**
   * Does painting a `srcW`x`srcH` image into a `boxW`x`boxH` cover box throw
   * away more than `RISKY_CROP_SLACK_RATIO` of the source along its tight
   * axis? Unknown intrinsic size answers "no" — the conversion needs the
   * source geometry anyway, so a lookup would be unusable.
   */
  private _cropIsRisky(
    srcW: number | undefined,
    srcH: number | undefined,
    boxW: number,
    boxH: number
  ): boolean {
    if (!(srcW && srcW > 0) || !(srcH && srcH > 0)) return false;
    if (!(boxW > 0) || !(boxH > 0)) return false;
    // Mirrors computeCoverCrop's window sizing (and `subjectPointToFocalPoint`).
    const targetRatio = boxW / boxH;
    const wider = srcW / srcH > targetRatio;
    const cropW = wider ? srcH * targetRatio : srcW;
    const cropH = wider ? srcH : srcW / targetRatio;
    const slack = Math.max((srcW - cropW) / srcW, (srcH - cropH) / srcH);
    return slack > RISKY_CROP_SLACK_RATIO;
  }

  /**
   * One governed vision lookup. `detectFocalPoint` already returns
   * `{ x: 0.5, y: 0.5, source: 'fallback' }` when no vision default is
   * configured or the reply is unparseable — a fallback answer carries no
   * information, so it is discarded rather than written onto the doc as if it
   * were a measurement.
   */
  private async _detectSubjectPoint(
    orgId: string,
    src: string
  ): Promise<{ x: number; y: number } | undefined> {
    try {
      const result = await raceWithTimeout(
        this._aiDefaults!.imageFocalPoint(orgId, src),
        SUBJECT_POINT_TIMEOUT_MS,
        { label: 'Subject focal point' }
      );
      if (
        result?.source !== 'provider' ||
        typeof result.x !== 'number' ||
        typeof result.y !== 'number' ||
        Number.isNaN(result.x) ||
        Number.isNaN(result.y)
      ) {
        return undefined;
      }
      return {
        x: Math.min(1, Math.max(0, result.x)),
        y: Math.min(1, Math.max(0, result.y)),
      };
    } catch (err) {
      // No vision provider (imageFocalPoint throws through the defaults gate),
      // budget/policy refusal, or a timeout — the crop stays centred.
      this._logger.warn(
        `Subject focal-point lookup skipped: ${(err as Error).message}`,
        AiDesignerComposerService.name
      );
      return undefined;
    }
  }

  /**
   * The subject centroid (source-image space) behind an asset's focal point,
   * stored on the element so a later reflow can re-convert it for a different
   * box aspect. Undefined when a provider handed us a ready-made crop position
   * — that value is box-independent already and must not be recomputed.
   */
  private _subjectCentroid(
    asset: AssetResult | undefined
  ): { x: number; y: number } | undefined {
    if (asset?.focalPoint) return undefined;
    return (
      asset?.subjectPoint ??
      (asset?.heroLayout ? LAYOUT_SUBJECT_CENTROID[asset.heroLayout] : undefined)
    );
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

  /**
   * The one image this variant resolved, or undefined when there is none or
   * more than one. Used only to rescue an image background whose `ref` names
   * a slot no assetNeed produced — with a single candidate there is nothing
   * to choose wrongly; with two the plan's intent is genuinely unknown and a
   * solid fallback (plus a warning) is the honest answer.
   *
   * `assetNeedCount` is the guard against the OTHER shape: a plan that asked
   * for a background AND a product shot, whose background generation failed.
   * There too exactly one image resolved — but it belongs to the product slot,
   * and promoting it to a full-bleed background would delete the product
   * element (`_dropBackgroundDuplicateImages`) and destroy the composition. So
   * the rescue only fires when the plan asked for at most one image, i.e. when
   * nothing failed and the ref is simply garbage.
   *
   * Asset keys are `${variantId}:${slotId}:${aspect}`, so the same picture
   * appears once per aspect — distinctness is measured by fileId, not by key.
   */
  private _soleResolvedAsset(
    assets: Record<string, AssetResult> | undefined,
    aspect: AssetAspect,
    variantId: string | undefined,
    refLabel: string | undefined,
    assetNeedCount = 0
  ): AssetResult | undefined {
    if (!assets) return undefined;
    if (assetNeedCount > 1) {
      this._logger.warn(
        `Plan background ref "${refLabel || 'none'}" resolved nothing and the plan asked for ${assetNeedCount} images — a sibling slot's image is not the background; keeping the solid fallback.`,
        AiDesignerComposerService.name
      );
      return undefined;
    }
    const withPath = Object.entries(assets).filter(([, asset]) => !!asset?.path);
    // Mirror `_resolveAsset`'s precedence: this variant's own keys
    // (`${variantId}:${slotId}:${aspect}`) first, then the legacy UNSCOPED
    // keys (`slotId[:aspect]`) for docs composed before variant scoping.
    // Another variant's assets are never a candidate — that would bleed one
    // concept's imagery into another's background.
    const scoped = variantId
      ? withPath.filter(([key]) => key.startsWith(`${variantId}:`))
      : withPath;
    if (scoped.length === 0 && variantId) {
      scoped.push(
        ...withPath.filter(([key]) => key.split(':').length <= 2)
      );
    }
    const distinct = new Set(scoped.map(([, asset]) => asset.fileId || asset.path));
    if (distinct.size !== 1) {
      if (distinct.size > 1) {
        this._logger.warn(
          `Plan background ref "${refLabel || 'none'}" resolved nothing and ${distinct.size} distinct images are available — keeping the solid fallback.`,
          AiDesignerComposerService.name
        );
      }
      return undefined;
    }
    // Same picture, one entry per aspect: prefer this canvas's aspect class.
    const asset =
      scoped.find(([, candidate]) => candidate.aspect === aspect)?.[1] ??
      scoped[0][1];
    this._logger.warn(
      `Plan background ref "${refLabel || 'none'}" resolved nothing; using the variant's only image ("${asset.slotId}") instead of a flat fallback.`,
      AiDesignerComposerService.name
    );
    return asset;
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
    variantId?: string,
    assetNeedCount = 0
  ): { background: string; bg?: DesignerOutput['bg'] } {
    if (!background) return { background: '#ffffff' };
    if (background.kind === 'image') {
      // Plans reference generated/stock assets as `asset:{slotId}`. This case
      // was previously unimplemented and silently fell through to white —
      // every image-background plan rendered flat.
      const ref = (background.ref || '').replace(/^asset:/, '');
      const aspect = output ? aspectClass(output.width, output.height) : 'square';
      const asset =
        (ref && assets
          ? this._resolveAsset(assets, ref, aspect, variantId)
          : undefined) ??
        // Dangling/missing ref rescue: the art director sometimes names a slot
        // that no assetNeed produced (`asset:image-bg-01` beside a need for
        // `image`). When exactly ONE image resolved for this variant there is
        // no ambiguity about which picture the plan meant — a flat #1f2937
        // canvas is never the better answer. Two or more and we keep the solid.
        this._soleResolvedAsset(
          assets,
          aspect,
          variantId,
          background.ref,
          assetNeedCount
        );
      if (asset?.path) {
        return {
          background: '#000000',
          bg: {
            type: 'image',
            src: asset.path,
            fileId: asset.fileId,
            focalPoint: this._focalPointFor(
              asset,
              output?.width ?? 0,
              output?.height ?? 0
            ),
            // Same contract as an image ELEMENT: the focal point above is only
            // valid for THIS canvas's aspect, so the centroid (and the
            // intrinsic size needed to convert it) rides along for the seeded
            // outputs to re-derive from.
            subjectPoint: this._subjectCentroid(asset),
            naturalWidth: asset.naturalWidth,
            naturalHeight: asset.naturalHeight,
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
