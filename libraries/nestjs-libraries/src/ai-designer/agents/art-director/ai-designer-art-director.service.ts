import '@postmill-ai/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentResponse, ContextPacket } from '@reaatech/agent-mesh';
import {
  CHANNEL_PRESETS,
  type ChannelPreset,
} from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import { BrandsService } from '@postmill-ai/nestjs-libraries/brands/brands.service';
import { AIModelProvider } from '@postmill-ai/nestjs-libraries/ai/ai-model.provider';
import { z } from 'zod';
import { AiDesignerSkillRouter } from '../../skills/ai-designer-skill-router.service';
import { DesignPlanV2FieldsSchema } from '../../ai-designer.schemas';
import {
  DEFAULT_STYLE_ID,
  getStylePreset,
  listStylePresets,
} from '../../styles';
import {
  isCopySlot,
  type AiDesignerConfig,
  type DesignBrief,
  type DesignPlan,
} from '../../ai-designer.types';
import {
  isAgentInputError,
  parseAgentInput,
} from '../../util/parse-agent-input';
import { normalizeSlotText } from '../../util/slot-keys';
import {
  FIXED_COPY_SEPARATOR,
  URL_TLDS,
} from '../../conductor/brief-values';

const PlanResponseSchema = z.object({
  type: z.string(),
  plans: z.array(z.any()),
});

/** URL/domain tokens, sharing the spoken-URL normalizer's TLD allowlist. */
const URL_TOKEN_RE = new RegExp(
  `(?:https?:\\/\\/)?(?:www\\.)?(?:[a-z0-9-]+\\.)+(?:${URL_TLDS.join('|')})(?:\\/\\S*)?`,
  'gi'
);
const FULL_URL_TOKEN_RE = new RegExp(
  `^(?:https?:\\/\\/)?(?:www\\.)?(?:[a-z0-9-]+\\.)+(?:${URL_TLDS.join('|')})(?:\\/\\S*)?$`,
  'i'
);

/** The brief's offer-shaped tokens, split by how they must be handled:
 *  `verbatim` (coupon codes, fixedCopy units) vs `offer` (amounts, dates,
 *  URLs). Plans must cover EVERY token of both classes. */
interface OfferTokens {
  verbatim: string[];
  offer: string[];
}

interface PlanRequest {
  type: 'plan-request';
  brief: DesignBrief;
  config: AiDesignerConfig;
  mode: 'chat' | 'prompt';
}

interface EnrichedBrief extends DesignBrief {
  brandInstructions?: string;
  brandPalette?: string[];
  brandFontFamilies?: string[];
}

interface SizeOutput {
  formatId: string;
  width: number;
  height: number;
  name?: string;
}

@Injectable()
export class AiDesignerArtDirectorService implements OnModuleInit {
  private readonly _logger = new Logger(AiDesignerArtDirectorService.name);

  constructor(
    private readonly _skillRouter: AiDesignerSkillRouter,
    private readonly _brands: BrandsService,
    private readonly _modelProvider: AIModelProvider
  ) {}

  onModuleInit() {
    registerInProcessAgent('art-director', this._handler.bind(this));
  }

  private _handler: InProcessHandler = async (
    context: ContextPacket
  ): Promise<AgentResponse> => {
    const request = parseAgentInput<PlanRequest>(context.raw_input);
    if (isAgentInputError(request)) {
      return {
        content: JSON.stringify(request),
        workflow_complete: false,
      };
    }
    if (request.type !== 'plan-request') {
      throw new Error(`Unexpected request type: ${(request as any).type}`);
    }
    const orgId =
      typeof context.metadata?.orgId === 'string'
        ? context.metadata.orgId
        : undefined;

    const brief = await this._enrichBrief(
      request.brief,
      orgId,
      request.config.brandProfileId
    );
    const skillId = this._skillRouter.route(brief).skillId;
    const sizes = this._resolveSizes(request.config);
    // The DTO caps variants at 10; clamp again here since this payload can
    // arrive from any dispatch path, and each variant costs LLM calls + renders.
    const variants = Math.min(10, Math.max(1, request.config.variants ?? 1));

    let plans: DesignPlan[];
    try {
      plans = await this._generatePlans(skillId, brief, sizes, variants, orgId);
    } catch (err) {
      this._logger.warn(
        `Plan generation failed, using fallback: ${(err as Error).message}`
      );
      plans = [this._fallbackPlan(skillId, brief, sizes)];
    }

    // Never pad with duplicate fallbacks: only the plans that actually parsed
    // and validated are returned (at least one fallback when everything
    // failed). The conductor tells the user when they got fewer variants than
    // requested — identical filler plans would waste render spend.
    plans = plans.slice(0, variants);

    // Assign fresh, unique variantIds so every returned plan is distinct.
    plans = plans.map((plan) => ({ ...plan, variantId: randomUUID() }));

    return {
      content: JSON.stringify({ type: 'plans', plans }),
      workflow_complete: false,
    };
  };

  private async _enrichBrief(
    brief: DesignBrief,
    orgId: string | undefined,
    brandProfileId: string | undefined
  ): Promise<EnrichedBrief> {
    if (!orgId || !brandProfileId) {
      return brief;
    }

    const brand = await this._brands.getBrand(orgId, brandProfileId);
    if (!brand) {
      return brief;
    }

    return {
      ...brief,
      brandInstructions: brand.instructions || undefined,
      brandPalette: Array.isArray(brand.palette)
        ? (brand.palette as string[])
        : undefined,
      brandFontFamilies: Array.isArray(brand.fontFamilies)
        ? (brand.fontFamilies as string[])
        : undefined,
    };
  }

  private _resolveSizes(config: AiDesignerConfig): SizeOutput[] {
    const sizes: SizeOutput[] = [];

    for (const channelId of config.channels ?? []) {
      const preset = CHANNEL_PRESETS.find((p) => p.id === channelId);
      if (preset) {
        sizes.push({
          formatId: preset.id,
          width: preset.width,
          height: preset.height,
          name: preset.name,
        });
      }
    }

    if (config.customSizes) {
      for (let i = 0; i < config.customSizes.length; i++) {
        const custom = config.customSizes[i];
        sizes.push({
          // Canonical formatId shared with the conductor's `_resolveOutputs`
          // (`custom-${w}x${h}`) so perChannel notes keyed by formatId match.
          formatId: `custom-${custom.width}x${custom.height}`,
          width: custom.width,
          height: custom.height,
          name: custom.name,
        });
      }
    }

    if (sizes.length === 0) {
      sizes.push({
        formatId: 'custom',
        width: 1080,
        height: 1080,
        name: 'Custom Size',
      });
    }

    // ONE original only (first channel, else first custom size): the plan
    // describes a single-format design. The conductor adds the other formats
    // to the doc afterwards via designer-doc `addOutput` (seedCopy/smartReflow
    // from this primary) and QC's each variant separately.
    return sizes.slice(0, 1);
  }

  private async _generatePlans(
    skillId: string,
    brief: EnrichedBrief,
    sizes: SizeOutput[],
    variants: number,
    orgId: string | undefined
  ): Promise<DesignPlan[]> {
    const skillSystemPrompt = this._skillRouter.getSkillPrompt(skillId);

    const prompt = [
      `Generate exactly ${variants} distinct design plans for the brief below.`,
      `Each plan should be a creative variation that still follows the "${skillId}" skill conventions.`,
      '',
      '## Design brief',
      JSON.stringify(brief, null, 2),
      '',
      '## Output format (design for this ONE format only)',
      // The designer is deliberately NOT told about the other formats — the
      // variant outputs are auto-created from this design later, so a plan
      // that anticipates them would fight the reflow.
      JSON.stringify(sizes[0], null, 2),
      '',
      ...this._skillLayoutGuidance(skillId),
      '',
      ...this._styleGuidance(brief),
      '',
      `Return ONLY a JSON object in this exact shape: { "type": "plans", "plans": DesignPlan[] }.`,
      `The "plans" array must contain exactly ${variants} DesignPlan objects.`,
      '',
      'Imagery: social designs live or die on imagery. Unless the brief explicitly asks for a',
      'flat/solid/typographic-only design, every plan MUST include an image slot (typically the',
      'background) AND a matching entry in "assetNeeds" with a vivid, specific brief for that',
      "image (subject, mood, lighting, palette). Use prefer: 'either' unless the brief demands",
      'photography (stock) or illustration (generate).',
      'If the plan uses an image background, that background IS the imagery — do NOT also add an',
      'image slot for the same subject (it would render the same picture twice). Image slots are',
      'only for additional, distinct subjects (e.g. a product shot over a scenic background).',
      '',
      'Copy: every plan MUST include a "texts" object mapping EVERY copy slot id (kind "text",',
      '"cta-button", or "badge") to its exact final copy, written to the skill\'s copy rules (for',
      'example an advertisement: headline ≤8 words benefit-led, CTA ≤3 words verb-first). The',
      'concept and the texts MUST reference the actual event/offer/product named in the brief —',
      'never generic slogans that ignore it. If the brief has "fixedCopy", every " | "-separated',
      'unit in it MUST appear VERBATIM in an appropriate slot\'s text (badge, CTA, or headline).',
      '',
      'Slot discipline (hard rules for every plan, not skill examples): when "fixedCopy" carries',
      'multiple " | "-separated units or distinct parts (a CTA vs an offer vs a code), each unit',
      'goes in its OWN appropriate slot and is NEVER repeated across slots. Badge text is ≤ 5',
      'words. CTA text is ≤ 3 words, verb-first ("Shop now", "Join free"). The " | " in',
      '"fixedCopy" is a MACHINE separator between units, never copy — no slot text may contain',
      'a "|" character.',
      '',
      'Offer fidelity: every discount, percentage, price, or coupon code in the plan texts MUST',
      'come from the brief verbatim (intent/fixedCopy). If the brief names no offer, discount,',
      'or code, invent none — never fabricate a promotion the user did not state.',
      '',
      'Palette fidelity: when the brief names explicit colors or palette words (e.g. warm,',
      "cream, espresso, terracotta), every plan's palette MUST honor them — never substitute a",
      'different temperature family (a warm-toned brief must never get an all-cool palette).',
      '',
      'Layout: when the concept describes a side-by-side layout with a specific side for text and',
      'imagery (e.g. "photo left, text right"), set "panelSide" to the TEXT panel side ("left" =',
      'text panel on the left, "right" = text panel on the right); omit it for non-split layouts.',
      '',
      'DesignPlan schema:',
      JSON.stringify(this._designPlanSchema(), null, 2),
    ].join('\n');

    let validPlans = await this._requestPlans(prompt, skillSystemPrompt, orgId);

    // Offer-token fidelity: a plan whose texts drop ANY offer token the
    // brief stated (discount, price, coupon code, date, URL, fixed copy)
    // silently loses part of the promotion — observed live with "first box
    // 30% off" vanishing from all variants, and later with a plan keeping
    // "30%" while dropping the code and the URL. One repair retry naming
    // exactly the missing tokens; a plan that STILL misses tokens gets them
    // injected deterministically — a required token never ships uncovered.
    const { verbatim, offer } = this._extractOfferTokens(brief);
    const requiredTokens = [...verbatim, ...offer];
    const failingTokens = validPlans.filter(
      (plan) => this._planMissingTokens(plan, requiredTokens).length > 0
    );
    // Palette fidelity: a warm-worded brief answered with an all-cool palette
    // ignores an explicit user constraint. Retry-only (combined with the
    // offer repair when both fire) — hexes are never synthesized here.
    const failingPalette = validPlans.filter((plan) =>
      this._paletteFightsBrief(plan, brief)
    );
    const failing = [...new Set([...failingTokens, ...failingPalette])];
    if (failing.length > 0) {
      const missingUnion = [
        ...new Set(
          failingTokens.flatMap((plan) =>
            this._planMissingTokens(plan, requiredTokens)
          )
        ),
      ];
      const repairs: string[] = [];
      if (missingUnion.length > 0) {
        repairs.push(
          `OFFER FIDELITY REPAIR: the previous plans dropped these brief details. Every plan's "texts" MUST include these tokens verbatim, spread across the copy slots: ${missingUnion.join(', ')}.`
        );
      }
      if (failingPalette.length > 0) {
        repairs.push(
          `PALETTE REPAIR: the brief names warm colors, but the previous plans used an all-cool palette. Every plan's "palette" MUST honor the brief's stated colors — stay in the warm temperature family.`
        );
      }
      try {
        const retried = await this._requestPlans(
          `${prompt}\n\n${repairs.join('\n')}`,
          skillSystemPrompt,
          orgId
        );
        // Only the plans that failed coverage are replaced — plans that
        // already passed keep their verified copy.
        let next = 0;
        validPlans = validPlans.map((plan) =>
          failing.includes(plan) && next < retried.length
            ? retried[next++]
            : plan
        );
      } catch (err) {
        this._logger.warn(
          `Offer-token repair retry failed: ${(err as Error).message}; keeping the original plans.`
        );
      }
      // Deterministic backstop, retried or not: inject whatever is still
      // missing straight into the plan texts (codes/amounts → badge, URLs →
      // subhead, falling back to an existing text slot).
      for (const plan of validPlans) {
        const missing = this._planMissingTokens(plan, requiredTokens);
        if (missing.length === 0) continue;
        const injected = this._injectMissingTokens(plan, missing);
        this._logger.warn(
          `Plan still dropped the brief's offer tokens after one repair retry; injected: ${injected.join(', ')}.`
        );
      }
    }

    // Pipe hygiene on everything about to be returned (initial, retried, and
    // injected texts alike): the " | " fixedCopy separator is machine syntax,
    // and the conductor locks plan texts verbatim — a pipe that survives here
    // ships as a literal glyph in the art.
    for (const plan of validPlans) {
      this._normalizePlanTextPipes(plan);
    }

    // Explicit brief constraints (side language, burst badges) are hard
    // constraints like styleId below — deterministically override what the
    // model picked when the brief is unambiguous.
    const constraints = this._extractBriefConstraints(brief);
    for (const plan of validPlans) {
      if (
        constraints.panelSide &&
        typeof plan.formatTemplate === 'string' &&
        AiDesignerArtDirectorService.SPLIT_LAYOUT_TEMPLATES.has(
          plan.formatTemplate
        )
      ) {
        plan.panelSide = constraints.panelSide;
      }
      if (constraints.badgeStyle) {
        for (const slot of plan.slots ?? []) {
          if (slot.kind === 'badge') {
            slot.style = { ...slot.style, badgeStyle: constraints.badgeStyle };
          }
        }
      }
    }

    // A user-selected style is a hard constraint, not a suggestion: force it
    // onto every plan regardless of what the model picked.
    if (brief.styleId) {
      for (const plan of validPlans) {
        plan.styleId = brief.styleId;
      }
    }

    // Coherence backstop: a plan that declares an image slot or an image
    // background but requests no asset for it would silently render as a flat
    // color (the asset agent only sources what assetNeeds lists). Synthesize
    // the missing need from the plan's own concept.
    for (const plan of validPlans) {
      const needs = (plan.assetNeeds = plan.assetNeeds ?? []);
      const covered = new Set(needs.map((n) => n.slotId));
      for (const slot of plan.slots ?? []) {
        if (slot.kind === 'image' && !covered.has(slot.id)) {
          needs.push({
            slotId: slot.id,
            brief: `${plan.concept} — high-quality ${slot.role || 'background'} image, on-palette (${(plan.palette || []).join(', ')})`,
            prefer: 'either',
          });
          covered.add(slot.id);
        }
      }
      if (plan.background?.kind === 'image' && !plan.background.ref && needs.length === 0) {
        needs.push({
          slotId: 'background',
          brief: `${plan.concept} — full-bleed background image, on-palette`,
          prefer: 'either',
        });
      }
    }

    return validPlans;
  }

  /**
   * One plan-generation round: call the model, drop invalid items, throw when
   * nothing validates (the caller falls back to the fallback plan).
   */
  private async _requestPlans(
    prompt: string,
    skillSystemPrompt: string,
    orgId: string | undefined
  ): Promise<DesignPlan[]> {
    const result = await this._modelProvider.generateObject<{
      type: string;
      plans?: DesignPlan[];
    }>('agent', prompt, PlanResponseSchema, {
      system: skillSystemPrompt,
      orgId,
    });

    if (result?.type !== 'plans' || !Array.isArray(result.plans)) {
      throw new Error('AI response did not match expected plans shape');
    }

    const validPlans: DesignPlan[] = [];
    for (const item of result.plans) {
      if (this._isValidPlanItem(item)) {
        validPlans.push(item as DesignPlan);
      } else {
        // Drop invalid items rather than replacing them with identical
        // fallback plans — fewer real plans beats duplicate filler.
        this._logger.warn(
          'Art director received an invalid plan item; dropping it.'
        );
      }
    }

    if (validPlans.length === 0) {
      throw new Error('AI response contained no valid plan items');
    }

    return validPlans;
  }

  /**
   * Offer-shaped tokens the brief states, split into two classes:
   * `verbatim` — coupon-ish ALL-CAPS codes and the fixedCopy atomic units;
   * `offer` — percentages, prices, dates, and URLs/domains. Both empty for
   * briefs with no offer content — the repair retry must never fire there.
   * A bare ALL-CAPS word only counts as a code when it carries a digit or
   * appears in fixedCopy — shouted words (SALE, FREE, TODAY) are not codes.
   */
  private _extractOfferTokens(brief: EnrichedBrief): OfferTokens {
    const fixedCopy = typeof brief.fixedCopy === 'string' ? brief.fixedCopy : '';
    const text = [brief.intent, fixedCopy]
      .filter((v): v is string => typeof v === 'string')
      .join(' ');
    const verbatim = new Set<string>();
    const offer = new Set<string>();
    for (const unit of fixedCopy.split(FIXED_COPY_SEPARATOR)) {
      const trimmed = unit.trim();
      // Same 2..80-char window as the quoted-span extraction — a compound
      // blob is not an atomic unit and must not become a required token.
      if (trimmed.length >= 2 && trimmed.length <= 80) verbatim.add(trimmed);
    }
    for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{3,}\b/g)) {
      if (/\d/.test(m[0]) || fixedCopy.includes(m[0])) verbatim.add(m[0]);
    }
    for (const m of text.matchAll(/\d+\s?%/g)) offer.add(m[0].trim());
    for (const m of text.matchAll(/\$\s?\d+(?:\.\d{1,2})?/g)) {
      offer.add(m[0].trim());
    }
    for (const m of text.matchAll(/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g)) {
      offer.add(m[0]);
    }
    for (const m of text.matchAll(
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/gi
    )) {
      offer.add(m[0].trim());
    }
    for (const m of text.matchAll(URL_TOKEN_RE)) {
      offer.add(m[0]);
    }
    return { verbatim: [...verbatim], offer: [...offer] };
  }

  /** The required tokens the plan's copy does NOT carry (whitespace- and
   *  case-insensitive: "30% off" covers "30 %"). Coverage requires EVERY
   *  token — a plan keeping "30%" but dropping the code and the URL fails. */
  private _planMissingTokens(plan: DesignPlan, tokens: string[]): string[] {
    const haystack = Object.values(plan.texts ?? {})
      .join(' ')
      .toLowerCase()
      .replace(/\s+/g, '');
    return tokens.filter(
      (token) => !haystack.includes(token.toLowerCase().replace(/\s+/g, ''))
    );
  }

  /**
   * Deterministic injection backstop: append each still-missing token to the
   * plan's texts — codes/amounts/dates into the badge slot, URLs into the
   * subhead slot (canonical skill slot ids), falling back to an existing
   * text-bearing slot when the plan lacks them. Returns "token → slot"
   * descriptions for the log.
   */
  private _injectMissingTokens(plan: DesignPlan, missing: string[]): string[] {
    const texts = (plan.texts = plan.texts ?? {});
    const textSlotIds = (plan.slots ?? [])
      .filter((slot) => isCopySlot(slot))
      .map((slot) => slot.id);
    const resolveSlot = (preferred: string): string => {
      if (textSlotIds.includes(preferred) || preferred in texts) {
        return preferred;
      }
      return (
        textSlotIds.find((id) => texts[id]) ??
        textSlotIds[0] ??
        Object.keys(texts)[0] ??
        'headline'
      );
    };
    const injected: string[] = [];
    for (const token of missing) {
      const slotId = resolveSlot(
        FULL_URL_TOKEN_RE.test(token) ? 'subhead' : 'badge'
      );
      texts[slotId] = texts[slotId] ? `${texts[slotId]} • ${token}` : token;
      injected.push(`"${token}" → ${slotId}`);
    }
    return injected;
  }

  /**
   * Deterministic pipe cleanup on plan texts. A plan that copies a pipe-joined
   * fixedCopy compound into one slot would ship the machine " | " separator as
   * literal glyphs — and the conductor locks plan texts verbatim, so the plan
   * card is the last place to clean them.
   */
  private _normalizePlanTextPipes(plan: DesignPlan): void {
    if (!plan.texts) return;
    for (const [slotId, text] of Object.entries(plan.texts)) {
      if (typeof text === 'string' && text.includes('|')) {
        plan.texts[slotId] = normalizeSlotText(text);
      }
    }
  }

  /** Templates with a text panel on one side — the only layouts `panelSide`
   *  applies to (canonical ids plus the legacy aliases the composer maps). */
  private static readonly SPLIT_LAYOUT_TEMPLATES = new Set([
    'split-panel',
    'editorial-sidebar',
    'two-panel',
    'side-by-side',
  ]);

  /** Brief words that state a warm palette (used by `_paletteFightsBrief`). */
  private static readonly WARM_PALETTE_RE =
    /\b(warm|cream|beige|brown|espresso|terracotta|golden|amber)\b/i;

  /**
   * CONSERVATIVE explicit layout/badge constraints stated in the brief's
   * intent. Only unambiguous side language sets `panelSide` ("Left side: bold
   * headline …", "text on the left", "photo on the right" — and mirrors);
   * conflicting or vague phrasing sets nothing and the model's choice stands.
   */
  private _extractBriefConstraints(brief: EnrichedBrief): {
    panelSide?: 'left' | 'right';
    badgeStyle?: 'burst';
  } {
    const intent = typeof brief.intent === 'string' ? brief.intent : '';
    const out: { panelSide?: 'left' | 'right'; badgeStyle?: 'burst' } = {};
    const textLeft =
      /left side[:,]?\s+(?:bold\s+)?(?:headline|text)/i.test(intent) ||
      /\btext\s+(?:on\s+the\s+)?left\b/i.test(intent) ||
      /\b(?:photo|image|product shot)\s+(?:on\s+the\s+)?right\b/i.test(intent);
    const textRight =
      /right side[:,]?\s+(?:bold\s+)?(?:headline|text)/i.test(intent) ||
      /\btext\s+(?:on\s+the\s+)?right\b/i.test(intent) ||
      /\b(?:photo|image|product shot)\s+(?:on\s+the\s+)?left\b/i.test(intent);
    if (textLeft && !textRight) out.panelSide = 'left';
    else if (textRight && !textLeft) out.panelSide = 'right';
    if (/star\s?burst|burst\s+badge/i.test(intent)) out.badgeStyle = 'burst';
    return out;
  }

  /**
   * True only when the brief names warm palette words AND every checked hex —
   * palette[0] (surface) and [2+] (accents), per the surface/text/accent
   * convention — is cool-hued (hue 160–280 with visible saturation). Any
   * unparsable or non-cool entry keeps this silent: repair-retry only, never
   * a deterministic hex rewrite.
   */
  private _paletteFightsBrief(plan: DesignPlan, brief: EnrichedBrief): boolean {
    const stated = [brief.intent, brief.tone, brief.fixedCopy]
      .filter((v): v is string => typeof v === 'string')
      .join(' ');
    if (!AiDesignerArtDirectorService.WARM_PALETTE_RE.test(stated)) {
      return false;
    }
    const palette = Array.isArray(plan.palette) ? plan.palette : [];
    const checked = [palette[0], ...palette.slice(2)].filter(
      (hex): hex is string => typeof hex === 'string'
    );
    if (checked.length === 0) return false;
    for (const hex of checked) {
      const hsl = this._hexToHsl(hex);
      if (!hsl) return false;
      const cool = hsl.h >= 160 && hsl.h <= 280 && hsl.s >= 0.08;
      if (!cool) return false;
    }
    return true;
  }

  /** #rgb/#rrggbb → { h: 0–360, s: 0–1, l: 0–1 }, or null when not hex. */
  private _hexToHsl(
    value: string
  ): { h: number; s: number; l: number } | null {
    const m = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    const hex =
      m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h: number;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    return { h, s, l };
  }

  /**
   * Skill layout-hints section of the plan prompt: the skill's preferred
   * gallery templates and canonical slot list, so plans come out composable
   * by design (the composer lays these slots out deterministically).
   */
  private _skillLayoutGuidance(skillId: string): string[] {
    const hints = this._skillRouter.getLayoutHints(skillId);
    if (!hints) {
      return [];
    }
    return [
      `## Layout guidance (from the "${skillId}" skill)`,
      `Preferred "formatTemplate" values, most-preferred first: ${hints.formatTemplates.join(', ')}. Pick one per plan; deviate only when the brief demands it.`,
      'A brief asking for a starburst/burst badge → set the badge slot\'s "style": { "badgeStyle": "burst" }.',
      `Canonical slots for this format (use these ids/roles/kinds so copy, assets, and revise fixes key off the same ids):`,
      JSON.stringify(hints.slotSchema, null, 2),
      'Plans should cover these slots (image slots also need an "assetNeeds" entry). Optional slots may be dropped when the concept does not need them; do not invent parallel slot ids for the same role.',
    ];
  }

  /**
   * Style-preset section of the plan prompt. A user-selected preset pins every
   * plan to it; otherwise the model must vary styles so the variants are
   * genuinely distinct options.
   */
  private _styleGuidance(brief: EnrichedBrief): string[] {
    const chosen = getStylePreset(brief.styleId);

    if (chosen) {
      return [
        '## Style preset (user-selected — applies to EVERY plan)',
        JSON.stringify(
          {
            id: chosen.id,
            title: chosen.title,
            fonts: chosen.fonts,
            palettes: chosen.palettes,
            typeScale: chosen.typeScale,
            treatments: chosen.treatments,
          },
          null,
          2
        ),
        `Art direction: ${chosen.promptFragment}`,
        `Every plan MUST set "styleId": "${chosen.id}". Each plan's palette and typeScale must be consistent with this preset (preset values are the default) — only diverge when the brand enrichment above demands it.`,
      ];
    }

    return [
      '## Available style presets',
      JSON.stringify(
        listStylePresets().map((preset) => ({
          id: preset.id,
          title: preset.title,
          description: preset.description,
          fonts: preset.fonts,
          palettes: preset.palettes,
          typeScale: preset.typeScale,
          treatments: preset.treatments,
          guidance: preset.promptFragment,
        })),
        null,
        2
      ),
      'Every plan MUST set "styleId" to one of the preset ids above, and the plans MUST VARY styles so the user gets genuinely distinct options (repeat a styleId only when more variants than presets were requested).',
      "Each plan's palette and typeScale must be consistent with its chosen preset (preset values are the default).",
      'Slot kinds: text-bearing slots use kind "text"; a call-to-action slot MUST use kind "cta-button"; a small label/tag slot MAY use kind "badge"; a purely decorative geometric element MAY use kind "accent-shape"; imagery stays kind "image".',
      'Per-slot "style" overrides (fontFamily/fontWeight/fill/gradient/stroke/shadow/align) are optional — add one only where it improves on the preset for that slot.',
    ];
  }

  private _isValidPlanItem(item: unknown): boolean {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return false;
    }
    const candidate = item as Record<string, unknown>;

    if (typeof candidate.concept !== 'string') {
      return false;
    }
    if (!Array.isArray(candidate.slots)) {
      return false;
    }
    for (const slot of candidate.slots) {
      if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
        return false;
      }
      if (typeof (slot as Record<string, unknown>).id !== 'string') {
        return false;
      }
    }
    if ('assetNeeds' in candidate && !Array.isArray(candidate.assetNeeds)) {
      return false;
    }

    // Schema-v2 fields (styleId, slot style overrides, channelLayouts): a
    // malformed value drops this plan only, never the batch.
    if (!DesignPlanV2FieldsSchema.safeParse(candidate).success) {
      return false;
    }

    return true;
  }

  private _designPlanSchema(): Record<string, unknown> {
    return {
      variantId: 'string',
      skill: 'string',
      concept: 'string',
      formatTemplate: 'string (optional)',
      styleId: 'string — a style preset id (required)',
      panelSide:
        "'left' | 'right' (optional) — split/sidebar layouts only: the side the TEXT panel sits on",
      palette: 'string[]',
      typeScale: 'Record<string, number>',
      background: {
        kind: "'solid' | 'gradient' | 'image'",
        value: 'string (optional)',
        ref: 'asset:{id} (optional)',
      },
      slots: [
        {
          id: 'string',
          role: 'string',
          kind: "'text' | 'image' | 'cta-button' | 'badge' | 'accent-shape'",
          style:
            'optional per-slot override: { fontFamily?, fontWeight?, fill?, gradient?: [string, string], stroke?: { color, width }, shadow?: boolean, align?: "left" | "center" | "right", badgeStyle?: "pill" | "burst" | "ribbon" (badge slots only) }',
        },
      ],
      assetNeeds: [
        {
          slotId: 'string',
          brief: 'string',
          prefer: "'generate' | 'stock' | 'either'",
        },
      ],
      texts: 'Record<slotId, string> — final copy for every copy slot (required)',
      // perChannel/channelLayouts stay in the stored-plan schema (optional)
      // for backward compat with older briefs, but new plans are
      // single-format and must not emit them.
    };
  }

  private _fallbackPlan(
    skillId: string,
    brief: EnrichedBrief,
    _sizes: SizeOutput[]
  ): DesignPlan {
    const isMeme = skillId === 'meme';
    const defaultPalette =
      brief.brandPalette && brief.brandPalette.length > 0
        ? brief.brandPalette
        : ['#ffffff', '#000000', '#2B5CD3'];

    return {
      variantId: randomUUID(),
      skill: skillId,
      concept: brief.intent || 'A clean, on-brand design',
      formatTemplate: isMeme ? 'top-bottom-text' : 'image-macro',
      styleId: brief.styleId ?? DEFAULT_STYLE_ID,
      palette: defaultPalette,
      typeScale: { headline: 48, body: 24, cta: 18 },
      background: { kind: 'solid', value: defaultPalette[0] || '#ffffff' },
      fallback: true,
      slots: isMeme
        ? [
            { id: 'image', role: 'image', kind: 'image' },
            { id: 'top', role: 'top-caption', kind: 'text' },
            { id: 'bottom', role: 'bottom-caption', kind: 'text' },
          ]
        : [
            { id: 'image', role: 'image', kind: 'image' },
            { id: 'headline', role: 'headline', kind: 'text' },
            { id: 'cta', role: 'cta', kind: 'text' },
          ],
      assetNeeds: [
        {
          slotId: 'image',
          brief: 'A high-quality background image matching the brief',
          prefer: 'stock',
        },
      ],
    };
  }
}
