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
import { designLanguagePrompt } from '../../design-language';
import { compositionCatalogPrompt } from '../../layout/compositions';
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
import { throwIfAborted } from '../../util/throw-if-aborted';
import { normalizeSlotText } from '../../util/slot-keys';
import { defaultCta } from '../../skills/copy-rules';
import {
  briefCorpus,
  findUngroundedClaims,
  lintCta,
  stripUngroundedClaims,
} from './copy-grounding';
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
    // The session signal rides in metadata from the conductor — a cancelled
    // or timed-out session must not start billable plan generation.
    const signal = context.metadata?.signal as AbortSignal | undefined;
    throwIfAborted(signal);
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
      plans = await this._generatePlans(skillId, brief, sizes, variants, orgId, signal);
    } catch (err) {
      // An abort is a cancel, not a plan-generation failure — don't mask it
      // with a fallback plan nobody is waiting for.
      throwIfAborted(signal);
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
          // Duplicates need no filtering here — only `sizes[0]` is ever used
          // (see the one-original slice below); `_resolveOutputs` is the site
          // that dedupes, because it builds the full multi-output list.
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
    orgId: string | undefined,
    signal?: AbortSignal
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
      ...this._skillArtDirectionGuidance(skillId),
      ...this._designLanguageGuidance(),
      '',
      ...this._craftGuidance(brief),
      '',
      ...this._styleGuidance(brief),
      '',
      `Return ONLY a JSON object in this exact shape: { "type": "plans", "plans": DesignPlan[] }.`,
      `The "plans" array must contain exactly ${variants} DesignPlan objects.`,
      '',
      'Imagery: social designs live or die on imagery — when the chosen composition places it.',
      'A composition marked "(imagery: none)" (e.g. type-dominant, centred-emblem) places NO',
      'image: its plan must not declare image slots or "assetNeeds" entries — they would be paid',
      'for and never placed. For any other composition, unless the brief explicitly asks for a',
      'flat/solid/typographic-only design, every plan MUST include an image slot (typically the',
      'background) AND a matching entry in "assetNeeds" with a vivid, specific brief for that',
      "image (subject, mood, lighting, palette). Use prefer: 'either' unless the brief demands",
      'photography (stock) or illustration (generate).',
      'If the plan uses an image background, that background IS the imagery — do NOT also add an',
      'image slot for the same subject (it would render the same picture twice). Image slots are',
      'only for additional, distinct subjects (e.g. a product shot over a scenic background).',
      'An image brief describes the SCENE — subject, mood, lighting, palette — and NEVER the',
      "design's copy. Putting the headline or offer text in a brief makes the image model paint",
      'those words INTO the photo, where they collide with the real typeset copy. No quotes, no',
      'slogans, no offer wording in any assetNeeds brief.',
      '',
      'Type accents: a slot may override the preset fonts per slot via "style": { "fontFamily": ... }',
      'and "style": { "fill": ... }. Use this ONLY for a decorative accent line the concept calls',
      'for — a script flourish above the headline ("Italian", "Traditional", "handmade") or a',
      'single word set in the accent color. Script faces available: "Great Vibes" (formal',
      'copperplate — elegant, restaurant/celebration), "Dancing Script", "Lobster",',
      '"Pacifico", "Caveat", "Shadows Into Light" (casual). A script line takes an accent fill from the',
      'palette, never the body color. Everything else keeps the preset pairing — mixed fonts on',
      'ordinary copy reads as a mistake, not a style.',
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
      'Fact fidelity: the same rule for EVERY factual claim, not just promotions. Opening times,',
      'dates, days of the week, hours, addresses, locations, phone numbers, URLs, and prices-as-',
      'facts MUST come from the brief (intent/fixedCopy) — verbatim, and never rounded, reworded,',
      'or "completed". If the brief says 8am, the design says 8am; it must never become "9-5" or',
      '"Mon-Fri". If the brief does not supply a fact a slot would carry, OMIT THAT SLOT rather',
      'than invent one: a plan may drop any optional slot, and a missing date badge is always',
      'better than a wrong one. Plausible-sounding filler ("Effective Monday", "Open 9-5") is the',
      'single most damaging thing a plan can produce — the user ships it believing it is true.',
      '',
      'Copy rulebook (hard rules for every genre):',
      '- Offer mechanics are spelled out in the customer\'s own words: "buy 1 get 1 free" is set',
      '  as "BUY 1 GET 1 FREE" — never compressed into initialisms or trade jargon the brief did',
      '  not use ("B1G1", "BOGO", "2F1"). Jargon half the audience cannot parse is a defect.',
      '- Urgency and scope are FACTS under fact fidelity: "TONIGHT ONLY", "ENDS SOON", "LIMITED',
      '  TIME", "SELECT ITEMS ONLY", "WHILE SUPPLIES LAST", weekday or date claims may appear',
      '  ONLY when the brief states them. A sale with no stated deadline is presented without',
      '  one — invented urgency is a lie the user ships believing it is true.',
      '- CTA copy is a 1-3 word imperative that reads as a complete spoken command: "Order now",',
      '  "Shop the sale", "Get yours". Never a verb+noun fragment ("Shop sale") or a bare label.',
      '',
      'Palette fidelity: when the brief names explicit colors or palette words (e.g. warm,',
      "cream, espresso, terracotta), every plan's palette MUST honor them — never substitute a",
      'different temperature family (a warm-toned brief must never get an all-cool palette).',
      '',
      'Layout: when the concept describes a side-by-side layout with a specific side for text and',
      'imagery (e.g. "photo left, text right"), set "panelSide" to the TEXT panel side ("left" =',
      'text panel on the left, "right" = text panel on the right); omit it for non-split layouts.',
      'When the concept places the badge/sticker in a specific corner (e.g. "offer badge top right",',
      '"seal in the lower left"), set "badgePosition" to that corner; omit it otherwise.',
      '',
      'DesignPlan schema:',
      JSON.stringify(this._designPlanSchema(), null, 2),
    ].join('\n');

    let validPlans = await this._requestPlans(prompt, skillSystemPrompt, orgId, signal);

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
    // Inverse fact-check: plans carrying urgency/scope claims or offer jargon
    // the brief never stated ("TONIGHT ONLY", "B1G1"), and CTAs that are not
    // real commands ("Shop sale"). Observed live — all three shipped in one
    // run. Retry first; deterministic strip/replace backstop below.
    const corpus = briefCorpus(brief);
    const failingClaims = validPlans.filter(
      (plan) => findUngroundedClaims(plan, corpus).length > 0
    );
    const failingCtas = validPlans.filter((plan) =>
      this._badCtaSlotIds(plan).length > 0
    );
    // Art-direction floor: a plan with no declared background, or an
    // imageless plan with no decor, is the blank white card observed live —
    // "minimalism" the model reached by omission, not decision.
    const failingArt = validPlans.filter((plan) => {
      const gaps = this._planArtDirectionGaps(plan);
      return gaps.background || gaps.decor;
    });
    const failing = [
      ...new Set([
        ...failingTokens,
        ...failingPalette,
        ...failingClaims,
        ...failingCtas,
        ...failingArt,
      ]),
    ];
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
      const claimUnion = [
        ...new Set(
          failingClaims.flatMap((plan) =>
            findUngroundedClaims(plan, corpus).map((c) => c.phrase)
          )
        ),
      ];
      if (claimUnion.length > 0) {
        repairs.push(
          `CLAIM REPAIR: the previous plans invented claims the brief never states: ${claimUnion
            .map((p) => `"${p}"`)
            .join(', ')}. Remove them — urgency, deadlines, and scope qualifiers may only come from the brief. Omit a slot rather than fill it with an invented fact.`
        );
      }
      if (failingCtas.length > 0) {
        repairs.push(
          `CTA REPAIR: the previous plans used CTA copy that is not a real command. A CTA is a 1-3 word verb-first imperative ("Order now", "Shop the sale") — never a verb+noun fragment ("Shop sale") or a label.`
        );
      }
      if (failingArt.length > 0) {
        repairs.push(
          `ART DIRECTION REPAIR: every plan MUST declare "background" (kind + value), and a plan without imagery MUST name at least one real "decor" recipe id — a bare solid canvas with type on it is a defect, not minimalism.`
        );
      }
      try {
        const retried = await this._requestPlans(
          `${prompt}\n\n${repairs.join('\n')}`,
          skillSystemPrompt,
          orgId,
          signal
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
        // A cancel must not be swallowed as "repair failed, keep originals".
        throwIfAborted(signal);
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

    // Art-direction backstop: a plan STILL background-less or bare after the
    // retry gets a ground synthesized from its own palette and the genre's
    // first decor recipe — a blank white card must be unreachable.
    for (const plan of validPlans) {
      const patched = this._backstopArtDirection(plan, skillId);
      if (patched.length > 0) {
        this._logger.warn(
          `Plan still missed art-direction floors after one repair retry; ${patched.join(', ')}.`
        );
      }
    }

    // Claim-strip backstop, after token injection so it also covers injected
    // text: a plan STILL carrying an ungrounded claim after the retry has it
    // cut out deterministically — an invented fact must never reach the plan
    // card, because the conductor locks whatever the user approves.
    for (const plan of validPlans) {
      const claims = findUngroundedClaims(plan, corpus);
      if (claims.length === 0) continue;
      const stripped = stripUngroundedClaims(plan, claims);
      if (stripped.length > 0) {
        this._logger.warn(
          `Plan kept ungrounded claims after one repair retry; stripped: ${stripped.join(', ')}.`
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

    // Slot-shape copy limits — after the backstops above so it also cleans up
    // whatever the injection backstop appended: a badge/CTA carrying a whole
    // compound offer is unreadable at feed scale, so the overflow moves to
    // the subhead. Coverage is slot-agnostic, so moving whole tokens keeps
    // every required token accounted for.
    for (const plan of validPlans) {
      this._enforceSlotCopyLimits(plan);
    }

    // CTA lint LAST, so it also judges what the limit enforcement left behind
    // (its offer-token cut can strand a fragment). A CTA that still fails is
    // replaced with a safe default — never shipped as a non-command.
    for (const plan of validPlans) {
      const replaced = this._replaceBadCtas(plan, corpus, requiredTokens);
      if (replaced.length > 0) {
        this._logger.warn(
          `Plan kept non-command CTA copy after one repair retry; replaced: ${replaced.join(', ')}.`
        );
      }
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
      if (constraints.badgePosition) {
        plan.badgePosition = constraints.badgePosition;
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
      const bgIsImage = plan.background?.kind === 'image';
      for (const slot of [...(plan.slots ?? [])]) {
        if (slot.kind === 'image' && !covered.has(slot.id)) {
          // An image BACKGROUND is the imagery. An uncovered image slot next
          // to it has no distinct subject of its own — synthesizing a need
          // for it generates a SECOND near-identical picture that dodges the
          // same-asset duplicate-dropper and ships as a framed photo floating
          // on the full-bleed background (picture-in-picture, live). Drop the
          // slot; the prompt already forbids it, this is the backstop. Slots
          // WITH their own distinct need (a product over a scene) are
          // covered and never reach here.
          if (bgIsImage) {
            plan.slots = (plan.slots ?? []).filter((s) => s.id !== slot.id);
            this._logger.warn(
              `Dropped redundant image slot "${slot.id}" — the image background already carries the imagery.`
            );
            continue;
          }
          // Synthesize from an EXISTING scene brief, never from the concept:
          // the concept describes the DESIGN ("photo left, bold service name
          // on a panel"), and pasted into an image prompt it either painted
          // the type into the photo or — after the design-vocab scrub — left
          // a mangled fragment that generated off-concept imagery (a trust
          // portrait for a pool plan, live). A sibling need's brief is the
          // plan's own art-directed scene; the neutral ask is the fallback.
          const sceneBrief = needs.find(
            (n) => typeof n.brief === 'string' && n.brief.trim().length > 0
          )?.brief;
          needs.push({
            slotId: slot.id,
            brief:
              sceneBrief ??
              `A clean, professional photographic ${slot.role || 'background'} scene for this design, on-palette (${(plan.palette || []).join(', ')}), no text.`,
            prefer: 'either',
          });
          covered.add(slot.id);
        }
      }
      // Image background ref coherence. A ref that names no assetNeed is as
      // dead as no ref at all: `_backgroundToDesignerBg` resolves nothing and
      // ships a flat solid, and the conductor's `_replaceSlotImagery`
      // (`plan.background.ref === 'asset:${slotId}'`) never matches on a
      // regeneration either. Observed live: `ref: 'asset:image-bg-01'` beside
      // an assetNeed for slot `image`. Point the ref at a need that exists —
      // synthesizing one only when the plan requested nothing at all.
      if (plan.background?.kind === 'image') {
        const ref = (plan.background.ref || '').replace(/^asset:/, '');
        if (!ref || !covered.has(ref)) {
          if (needs.length === 0) {
            needs.push({
              slotId: 'background',
              // Never the concept (see the synthesis note above).
              brief: `A clean, professional full-bleed photographic background scene for this design, on-palette (${(plan.palette || []).join(', ')}), no text.`,
              prefer: 'either',
            });
            covered.add('background');
          }
          this._logger.warn(
            `Plan background ref "${plan.background.ref ?? '(none)'}" names no assetNeed; repointing at "${needs[0].slotId}".`
          );
          // The composer's `_dropBackgroundDuplicateImages` removes the image
          // ELEMENT that now shares the background's asset, so this repair
          // cannot double-print the same picture.
          plan.background.ref = `asset:${needs[0].slotId}`;
        }
      }
    }

    // Copy never rides an image brief — LAST, over synthesized and
    // model-authored briefs alike. The synthesis above pastes `plan.concept`
    // verbatim, and a concept like "gigantic condensed BUY 1 GET 1 FREE
    // stacked like a window card" is an *instruction to paint the headline
    // into the photo*: the image model obliged, live, straight through the
    // no-baked-in-text negative, and the design then typeset the same words
    // over their ghost. The design's copy is typeset by the composer; the
    // brief describes the scene.
    for (const plan of validPlans) {
      const stripped = this._stripCopyFromAssetBriefs(plan);
      if (stripped.length > 0) {
        this._logger.warn(
          `Removed plan copy from image briefs: ${stripped.join(', ')}.`
        );
      }
    }

    return validPlans;
  }

  /** Design-language phrases in an IMAGE brief are painting instructions:
   *  "bold service name + big phone on a clean panel" got a fake number
   *  painted straight into the photo, live. Scrubbed from every brief —
   *  the design's type and panels are the composer's, never the image
   *  model's. */
  private static readonly BRIEF_DESIGN_VOCAB_RE =
    /\b(?:bold|big|giant|large|huge)?\s*(?:service name|business name|company name|phone(?:\s+number)?|headline|subhead|tagline|slogan|caption|copy|text|type(?:ography)?|lettering|wordmark|cta|call to action|badge|banner(?:\s+strip)?|panel|plate|logo|font|words?)\b[^,.;]*/gi;

  /** Cut every plan copy text (headline, badge, CTA, …) AND design-language
   *  phrasing out of every assetNeed brief. Returns log notes for the briefs
   *  that changed. */
  private _stripCopyFromAssetBriefs(plan: DesignPlan): string[] {
    const notes: string[] = [];
    const texts = Object.values(plan.texts ?? {}).filter(
      (t): t is string => typeof t === 'string' && t.trim().length >= 4
    );
    for (const need of plan.assetNeeds ?? []) {
      if (typeof need.brief !== 'string') continue;
      let brief = need.brief;
      for (const text of texts) {
        const pattern = new RegExp(
          text
            .trim()
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\s+/g, '\\s+'),
          'gi'
        );
        brief = brief.replace(pattern, ' ');
      }
      brief = brief.replace(
        AiDesignerArtDirectorService.BRIEF_DESIGN_VOCAB_RE,
        ' '
      );
      brief = brief
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([.,;:!])/g, '$1')
        .replace(/(?:[.,;:]\s*){2,}/g, '. ')
        .trim();
      // Scrubbing must never leave an empty prompt — fall back to a neutral
      // scene ask rather than sending the generator nothing.
      if (!/[a-z0-9]/i.test(brief)) {
        brief = 'A clean, professional photographic background, no text.';
      }
      if (brief !== need.brief) {
        notes.push(`"${need.slotId}"`);
        need.brief = brief;
      }
    }
    return notes;
  }

  /**
   * One plan-generation round: call the model, drop invalid items, throw when
   * nothing validates (the caller falls back to the fallback plan).
   */
  private async _requestPlans(
    prompt: string,
    skillSystemPrompt: string,
    orgId: string | undefined,
    signal?: AbortSignal
  ): Promise<DesignPlan[]> {
    const result = await this._modelProvider.generateObject<{
      type: string;
      plans?: DesignPlan[];
    }>('agent', prompt, PlanResponseSchema, {
      system: skillSystemPrompt,
      orgId,
      signal,
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
      // Atomic units only. A compound blob ("First box 30% off with code
      // BEAN30") that becomes a REQUIRED VERBATIM token forces the planner to
      // place the whole sentence in one slot — live, that was the badge, and
      // the burst shrank the label to the font floor. Fidelity is preserved
      // without it: the unit's %/$ amounts and ALL-CAPS-with-digit codes are
      // extracted below as required tokens in their own right.
      if (
        trimmed.length >= 2 &&
        trimmed.length <= 40 &&
        trimmed.split(/\s+/).filter(Boolean).length <= 4
      ) {
        verbatim.add(trimmed);
      }
    }
    for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{3,}\b/g)) {
      if (/\d/.test(m[0]) || fixedCopy.includes(m[0])) verbatim.add(m[0]);
    }
    for (const m of text.matchAll(/\d+\s?%/g)) offer.add(m[0].trim());
    for (const m of text.matchAll(/\$\s?\d+(?:\.\d{1,2})?/g)) {
      offer.add(m[0].trim());
    }
    for (const m of text.matchAll(/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g)) {
      // Two-part matches are only date-shaped as M/D (or M.D): a dash pair
      // is far more often a range ("8-10"), a first component over 12 a
      // version or service claim ("17.2", "24/7"). Three-part matches
      // (8-10-2026, 24.12.26) are unambiguous enough to keep.
      const parts = m[0].split(/[/.-]/);
      if (parts.length === 2) {
        if (m[0].includes('-') || Number(parts[0]) > 12) continue;
      }
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
    // A URL is long, unreadable at badge size, and never belongs in a burst —
    // it must never FALL BACK into the badge (or the CTA) when the plan has no
    // subhead slot. Codes/amounts are badge-shaped and keep the old behaviour.
    const noUrlSlots = new Set([
      ...this._badgeSlotIds(plan),
      ...this._ctaSlotIds(plan),
    ]);
    const injected: string[] = [];
    for (const token of missing) {
      const slotId = FULL_URL_TOKEN_RE.test(token)
        ? this._resolveTextSlot(plan, 'subhead', noUrlSlots)
        : this._resolveTextSlot(plan, 'badge');
      texts[slotId] = texts[slotId] ? `${texts[slotId]} • ${token}` : token;
      injected.push(`"${token}" → ${slotId}`);
    }
    return injected;
  }

  /**
   * Pick the text slot a token/phrase should land in: the preferred slot when
   * the plan actually has it, else the first text-bearing copy slot, else any
   * copy slot, else any keyed text, else "headline". `exclude` drops slots the
   * caller must not use (a URL may not land in a badge; a relocation may not
   * land back in the slot it came from).
   */
  private _resolveTextSlot(
    plan: DesignPlan,
    preferred: string,
    exclude: ReadonlySet<string> = new Set()
  ): string {
    const texts = (plan.texts = plan.texts ?? {});
    const textSlotIds = (plan.slots ?? [])
      .filter((slot) => isCopySlot(slot))
      .map((slot) => slot.id)
      .filter((id) => !exclude.has(id));
    if (
      !exclude.has(preferred) &&
      (textSlotIds.includes(preferred) || preferred in texts)
    ) {
      return preferred;
    }
    return (
      textSlotIds.find((id) => texts[id]) ??
      textSlotIds[0] ??
      Object.keys(texts).find((id) => !exclude.has(id)) ??
      'headline'
    );
  }

  /** Slot ids that render as a badge/burst — kind, or the canonical id. */
  private _badgeSlotIds(plan: DesignPlan): Set<string> {
    const ids = new Set<string>();
    for (const slot of plan.slots ?? []) {
      if (slot.kind === 'badge') ids.add(slot.id);
    }
    if (plan.texts && 'badge' in plan.texts) ids.add('badge');
    return ids;
  }

  /** Slot ids that render as a CTA button — kind, role, or the canonical id. */
  private _ctaSlotIds(plan: DesignPlan): Set<string> {
    const ids = new Set<string>();
    for (const slot of plan.slots ?? []) {
      if (slot.kind === 'cta-button' || /cta|call.to.action/i.test(slot.role ?? '')) {
        ids.add(slot.id);
      }
    }
    if (plan.texts && 'cta' in plan.texts) ids.add('cta');
    return ids;
  }

  /** The art-direction floors a plan misses: a declared background, and (for
   *  an imageless plan) at least one real decor recipe. */
  private _planArtDirectionGaps(plan: DesignPlan): {
    background: boolean;
    decor: boolean;
  } {
    const bg = plan.background as { kind?: unknown } | undefined;
    const missingBackground = !bg || typeof bg.kind !== 'string';
    const hasImage =
      (!missingBackground && (bg as { kind: string }).kind === 'image') ||
      (plan.slots ?? []).some(
        (slot) => slot.kind === 'image' || slot.role === 'image'
      );
    const decorIds = (Array.isArray(plan.decor) ? plan.decor : []).filter(
      (id) => typeof id === 'string' && id !== 'none'
    );
    return {
      background: missingBackground,
      decor: !hasImage && decorIds.length === 0,
    };
  }

  /** Fill the missed floors deterministically: ground = the plan's own
   *  palette hex that contrasts best with the rest (the most ground-like
   *  color; text contrast repair downstream keeps copy legible on it), decor
   *  = the genre's first preference. Returns log notes. */
  private _backstopArtDirection(plan: DesignPlan, skillId: string): string[] {
    const gaps = this._planArtDirectionGaps(plan);
    const patched: string[] = [];
    if (gaps.background) {
      const value = this._groundColorFromPalette(plan) ?? '#F5F1E8';
      plan.background = { kind: 'solid', value };
      patched.push(`synthesized background ${value}`);
    }
    if (gaps.decor) {
      const art = this._skillRouter.getArtDirection?.(skillId);
      const recipe =
        art?.decor?.find((id) => id !== 'none') ?? 'rule';
      plan.decor = [...(Array.isArray(plan.decor) ? plan.decor : []), recipe];
      patched.push(`injected decor "${recipe}"`);
    }
    return patched;
  }

  /** The palette hex most usable as a ground: the one whose WORST contrast
   *  against the other palette colors is best — on a poster that is the
   *  field the rest sits on. */
  private _groundColorFromPalette(plan: DesignPlan): string | undefined {
    const hexes = (Array.isArray(plan.palette) ? plan.palette : []).filter(
      (value): value is string =>
        typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())
    );
    if (hexes.length === 0) return undefined;
    if (hexes.length === 1) return hexes[0];
    const luminance = (hex: string): number => {
      const channel = (i: number) => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };
    const contrast = (a: number, b: number) =>
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const lums = hexes.map((hex) => luminance(hex.trim()));
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < hexes.length; i++) {
      const worst = Math.min(
        ...lums.filter((_, j) => j !== i).map((lum) => contrast(lums[i], lum))
      );
      if (worst > bestScore) {
        bestScore = worst;
        best = i;
      }
    }
    return hexes[best].trim();
  }

  /** CTA slots whose text fails the command-shape lint. */
  private _badCtaSlotIds(plan: DesignPlan): string[] {
    const texts = plan.texts ?? {};
    return [...this._ctaSlotIds(plan)].filter(
      (id) => typeof texts[id] === 'string' && !lintCta(texts[id])
    );
  }

  /** Replace every still-failing CTA with the brief-appropriate default —
   *  after the LLM retry, a non-command CTA never ships. A CTA carrying a
   *  required brief token is left alone: replacing it would silently drop
   *  coverage the token checks above already signed off on. Returns log
   *  lines. */
  private _replaceBadCtas(
    plan: DesignPlan,
    corpus: string,
    requiredTokens: string[]
  ): string[] {
    const replaced: string[] = [];
    const fallback = defaultCta(corpus);
    const flat = (value: string) =>
      value.toLowerCase().replace(/\s+/g, '');
    for (const slotId of this._badCtaSlotIds(plan)) {
      const previous = plan.texts?.[slotId];
      if (
        typeof previous === 'string' &&
        requiredTokens.some((token) => flat(previous).includes(flat(token)))
      ) {
        continue;
      }
      plan.texts![slotId] = fallback;
      replaced.push(`"${previous}" → "${fallback}" (${slotId})`);
    }
    return replaced;
  }

  /**
   * Deterministic pipe cleanup on plan texts. A plan that copies a pipe-joined
   * fixedCopy compound into one slot would ship the machine " | " separator as
   * literal glyphs — and the conductor locks plan texts verbatim, so the plan
   * card is the last place to clean them.
   */
  /** A badge burst fits a few words before the shape's auto-shrink drives the
   *  label to the font floor and it goes unreadable at 25% feed scale. */
  private static readonly MAX_BADGE_WORDS = 5;
  /** A CTA button is a verb-first phrase ("Shop now", "Get the deal"). */
  private static readonly MAX_CTA_WORDS = 3;

  /** Words in a slot text — bullet/pipe separators are punctuation, not words. */
  private _wordCount(text: string): number {
    return text
      .replace(/[•|]/g, ' ')
      .split(/\s+/)
      .filter(Boolean).length;
  }

  /** Short, badge-shaped offer tokens inside a text: %/$ amounts and
   *  ALL-CAPS-with-digit coupon codes (same shapes `_extractOfferTokens`
   *  treats as required, so keeping one never drops coverage). */
  private _badgeOfferCandidates(text: string): string[] {
    const out: string[] = [];
    for (const m of text.matchAll(/\d+\s?%/g)) out.push(m[0].trim());
    for (const m of text.matchAll(/\$\s?\d+(?:\.\d{1,2})?/g)) out.push(m[0].trim());
    for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{3,}\b/g)) {
      if (/\d/.test(m[0])) out.push(m[0]);
    }
    return out;
  }

  /** Index of the first offer/URL token in a text, when it has copy before it
   *  — the only place a CTA may be cut, so no token is ever split. */
  private _firstOfferTokenIndex(text: string): number | undefined {
    const spots: number[] = [];
    for (const m of text.matchAll(/\d+\s?%/g)) {
      spots.push(m.index ?? -1);
      break;
    }
    for (const m of text.matchAll(/\$\s?\d+(?:\.\d{1,2})?/g)) {
      spots.push(m.index ?? -1);
      break;
    }
    for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{3,}\b/g)) {
      if (/\d/.test(m[0])) {
        spots.push(m.index ?? -1);
        break;
      }
    }
    for (const m of text.matchAll(URL_TOKEN_RE)) {
      spots.push(m.index ?? -1);
      break;
    }
    const valid = spots.filter((i) => i > 0);
    return valid.length > 0 ? Math.min(...valid) : undefined;
  }

  /**
   * Slot-shape copy limits. The planner must place required verbatim tokens
   * SOMEWHERE, and it routinely dumps a whole compound offer ("First box 30%
   * off with code BEAN30 northbean.shop") into the badge — the burst shape
   * then auto-shrinks the label to the font floor and it is unreadable at 25%
   * feed scale. Badge copy over `MAX_BADGE_WORDS` keeps the shortest offer
   * token and the rest moves to the subhead; CTA copy over `MAX_CTA_WORDS`
   * keeps its leading verb-first phrase and the offer/URL tail moves.
   *
   * Safe by construction: coverage (`_planMissingTokens`) joins ALL slot texts
   * before matching, so relocating a WHOLE token between slots never drops it.
   * Only whole units/tokens move — a text is cut solely at an offer-token
   * boundary, never mid-phrase.
   */
  private _enforceSlotCopyLimits(plan: DesignPlan): void {
    const texts = plan.texts;
    if (!texts) return;
    const badgeIds = this._badgeSlotIds(plan);
    const ctaIds = this._ctaSlotIds(plan);
    const shrinkable = new Set([...badgeIds, ...ctaIds]);
    const moved: string[] = [];
    const flatten = (value: string) =>
      value.toLowerCase().replace(/\s+/g, ' ').trim();

    /** Append `chunk` to the best non-badge/non-CTA slot. Returns false when
     *  there is nowhere to put it — the source slot then keeps its copy. */
    const relocate = (from: string, chunk: string): boolean => {
      const to = this._resolveTextSlot(
        plan,
        'subhead',
        new Set([...shrinkable, from])
      );
      if (to === from) return false;
      const existing = texts[to] ?? '';
      if (!flatten(existing).includes(flatten(chunk))) {
        texts[to] = existing ? `${existing} • ${chunk}` : chunk;
      }
      moved.push(`"${chunk}" ${from} → ${to}`);
      return true;
    };

    for (const badgeId of badgeIds) {
      const text = texts[badgeId];
      if (
        typeof text !== 'string' ||
        this._wordCount(text) <=
          AiDesignerArtDirectorService.MAX_BADGE_WORDS
      ) {
        continue;
      }
      // No offer token to fall back on means no safe cut — long prose in a
      // badge is the planner's call, and mangling it would risk coverage.
      const keep = [...this._badgeOfferCandidates(text)].sort(
        (a, b) => a.length - b.length
      )[0];
      if (!keep) continue;
      const rest = text
        .split('•')
        .map((unit) => unit.trim())
        .filter((unit) => unit && unit !== keep);
      if (rest.length === 0) continue;
      if (relocate(badgeId, rest.join(' • '))) texts[badgeId] = keep;
    }

    for (const ctaId of ctaIds) {
      const text = texts[ctaId];
      if (
        typeof text !== 'string' ||
        this._wordCount(text) <= AiDesignerArtDirectorService.MAX_CTA_WORDS
      ) {
        continue;
      }
      const units = text
        .split('•')
        .map((unit) => unit.trim())
        .filter(Boolean);
      if (units.length > 1) {
        if (relocate(ctaId, units.slice(1).join(' • '))) texts[ctaId] = units[0];
        continue;
      }
      const cut = this._firstOfferTokenIndex(text);
      if (cut === undefined) continue;
      const head = text
        .slice(0, cut)
        .replace(/[\s•|,–—-]+$/, '')
        .replace(/\s+\b(at|with|using|from|on|for|and)\b$/i, '')
        .trim();
      const tail = text.slice(cut).trim();
      if (!head || !tail) continue;
      if (relocate(ctaId, tail)) texts[ctaId] = head;
    }

    if (moved.length > 0) {
      this._logger.log(
        `Slot copy limits: relocated ${moved.join(', ')}.`
      );
    }
  }

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
   * `badgePosition` is even stricter: the brief must name the badge AND a
   * corner in the same breath ("badge top right", "offer badge lower left").
   */
  private _extractBriefConstraints(brief: EnrichedBrief): {
    panelSide?: 'left' | 'right';
    badgeStyle?: 'burst';
    badgePosition?: DesignPlan['badgePosition'];
  } {
    const intent = typeof brief.intent === 'string' ? brief.intent : '';
    const out: {
      panelSide?: 'left' | 'right';
      badgeStyle?: 'burst';
      badgePosition?: DesignPlan['badgePosition'];
    } = {};
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
    // "badge/sticker/seal/burst … top right", "lower-left offer badge" — the
    // badge word and the corner must sit in the same short, comma-free clause,
    // so a corner stated about the photo or the headline never moves the badge.
    const corner =
      /\b(?:badge|sticker|seal|burst)\b[^.!?,]{0,24}?\b(top|upper|bottom|lower)[\s-]+(left|right)\b/i.exec(
        intent
      ) ??
      /\b(top|upper|bottom|lower)[\s-]+(left|right)\b[^.!?,]{0,24}?\b(?:badge|sticker|seal|burst)\b/i.exec(
        intent
      );
    if (corner) {
      const vertical = /top|upper/i.test(corner[1]) ? 'top' : 'bottom';
      const horizontal = corner[2].toLowerCase() === 'left' ? 'left' : 'right';
      out.badgePosition = `${vertical}-${horizontal}` as NonNullable<
        DesignPlan['badgePosition']
      >;
    }
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
      'An "icon" slot draws a real icon. Preferred: give it an "assetNeeds" entry with kind "icon" and a plain-language search brief ("pizza slice icon", "flame") — the icon is found for you. Alternatively set its "role" to a literal Iconify name ("mdi:rocket"). An unresolved icon slot is dropped.',
      'Graphic elements beyond icons — a hero illustration, a texture, badge art — are an "assetNeeds" entry with kind "illustration" and a style-specific brief matching the plan\'s palette and mood; "vector" searches stock vector art. Use these when the concept calls for illustration rather than photography.',
    ];
  }

  /**
   * The genre's curated art-direction catalog, rendered into the prompt.
   *
   * Every skill has carried an `artDirection` block (preferred compositions,
   * decor, effects, treatments) since the catalog was written — and no
   * runtime ever consumed it, so plans were art-directed from nothing. This
   * is its consumer.
   */
  private _skillArtDirectionGuidance(skillId: string): string[] {
    const art = this._skillRouter.getArtDirection?.(skillId);
    if (!art) return [];
    const line = (label: string, ids?: string[]) =>
      ids && ids.length > 0 ? [`- ${label}: ${ids.join(', ')}`] : [];
    return [
      `## Genre art direction (from the "${skillId}" skill — preferred ids, most-preferred first)`,
      ...line('compositions', art.compositions),
      ...line('decor', art.decor),
      ...line('effects', art.effects),
      ...line('image treatments', art.treatments),
      ...line('masks', art.masks),
      ...line('warps', art.warps),
      'Choose from these lists unless the brief demands otherwise. Every plan MUST declare',
      '"composition" and "background". A plan with no imagery (no image slot and a non-image',
      'background) MUST also name at least one decor recipe — a bare solid canvas with type on',
      'it is a defect, not minimalism: even the quietest card carries a ground and a mark.',
    ];
  }

  /**
   * The design-language section of the plan prompt.
   *
   * GENERATED from the recipe and composition tables rather than written here.
   * A hand-maintained capability list drifts the moment a recipe is renamed,
   * and the failure is silent and expensive: the model keeps confidently asking
   * for an effect that no longer exists, the composer drops it, and the design
   * is quietly plainer than the plan promised.
   */
  private _designLanguageGuidance(): string[] {
    return [
      '## Design language',
      'These are the ONLY named treatments that exist. Asking for anything not on these lists does nothing.',
      '',
      '### COMPOSITIONS — pick one for "composition".',
      compositionCatalogPrompt(),
      '',
      designLanguagePrompt(),
      '',
      'Restraint means COHERENCE, not scarcity: pick one design idea and execute it fully. A great poster uses many coordinated moves — a grade, a vignette, a scrim, a decor mark, tracked caps — all serving one mood. What fails is two competing ideas on one canvas, or three effects on one element.',
      // Live failure: a "moody, dark wood" concept shipped a daylight stock
      // photo graded with warm-tint — the tint changed the hue, not the
      // brightness. Mood is a TREATMENT choice, not just a brief adjective.
      'Match the treatment to the concept\'s mood, not only its palette: a dark, moody or nocturnal concept MUST set the image treatment to "moody-dark" AND add the "vignette" effect to the same image (plus a slot "scrim" where copy sits) — a colour tint warms or cools a daylight photo but barely darkens it. A bright, clean concept MUST keep its type zones quiet: no heavy treatments, no vignette, copy on calm areas or a panel.',
      'Every image brief must specify LIGHTING and GRADE, not just subject: "dark moody overhead shot, deep shadows, warm tungsten rim light" gets a cinematic photo; "pizza on a table" gets a flat daylight snapshot.',
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
      'Match the preset to the SUBJECT: the palette and display face must be plausible for what is being sold. A novelty preset (neon glow, vaporwave, brutalist acid) on an appetizing or premium subject — food, drink, skincare, fashion — fails the brief however striking it is; reach for those only when the brand itself is loud. Appetizing subjects get warm, warm-dark or fresh palettes, never cold neons.',
      'Slot kinds: text-bearing slots use kind "text"; a call-to-action slot MUST use kind "cta-button"; a small label/tag slot MAY use kind "badge"; a purely decorative geometric element MAY use kind "accent-shape"; imagery stays kind "image".',
      'Per-slot "style" overrides (fontFamily/fontWeight/fill/gradient/stroke/shadow/align) are optional — add one only where it improves on the preset for that slot.',
    ];
  }

  /**
   * The craft section: the typographic and photographic dials that separate a
   * designed poster from filled-in slots, plus two condensed quality-bar
   * exemplars. This is the bar every plan is held to — not a list of options.
   */
  private _craftGuidance(brief: EnrichedBrief): string[] {
    const lines = [
      '## Design craft (the quality bar — every plan is judged against this)',
      'Type craft, via per-slot "style":',
      '- Small ALL-CAPS labels (badges, kickers, legal, URLs) read as designed only when tracked out: set "letterSpacing" 2-6.',
      '- Display headlines sit tight: "lineHeight" 1.0-1.1. Supporting copy stays at the default leading.',
      '- Hierarchy must be unmistakable: the headline at least 2.5x the subhead size (set "typeScale" accordingly).',
      '- One accent face per design (a script flourish line); everything else keeps the preset pairing.',
      '- A slot "shadow" may be an object { "color", "blur", "offsetX", "offsetY" } when the default shadow is wrong for the mood.',
      'Photography craft:',
      '- Type lives in the photo\'s quiet zone. If the photo has none, CREATE one: a slot "scrim" { "direction", "strength" } on the image (direction = the side the copy sits on), the "vignette" effect, or both.',
      '- Grade every photo with a "treatment" that matches the concept mood; scale it with "treatmentStrength" when the full recipe is too much.',
      '',
      '## Quality bar — two condensed exemplars (match this level of intent, not the content)',
      'Dark/moody food poster: image slot { treatment: "moody-dark", effects: ["vignette"], scrim: { "direction": "left", "strength": 0.6 } } — the photo goes cinematic and the left third becomes a type zone. Headline slot { style: { "letterSpacing": 1, "lineHeight": 1.0 } }; script accent line above it in an accent fill; badge slot { style: { "letterSpacing": 4 } }; decor ["underline-swash"] under the script. Rationale: the mood is made by the grade+vignette, the hierarchy by scale contrast, the craft by tracked caps and one decor mark.',
      'Bright/clean minimal: image slot { treatment: "high-key" } with NO scrim and NO vignette — copy sits on a solid panel or calm area. Headline in the preset display face, tight leading; one short-rule decor mark; generous empty space left unfilled. Rationale: the luxury is the restraint — one idea (clarity), executed fully.',
    ];

    if (brief.referenceCues?.length) {
      lines.push(
        '',
        '## Reference match (the user attached reference image(s) — interpreted cues are in the brief)',
        'The referenceCues describe the design the user actually wants. Before planning, DECONSTRUCT the cues into: (1) palette and temperature, (2) the type stack — roles, case, tracking, scale contrast, (3) decor inventory, (4) photo grade and mood, (5) layout map. Then plan to MATCH that deconstruction: same mood devices (treatment/vignette/scrim), same hierarchy, same kind of decor. A plan that ignores the reference\'s mood and craft fails the user, however tidy it is.'
      );
    }

    return lines;
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
      badgePosition:
        "'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'center' (optional) — the corner the badge sits in, inside the text panel for split/sidebar layouts and inside the full canvas otherwise",
      palette: 'string[]',
      typeScale: 'Record<string, number>',
      background: {
        kind: "'solid' | 'gradient' | 'image' (REQUIRED — every plan declares its ground)",
        value: 'string (optional)',
        ref: 'asset:{id} (optional)',
      },
      composition:
        'string (REQUIRED) — an arrangement id from the COMPOSITIONS list.',
      depth:
        "'flat' | 'layered' | 'deep' (optional) — how much the design should separate foreground from background",
      decor:
        'string[] — decoration recipe ids from the DECOR list. At most one "loud" mark. REQUIRED (≥1 real id, not "none") for any plan without imagery.',
      slots: [
        {
          id: 'string',
          role: 'string',
          kind: "'text' | 'image' | 'cta-button' | 'badge' | 'accent-shape' | 'shape' | 'icon' | 'divider' | 'logo' | 'frame'",
          style:
            'optional per-slot override: { fontFamily?, fontWeight?, fill?, gradient?: [from, to] | { type?: "linear"|"radial", angle?, focalX?, focalY? (0-1, radial highlight off-centre), stops: [{color, offset 0-1}] (2-5 stops) }, stroke?: { color, width }, shadow?: boolean | { color, blur, offsetX, offsetY }, align?: "left" | "center" | "right", letterSpacing?: number (-2..20 px tracking — 2-6 for all-caps labels), lineHeight?: number (1.0-1.6; 1.0-1.1 for display headlines), opacity?: number (0-1), textScaleX?: number (0.5-1 — condensed display type; 0.62 reads like a condensed cut of the face, for tall headlines in a narrow measure), textTransform?: "uppercase" | "lowercase" | "capitalize" (case as a style — never retype the copy), paragraphSpacing?: number (px before each paragraph after the first), curve?: "arc-up" | "arc-down" (arc a single accent/ribbon line of text), borderRadius?: number | [topLeft, topRight, bottomRight, bottomLeft] (badge/CTA/shape plates — asymmetric corners make ticket and tab shapes), badgeStyle?: "pill" | "burst" | "ribbon" (badge slots only) }',
          effects: 'string[] (optional) — at most two EFFECT ids',
          blend:
            'string (optional) — blend mode for elements that should interact with what is beneath: multiply (ink on paper), screen/linear-dodge (glow), overlay/soft-light (texture). Use sparingly — one blended accent per design.',
          rotation:
            'number (optional, -15..15) — a slight tilt on decorative/badge slots only; never on body copy',
          warp:
            'string (optional) — one WARP id (arched ribbons, flag waves); shape/badge/cta slots only',
          sides:
            'number (optional, 3-12) — star points / polygon sides on accent-shape slots',
          innerRatio: 'number (optional, 0.3-0.7) — star spike depth; 0.5 is a classic star',
          treatment: 'string (optional) — one TREATMENT id; image slots only',
          treatmentStrength:
            'number 0-1 (optional) — scales the chosen treatment; image slots only',
          scrim:
            '{ direction: "left" | "right" | "top" | "bottom" | "full", strength: 0-1 } (optional) — a gradient wash over this image so copy on top stays legible; image slots only',
          mask: 'string (optional) — one MASK id; image slots only',
        },
      ],
      assetNeeds: [
        {
          slotId: 'string',
          brief: 'string',
          prefer: "'generate' | 'stock' | 'either'",
          kind: "'photo' (default) | 'illustration' | 'icon' | 'vector' (optional) — photo: photographic imagery; illustration: a generated GRAPHIC element (hero illustration, texture, badge art) in the plan's style, never photographic; icon: the brief is a plain-language icon search ('pizza slice icon') resolved to a real vector icon for an icon slot; vector: stock vector artwork",
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
