import '@postmill-ai/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import sharp from 'sharp';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentResponse, ContextPacket } from '@reaatech/agent-mesh';
import { AiDefaultsService } from '@postmill-ai/nestjs-libraries/ai/defaults/ai-defaults.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import {
  isLocalStorageUrl,
  loadVisionImageBytes,
  readLocalUpload,
  resolveVisionImageUrl,
} from '@postmill-ai/nestjs-libraries/ai/vision-image-url';
import { isSafePublicHttpsUrl } from '@postmill-ai/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import type {
  DesignPlan,
  Fix,
  FixScope,
  ReferenceLayout,
  VisionFinding,
} from '../../ai-designer.types';
import { ReferenceLayoutSchema } from '../../ai-designer.schemas';
import { COMPOSITION_IDS } from '../../layout/compositions';
import {
  isAgentInputError,
  parseAgentInput,
} from '../../util/parse-agent-input';
import { throwIfAborted } from '../../util/throw-if-aborted';

const VISION_CRITIC_MAX_INLINE_BYTES = 2 * 1024 * 1024;

/**
 * The reference image rides the critique call NEXT TO the render, so it gets
 * its own tighter bound: downscaled to this long edge and re-encoded as JPEG.
 * The render alone can already be a ~2MB inline data URI — a second full-size
 * image risks provider message-size rejection, and 1024px is plenty for
 * "is the ribbon arched, is the script a script".
 */
const REFERENCE_IMAGE_MAX_EDGE = 1024;
const REFERENCE_IMAGE_JPEG_QUALITY = 80;
/** Bounded memo of downscaled references — the same file serves every pass. */
const REFERENCE_IMAGE_CACHE_MAX = 20;

const VISION_CRITIC_SCHEMA_BLOCK = `Return ONLY a JSON object in this exact shape:
{
  "findings": [
    {
      "formatId": "ig-reel",
      "slotId": "bottom-caption",
      "criterion": "text_fit",
      "issue": "Caption text is positioned too low and overlaps the bottom UI safe zone.",
      "fix": {
        "scope": "format-only",
        "targetSlots": ["bottom-caption"],
        "geometry": { "y": 1500, "fontSize": 64 },
        "style": { "fill": "#000000", "opacity": 1, "textStroke": { "color": "#000000", "width": 4 }, "textShadow": false },
        "text": { "slotId": "bottom-caption", "newText": "Updated text" },
        "note": "Move caption above the bottom 200px safe zone and increase size for readability."
      }
    },
    {
      "formatId": "ig-reel",
      "slotId": "image",
      "criterion": "brand_safety",
      "issue": "The generated photo has a baked-in logo on the packaging.",
      "fix": {
        "scope": "shared",
        "regenerateAsset": { "slotId": "image", "brief": "same subject on plain unbranded packaging" }
      }
    },
    {
      "formatId": "ig-post",
      "slotId": "image",
      "criterion": "imagery_integration",
      "issue": "The stock photo's colours have nothing to do with the palette and fight the headline.",
      "fix": {
        "scope": "shared",
        "targetSlots": ["image"],
        "treatment": "duotone-brand",
        "note": "Grade the photo into the brand palette so the type reads against it."
      }
    },
    {
      "formatId": "ig-post",
      "slotId": "headline",
      "criterion": "depth_hierarchy",
      "issue": "The headline sits flat on a busy photograph with no separation.",
      "fix": {
        "scope": "shared",
        "targetSlots": ["headline"],
        "effects": ["legibility-halo"],
        "note": "Separate the type from the imagery without adding a plate."
      }
    }
  ]
}`;

// Base criteria appended centrally to every skill's rubric — these defects
// are genre-independent: text overflow, baked-in asset text, framed insets,
// feed-thumbnail legibility, copy fidelity, third-party brand marks, and
// alignment/collision.
const BASE_CRITERIA: { name: string; description: string; weight: number }[] = [
  {
    name: 'imagery_integration',
    description:
      'The photograph belongs to this design: its colour and contrast sit with the palette rather than fighting it. A stock image dropped in untouched, clashing with the type around it, fails — fix with a "treatment".',
    // Weighted below the correctness criteria: a design that reads is worth
    // more than a design that is beautifully graded and illegible.
    weight: 0.7,
  },
  {
    name: 'depth_hierarchy',
    description:
      'The eye is led. Foreground copy separates from its background, and the most important element reads first. Everything on one flat plane with nothing to separate it fails — fix with an "effects" recipe, not with a plate.',
    weight: 0.7,
  },
  {
    name: 'type_hierarchy',
    description:
      'Headline, subhead and supporting copy are clearly different in weight and size. Two competing sizes, or a subhead as loud as its headline, fails.',
    weight: 0.7,
  },
  {
    name: 'decoration_restraint',
    description:
      'Decoration is deliberate and coherent — every mark serves the one design idea. Competing decorative marks or purposeless ornament fails (the fix is to REMOVE); a design whose concept promised a mood device the render is missing (an anchor rule under a script line, a badge the layout called for) also fails — the fix is to ADD the missing anchor, not more ornament.',
    weight: 0.5,
  },
  {
    name: 'aesthetic_quality',
    description:
      'Overall beauty: would this stop a scroll? Judge mood, cohesion and polish as a whole — a flat daylight photo under a concept that promised mood, type floating on a busy bright image with no quiet zone, or a design that reads as a filled-in template rather than an art-directed poster, fails. Fix toward the concept\'s mood: a "treatment" grade, the "vignette" or "scrim-veil" effect, or a recompose.',
    weight: 1,
  },
  {
    name: 'image_quality',
    description:
      'The imagery is USABLE: the subject is clearly visible and correctly exposed. An overexposed, washed-out photo whose subject you can barely make out (or one crushed to black) fails — no grade can rescue a bad source. Fix with "regenerateAsset" asking for the same subject at correct exposure.',
    weight: 1,
  },
  {
    name: 'craft_polish',
    description:
      'Typographic craft: all-caps labels are tracked out (fix with style "letterSpacing" 2-6), display headlines sit tight (style "lineHeight" 1.0-1.1), spacing rhythm is even, alignment is exact, and type integrates with the imagery instead of floating on top of it.',
    weight: 1,
  },
  {
    name: 'text_fit',
    description:
      'No text overflows its band or the canvas edges; every line of copy is fully visible inside its container.',
    weight: 1,
  },
  {
    name: 'no_baked_in_text',
    description:
      'Generated imagery contains NO baked-in text, letters, words, numbers, logos or watermarks — all copy must be crisp rendered text elements, never painted into an image.',
    weight: 1,
  },
  {
    name: 'no_framed_imagery',
    description:
      'No image sits in a floating framed inset or panel with canvas-colored margins around it; imagery is full-bleed or an edge-to-edge band.',
    weight: 1,
  },
  {
    name: 'feed_legibility',
    description:
      'All copy stays legible when the design is scaled down to 25% (feed-thumbnail size, listed per output below): the headline is clearly readable and supporting copy is not microscopic.',
    weight: 1,
  },
  {
    name: 'text_accuracy',
    description:
      'The rendered copy matches the expected copy below exactly — no missing, truncated, duplicated, misspelled or foreign (baked-in) text.',
    weight: 1,
  },
  {
    name: 'brand_safety',
    description:
      'Generated imagery carries NO recognizable third-party brand logos, trademarks, brand marks, product branding or celebrity likenesses — a real-world branded product (a sportswear swoosh or stripes on a shoe, a phone maker\'s logo, a soda label) is a defect even when no readable text is present. Products and surfaces must be generic and unbranded.',
    weight: 1,
  },
  {
    name: 'text_alignment',
    description:
      'Text is centered/aligned within its containing shape (badges, buttons, pills) and never spills outside it; no text-on-text collisions; text over busy imagery needs a strong shadow/stroke for contrast — never ask for a scrim, plate or band behind copy.',
    weight: 1,
  },
  {
    name: 'display_hierarchy',
    description:
      'The display line DOMINATES: the headline is unmistakably the largest type on the canvas and big enough to carry the design at feed scale. A sale or poster headline rendered at near-body size — a two-word offer adrift as small type on a big canvas — fails, however tidy the layout is. Fix by growing the display line (style "fontSize" or geometry), never by shrinking the support copy further.',
    weight: 1,
  },
  {
    name: 'composition_balance',
    description:
      'The canvas is COMPOSED, not abandoned: no dead voids (a small type stack adrift in a large empty field), no corner-crammed copy with the rest of the canvas bare, no copy stranded on busy photo regions with no quiet zone. A poster that is mostly empty background, or all its type squeezed into one corner, fails. Fix with geometry that rebalances, or a recompose note.',
    weight: 1,
  },
];

interface CritiqueRequest {
  type: 'critique-request';
  contactSheetUrl: string;
  plans?: DesignPlan[];
  outputs: { formatId: string; width: number; height: number }[];
  rubric: {
    criteria: { name: string; description: string; weight: number }[];
  };
  /**
   * English cues from the user's attached reference image(s) — when present,
   * the critic also judges fidelity to the reference's mood and craft.
   */
  referenceCues?: string[];
  /**
   * The reference file ids themselves. When present, the FIRST reference
   * image is downscaled and sent to the vision model NEXT TO the render, so
   * fidelity is judged against pixels instead of prose alone.
   */
  referenceFileIds?: string[];
  /**
   * The user's own words for the run ("create a post for my pizza business —
   * buy 1 get 1 free"). When present, the critic also judges offer fidelity:
   * the render's copy must say what the user asked, not a planner's
   * abbreviation of it.
   */
  briefIntent?: string;
  outputPreviews?: { formatId: string; url: string }[];
  /**
   * Authoritative per-output element data from the design doc (geometry,
   * fills, z-order) — lets the critic catch low-contrast or occluded text
   * that the rendered pixels hide.
   */
  docSummary?: {
    formatId: string;
    width: number;
    height: number;
    elements: {
      originId?: string;
      type: string;
      text?: string;
      fill?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      z: number;
    }[];
  }[];
}

interface InterpretRequest {
  type: 'interpret-request';
  fileIds: string[];
}

/**
 * Best-of-N against the reference: one call carrying the reference AND every
 * candidate render, returning a fidelity ranking. A single shared context
 * ranks candidates against each other on one scale — N independent scores
 * have no common yardstick, and cost N dispatches instead of one.
 */
interface CompareRequest {
  type: 'compare-request';
  referenceFileIds: string[];
  candidates: { variantId: string; url: string }[];
}

@Injectable()
export class AiDesignerVisionCriticService implements OnModuleInit {
  private readonly _logger = new Logger(AiDesignerVisionCriticService.name);

  constructor(
    private readonly _aiDefaults: AiDefaultsService,
    private readonly _fileService: FileService
  ) {}

  onModuleInit() {
    registerInProcessAgent('vision-critic', this._handler.bind(this));
  }

  private _handler: InProcessHandler = async (
    context: ContextPacket
  ): Promise<AgentResponse> => {
    // The session signal rides in metadata from the conductor — a cancelled
    // or timed-out session must not start billable vision calls.
    const signal = context.metadata?.signal as AbortSignal | undefined;
    throwIfAborted(signal);
    const orgId =
      context.metadata && typeof context.metadata.orgId === 'string'
        ? context.metadata.orgId
        : '';

    if (!orgId) {
      return {
        content: JSON.stringify({
          type: 'error',
          message:
            'Vision critic could not run: missing orgId in agent context metadata.',
        }),
        workflow_complete: false,
      };
    }

    const payload = parseAgentInput<
      CritiqueRequest | InterpretRequest | CompareRequest
    >(context.raw_input);
    if (isAgentInputError(payload)) {
      return {
        content: JSON.stringify(payload),
        workflow_complete: false,
      };
    }

    if (payload.type === 'interpret-request') {
      const { cues, layout } = await this.interpretReferences(
        orgId,
        payload.fileIds,
        signal
      );
      return {
        content: JSON.stringify({
          type: 'interpretations',
          cues,
          ...(layout ? { layout } : {}),
        }),
        workflow_complete: false,
      };
    }

    if (payload.type === 'compare-request') {
      const comparison = await this._compare(orgId, payload, signal);
      return {
        content: JSON.stringify(comparison),
        workflow_complete: false,
      };
    }

    const { findings, skipped } = await this._critique(
      orgId,
      payload as CritiqueRequest,
      signal
    );
    return {
      // `skipped` distinguishes "the pass never happened" (image not
      // inlinable, unparseable reply) from a clean zero-finding pass — the
      // conductor surfaces the former as a degradation note.
      content: JSON.stringify({
        type: 'findings',
        findings,
        ...(skipped ? { skipped: true } : {}),
      }),
      workflow_complete: false,
    };
  };

  async interpretReferences(
    orgId: string,
    fileIds: string[],
    signal?: AbortSignal
  ): Promise<{ cues: string[]; layout?: ReferenceLayout }> {
    const cues: string[] = [];
    let layout: ReferenceLayout | undefined;
    await Promise.all(
      fileIds.map(async (id, index) => {
        throwIfAborted(signal);
        try {
          const file = await this._fileService.getFileById(orgId, id);
          // Defense-in-depth: the repository already scopes to the org.
          if (!file || !file.path) return;
          const imageUrl = await this._resolveImageUrl(orgId, file.path);
          if (!imageUrl) return;
          const prompt =
            'Deconstruct this reference design for a designer who must reproduce it WITHOUT seeing it. Answer in compact labelled lines:\n' +
            'COMPOSITION: where every block sits on the canvas (e.g. "type stack anchored top-left", "photo full-bleed", "footer at the bottom edge").\n' +
            'TYPE STACK: every visible text line VERBATIM, one entry per line, largest first — with its case (all-caps/title case), weight, relative size, and style class (condensed slab serif, formal copperplate script, hairline geometric sans, …). NEVER merge two visible lines into one entry, and keep a word the design shows twice at different sizes as two entries.\n' +
            'ORNAMENTS: every decorative mark — swashes, straight or wavy rules, stars, badge plates (name the shape: pill, arched ribbon, starburst — a band whose long edges BOW in the same direction is an arched ribbon, the classic year-badge shape; look closely before calling it a pill) — and what it sits next to.\n' +
            'PALETTE: the dominant colours with their roles (type, accent, plate).\n' +
            'IMAGERY: the photo subject, its lighting and grade (dark/moody versus bright/clean), and where its quiet zone is.\n' +
            'Omit a section the image does not have. Under 220 words.';
          const raw = await this._aiDefaults.vision(orgId, imageUrl, prompt, { signal });
          const text = typeof raw === 'string' ? raw : String(raw);
          if (text.trim()) cues.push(text.trim());
          // Structured measurement for the FIRST reference only — the file
          // the geometry stamping and the critique's Image 2 both use.
          // Fail-soft by design: a malformed measurement leaves `layout`
          // unset and the prose cues carry the run alone.
          if (index === 0) {
            layout = await this._measureReferenceLayout(orgId, imageUrl, signal);
          }
        } catch (err) {
          // A cancel is not a per-file interpretation failure.
          throwIfAborted(signal);
          this._logger.warn(
            `Reference interpretation failed for ${id}: ${(err as Error).message}`
          );
        }
      })
    );
    return { cues, layout };
  }

  /**
   * The measurement half of the interpretation: per-line vertical bands and
   * size ratios as FRACTIONS of the canvas, so "PIZZA occupies y 0.08–0.20,
   * left third" survives planning as numbers instead of adjectives.
   */
  private async _measureReferenceLayout(
    orgId: string,
    imageUrl: string,
    signal?: AbortSignal
  ): Promise<ReferenceLayout | undefined> {
    try {
      const prompt =
        'Measure this reference design. Return ONLY a JSON object, no prose:\n' +
        '{ "lines": [ { "text": "<the line VERBATIM>", "yBand": [<top>, <bottom>], "xAnchor": "left"|"center"|"right", "heightRatio": <cap height as a fraction of image height>, "fontClass": "<style class, e.g. condensed slab serif / formal copperplate script>", "case": "caps"|"title"|"lower" } ],\n' +
        '  "badge": { "yBand": [<top>, <bottom>], "xAnchor": "...", "shape": "pill"|"ribbon"|"burst", "widthRatio": <width / image width> },\n' +
        '  "image": { "coverage": "full-bleed"|"band"|"panel", "yBand": [<top>, <bottom>], "side": "left"|"right" },\n' +
        '  "ornaments": [ { "kind": "<wavy rule / swash pair / straight rule / ...>", "nearLineIndex": <index into lines> } ] }\n' +
        'Rules: every number is a FRACTION of image height (yBand, heightRatio) or width (widthRatio), 0..1 with two decimals. ' +
        'One entry per visible text line, in top-to-bottom order — a word shown twice at different sizes is two entries. ' +
        'yBand spans exactly the ink of that line (top of its capitals to the bottom of its descenders). ' +
        'Omit "badge"/"image"/"ornaments" when the design has none. At most 16 lines.';
      const raw = await this._aiDefaults.vision(orgId, imageUrl, prompt, { signal });
      const parsed = ReferenceLayoutSchema.safeParse(
        this._extractJson(typeof raw === 'string' ? raw : String(raw))
      );
      if (!parsed.success) {
        this._logger.warn(
          `Reference layout measurement did not parse: ${parsed.error.issues[0]?.message}`
        );
        return undefined;
      }
      return parsed.data as ReferenceLayout;
    } catch (err) {
      throwIfAborted(signal);
      this._logger.warn(
        `Reference layout measurement failed: ${(err as Error).message}`
      );
      return undefined;
    }
  }

  /**
   * Rank candidate renders by fidelity to the reference — Image 1 is the
   * reference, Images 2..N+1 the candidates. Candidates are shuffled before
   * the call (cheap position-bias insurance; ids map the ranking back), and
   * ids the model hallucinates are filtered against the real candidate list.
   * Any failure returns `skipped` — the conductor then delivers all
   * survivors, exactly as before this feature existed.
   */
  private async _compare(
    orgId: string,
    payload: CompareRequest,
    signal?: AbortSignal
  ): Promise<{
    type: 'comparison';
    ranking?: string[];
    reasons?: Record<string, string>;
    skipped?: boolean;
  }> {
    const referenceUrl = payload.referenceFileIds?.length
      ? await this._resolveReferenceImage(orgId, payload.referenceFileIds[0])
      : null;
    if (!referenceUrl) return { type: 'comparison', skipped: true };

    const resolved: { variantId: string; url: string }[] = [];
    for (const candidate of payload.candidates ?? []) {
      if (typeof candidate?.variantId !== 'string' || !candidate.url) continue;
      const url = await this._resolveImageUrl(orgId, candidate.url);
      if (url) resolved.push({ variantId: candidate.variantId, url });
    }
    if (resolved.length < 2) return { type: 'comparison', skipped: true };

    // Fisher–Yates: the image order is the prompt order, so shuffling the
    // candidates is what breaks position bias.
    for (let i = resolved.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [resolved[i], resolved[j]] = [resolved[j], resolved[i]];
    }

    const prompt =
      `You are shown ${resolved.length + 1} images. Image 1 is the user's REFERENCE design — the spec. ` +
      `Images 2..${resolved.length + 1} are candidate designs, in this order: ${resolved
        .map((c, i) => `Image ${i + 2} = "${c.variantId}"`)
        .join(', ')}.\n` +
      'Rank ALL candidates by fidelity to the reference: silhouette (where the type stack anchors), type stack (every line present, same order, same relative sizes), type classes (script/slab/condensed), ornament shapes (an arched ribbon is not a pill), palette temperature and mood. ' +
      'The candidates\' COPY may legitimately differ from the reference — judge structure, placement and craft, never the words.\n' +
      'Return ONLY JSON: { "ranking": ["<candidate id, best match first>", ...], "reasons": { "<candidate id>": "<one short sentence>" } }';

    try {
      const raw = await this._aiDefaults.vision(
        orgId,
        [referenceUrl, ...resolved.map((c) => c.url)],
        prompt,
        { signal }
      );
      const parsed = this._extractJson(
        typeof raw === 'string' ? raw : String(raw)
      ) as { ranking?: unknown; reasons?: unknown } | null;
      const known = new Set(resolved.map((c) => c.variantId));
      const ranking = Array.isArray(parsed?.ranking)
        ? parsed.ranking.filter(
            (id): id is string => typeof id === 'string' && known.has(id)
          )
        : [];
      if (ranking.length === 0) return { type: 'comparison', skipped: true };
      const reasons: Record<string, string> = {};
      if (parsed?.reasons && typeof parsed.reasons === 'object') {
        for (const [id, reason] of Object.entries(
          parsed.reasons as Record<string, unknown>
        )) {
          if (known.has(id) && typeof reason === 'string') {
            reasons[id] = reason.slice(0, 300);
          }
        }
      }
      return { type: 'comparison', ranking, reasons };
    } catch (err) {
      throwIfAborted(signal);
      this._logger.warn(
        `Reference comparison failed: ${(err as Error).message}`
      );
      return { type: 'comparison', skipped: true };
    }
  }

  private async _critique(
    orgId: string,
    payload: CritiqueRequest,
    signal?: AbortSignal
  ): Promise<{ findings: VisionFinding[]; skipped: boolean }> {
    const main = await this._resolveOrDownscale(orgId, payload.contactSheetUrl);
    if (!main) {
      // Not a clean pass: the evidence never reached the model (unreadable
      // file, non-inlinable remote, …) — flag it as skipped. An OVERSIZED
      // inline image no longer lands here: it is downscaled instead.
      return { findings: [], skipped: true };
    }

    // Feed-scale second image: the model judges legibility against the
    // pixels a feed actually shows, not against the full-size render. Only
    // possible when the bytes are already in hand — a public https URL is
    // fetched by the provider, never by this process.
    const thumbnailUrl = main.bytes
      ? await this._thumbnailDataUri(main.bytes)
      : null;

    // Close the visual loop: on reference runs the reference image itself
    // rides the call as the last image, so fidelity is judged
    // pixel-against-pixel. A resolve failure degrades to the cue-only
    // critique — never skips it.
    let referenceUrl: string | null = null;
    if (payload.referenceFileIds?.length) {
      referenceUrl = await this._resolveReferenceImage(
        orgId,
        payload.referenceFileIds[0]
      );
    }

    const images = [
      main.url,
      ...(thumbnailUrl ? [thumbnailUrl] : []),
      ...(referenceUrl ? [referenceUrl] : []),
    ];
    const prompt = this._buildPrompt(payload, {
      thumbnailAttached: !!thumbnailUrl,
      referenceIndex: referenceUrl ? images.length : undefined,
    });
    const raw = await this._aiDefaults.vision(
      orgId,
      images.length > 1 ? images : images[0],
      prompt,
      { signal }
    );

    const parsed = this._extractFindings(raw);
    if (!parsed.parseable) {
      // An unparseable reply is not a clean bill of health either.
      return { findings: [], skipped: true };
    }
    const findings = parsed.findings;
    if (findings.length === 0 || !payload.outputPreviews) {
      return { findings, skipped: false };
    }

    // Tiered escalation: if the holistic contact-sheet pass flags detail or
    // legibility issues, run a full-res per-output pass for affected formats.
    throwIfAborted(signal);
    const escalated = await this._escalate(orgId, payload, findings, signal);
    return { findings: [...findings, ...escalated], skipped: false };
  }

  private _buildPrompt(
    payload: CritiqueRequest,
    // `referenceIndex` is the 1-based image number the reference rides as —
    // 2 alone, 3 behind the feed-scale thumbnail — so every mention of it in
    // the prompt renumbers together.
    opts: { thumbnailAttached?: boolean; referenceIndex?: number } = {}
  ): string {
    const referenceAttached = opts.referenceIndex !== undefined;
    // Every skill's rubric gets the base criteria appended centrally (a
    // headline spilling past its band, baked-in asset text, a framed inset,
    // illegible-at-thumbnail copy, wrong copy, or misaligned/colliding text
    // is a defect no matter the genre). The composer's font-size clamp and
    // overlap guard are the deterministic backstops.
    // The planner sometimes improvises the skill's SUFFIX ("reference-clone-poster"
    // for "reference-clone"), so the rubric lookup can miss — the base criteria
    // must still apply, or the whole critique dies reading `.criteria` of
    // undefined and the variant ships unreviewed (observed live).
    const rubricCriteria = payload.rubric?.criteria ?? [];
    const criteria = [
      ...rubricCriteria,
      ...BASE_CRITERIA.filter(
        (base) => !rubricCriteria.some((c) => c.name === base.name)
      ),
      // Reference fidelity only exists when there is a reference to be
      // faithful to — the cues (and, when attached, the reference image
      // itself) are the user's interpretation of "like this".
      ...(payload.referenceCues?.length || payload.referenceFileIds?.length
        ? [
            {
              name: 'reference_fidelity',
              description: referenceAttached
                ? `The design matches the user's reference — Image ${opts.referenceIndex}. Work through the REFERENCE FIDELITY CHECKLIST below region by region; every miss is a finding under this criterion.`
                : 'The design matches the mood, palette temperature, hierarchy and craft of the user\'s reference (cues below) — a render that ignores the reference\'s mood or type treatment fails, however tidy it is.',
              weight: 1,
            },
          ]
        : []),
      // Offer fidelity only exists when the brief's own words are known —
      // the plan's expected copy is the PLANNER'S reading of the ask, and
      // both shipped "B1G1 FREE" for "buy 1 get 1 free" once, plan and
      // render in perfect agreement with each other and wrong for the user.
      // Copy quality is enforced UPSTREAM (before the plan card); this is
      // the safety net that keeps a leak from shipping, not a rewrite path —
      // approved copy is locked, so a finding here holds the variant back.
      ...(payload.briefIntent
        ? [
            {
              name: 'offer_fidelity',
              description:
                'The copy says what the user actually asked for (the brief is below): the offer mechanics are right (a free item is free, not "GET 1 PIZZA"), no invented abbreviations or jargon the user never said ("B1G1"), no invented urgency or scope claims, no dropped qualifiers. When the RENDER differs from the expected copy, fix with a "text" op restoring the expected copy verbatim. When the expected copy ITSELF misstates the brief, emit the finding with NO fix — approved copy is locked; the finding holds the variant back.',
              weight: 1,
            },
          ]
        : []),
      // Plan conformance needs the plan spec (serialized below) — the render
      // must exhibit the art direction the user approved. A "full-bleed,
      // dramatic slice pull" plan that renders as type on a bare card passed
      // every other criterion once, because none of them compare against the
      // plan.
      ...((payload.plans?.length ?? 0) > 0
        ? [
            {
              name: 'plan_conformance',
              description:
                "The render exhibits the plan's stated art direction (the plan spec is below): the named composition actually manifests (a full-bleed composition bleeds imagery to every edge; a split panel shows a panel), the background kind matches (an image background shows imagery, a gradient shows a gradient), every declared decor mark is present and purposeful, and the palette family is honored. A near-empty canvas under a plan that declared decor or imagery is a finding under this criterion. Layout-level misses pair with a \"recompose\" fix; a missing decor/background is a \"note\".",
              weight: 1,
            },
          ]
        : []),
    ]
      .map(
        (c, i) =>
          `${i + 1}. ${c.name} (weight ${c.weight}): ${c.description}`
      )
      .join('\n');

    const outputLines = payload.outputs
      .map((o) => {
        const preset = CHANNEL_PRESETS.find((p) => p.id === o.formatId);
        const safeZones = preset?.safeZones
          ?.map(
            (z) =>
              `      - ${z.label}: x=${z.x} y=${z.y} w=${z.width} h=${z.height} (${z.description})`
          )
          .join('\n');
        return [
          `- ${o.formatId}: ${o.width}x${o.height} (at 25% feed scale: ${Math.round(o.width * 0.25)}x${Math.round(o.height * 0.25)}px)`,
          safeZones ? `    Safe zones:\n${safeZones}` : undefined,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n');

    // Plans are context, not a requirement — the revise re-check critiques a
    // rendered doc without them. When present, the ART DIRECTION rides along:
    // composition, background, decor, palette. Without these the critic
    // literally could not judge whether the render matches the plan — the
    // pizza run's "full-bleed slice pull" plan rendered as a bare white card
    // and no criterion could see it.
    const planSummary = (payload.plans ?? [])
      .map((p) => {
        const slots = (p.slots ?? [])
          .map((s) => `        - ${s.id} (${s.kind}, role=${s.role})`)
          .join('\n');
        const bg = p.background
          ? `${p.background.kind}${p.background.value ? ` ${p.background.value}` : ''}${p.background.ref ? ` (${p.background.ref})` : ''}`
          : undefined;
        const artDirection = [
          p.composition || p.formatTemplate
            ? `    composition: ${p.composition ?? p.formatTemplate}`
            : undefined,
          bg ? `    background: ${bg}` : undefined,
          Array.isArray(p.decor) && p.decor.length > 0
            ? `    decor: ${p.decor.join(', ')}`
            : undefined,
          Array.isArray(p.palette) && p.palette.length > 0
            ? `    palette: ${p.palette.join(', ')}`
            : undefined,
          p.styleId ? `    style: ${p.styleId}` : undefined,
          p.depth ? `    depth: ${p.depth}` : undefined,
          p.panelSide ? `    text panel side: ${p.panelSide}` : undefined,
          p.badgePosition ? `    badge position: ${p.badgePosition}` : undefined,
        ].filter(Boolean);
        return [
          `  - variant ${p.variantId}: ${p.skill}`,
          `    concept: ${p.concept}`,
          ...artDirection,
          `    slots:\n${slots}`,
        ].join('\n');
      })
      .join('\n\n');

    // The expected copy per slot (plan-time `texts`, carried through revise
    // re-checks on the stored plans) — the ground truth for text_accuracy.
    const expectedCopy = (payload.plans ?? [])
      .map((p) => {
        const texts = Object.entries(p.texts ?? {}).filter(
          ([, text]) => typeof text === 'string' && text.trim()
        );
        if (texts.length === 0) return undefined;
        const lines = texts
          .map(([slotId, text]) => `    - ${slotId}: "${text}"`)
          .join('\n');
        return `  - variant ${p.variantId}:\n${lines}`;
      })
      .filter(Boolean)
      .join('\n');

    // Authoritative element data from the design doc: the rendered pixels
    // (especially a downscaled contact sheet) can hide a #000-on-#0A0A0A
    // label or an occluding shape — the geometry/fills cannot.
    const docSummary = (payload.docSummary ?? [])
      .map((out) => {
        const lines = out.elements
          .map((el) =>
            [
              `    - [z${el.z}] ${el.type}${el.originId ? ` (${el.originId})` : ''}`,
              `x=${el.x} y=${el.y} w=${el.width} h=${el.height}`,
              el.fill ? `fill=${el.fill}` : undefined,
              el.text ? `text="${el.text}"` : undefined,
            ]
              .filter(Boolean)
              .join(' ')
          )
          .join('\n');
        return `  - ${out.formatId} (${out.width}x${out.height}):\n${lines}`;
      })
      .join('\n');

    // Region-named, answerable questions beat a fat criterion description:
    // the model compares the two images directly instead of re-deriving what
    // "fidelity" means each pass. Only rendered when the reference image is
    // actually attached — the questions address Image 2.
    const fidelityChecklist = referenceAttached
      ? `
REFERENCE FIDELITY CHECKLIST — compare Image 1 against Image ${opts.referenceIndex} directly, top to bottom:
- SILHOUETTE: is the type stack anchored where the reference anchors it (top/bottom/panel side)?
- TYPE STACK: is every reference text line present, in the same order, with the same relative sizes? Is the reference's largest line still the largest?
- TYPE CLASS: script lines rendered in a script face, slab serifs as slabs, condensed as condensed — a class mismatch fails (fix with style "fontFamily" naming the class, e.g. "a casual script").
- ORNAMENTS: badge/plate SHAPE matches (an arched ribbon is not a pill); swashes, rules and waves sit next to the same lines they do in the reference.
- PALETTE & MOOD: same colour temperature and darkness; imagery graded the same direction (dark/moody vs bright/clean).
The COPY may legitimately differ — judge structure, placement and craft, never the words themselves.
Emit each miss as a finding with criterion "reference_fidelity" and a concrete typed fix.
`
      : '';

    const imageCount =
      1 + (opts.thumbnailAttached ? 1 : 0) + (referenceAttached ? 1 : 0);
    const imageHeader =
      imageCount === 1
        ? ''
        : `
You are shown ${imageCount === 2 ? 'TWO' : 'THREE'} images. Image 1 is the design under review (contact sheet or single render).${
            opts.thumbnailAttached
              ? ' Image 2 is the SAME design at feed size — anything you cannot read in Image 2 is a finding under feed_legibility.'
              : ''
          }${
            referenceAttached
              ? ` Image ${opts.referenceIndex} is the user's REFERENCE design — the spec the design is meant to match.`
              : ''
          }
`;

    return `You are a meticulous visual-design critic reviewing a contact sheet of generated design variants.
${imageHeader}
Evaluate the contact sheet against this rubric:
${criteria}
${fidelityChecklist}

Outputs and channel-safe zones:
${outputLines}

${planSummary ? `Design plans:\n${planSummary}` : ''}

${expectedCopy ? `Expected copy (the render must show exactly this text; letter case may differ per the style preset — e.g. an all-caps headline transform — so judge text_accuracy case-insensitively):\n${expectedCopy}` : ''}

${payload.briefIntent ? `The user's brief (their own words — offer_fidelity is judged against THIS, not against the plan's reading of it):\n"${payload.briefIntent}"` : ''}

${docSummary ? `Design doc elements (authoritative geometry/colors per output — use them to catch low-contrast fills and overlapping/occluding elements the pixels may hide):\n${docSummary}` : ''}

${payload.referenceCues?.length ? `Reference cues (the user's attached reference image(s), interpreted — the target for reference_fidelity):\n${payload.referenceCues.map((c) => `  - ${c}`).join('\n')}` : ''}

Look at the contact sheet and identify concrete, actionable visual issues. For each issue, produce a finding with:
- "formatId" (optional): which output format is affected, if known.
- "slotId" (optional): which design slot is affected, if known.
- "criterion" (required): the name of the rubric criterion above that this finding violates (e.g. "brand_safety", "text_fit") — the repair strategy depends on it; use "aesthetic_quality" when no other criterion fits.
- "issue": a short, specific description of the problem (e.g. "Bottom caption is too close to the Instagram Reel bottom-UI safe zone and may be covered by captions", "Headline text is too small to read at thumbnail size", "Light text on a bright background lacks contrast").
- "fix" (optional): an object describing the fix, with one of these shapes:
  - "scope": "shared" or "format-only"
  - "targetSlots": array of slot ids the fix applies to
  - "geometry": partial element geometry such as { x, y, width, height, fontSize }
  - "style": partial style such as { fill, stroke, opacity, fontFamily (a loadable face OR a style class — "a casual script", "condensed slab serif", "formal copperplate script" — the composer resolves the class to a loadable family; the fix for a type-class mismatch against a reference), align ("left"|"center"|"right"), verticalAlign ("top"|"middle"|"bottom"), letterSpacing (px tracking — 2-6 for all-caps labels), lineHeight (1.0-1.6; 1.0-1.1 for display headlines), textScaleX (0.5-1 — condense display type that wraps or overflows instead of shrinking it), textTransform ("uppercase"|"lowercase"|"capitalize" — case as a style, never retype the copy), curve (degrees, -60..60 — arc a single accent/ribbon line), warpBend (-100..100 — deepen or flatten an existing banner warp), backdropBlur (0-40 — the frost on a glass panel), blend (a blend-mode name, e.g. "multiply"), badgeStyle ("pill"|"ribbon" — re-shape a badge plate; a band whose long edges bow the same way is an arched ribbon, never a pill), textStroke { color, width }, textShadow (true = add a default shadow, false = remove it) }
  - "text": { slotId, newText } — rewrite the copy of a TEXT slot only; never target an image slot with a text fix
  - "regenerateAsset": { slotId, brief? } — regenerate the underlying imagery for that slot; the ONLY fix for a no_baked_in_text, text_accuracy or brand_safety defect inside a generated photo: imagery containing baked-in text, letters, logos, watermarks, or a recognizable third-party brand mark / branded product / celebrity likeness must be fixed with regenerateAsset targeting the image slot — never with a text fix. Optional "brief" adds guidance for the regeneration (subject, mood, what to avoid — e.g. "generic unbranded sneaker, no logos or brand marks")
  - "addElement": { slotId, type: "text" | "shape", text?, shape?, box? { x, y, width, height }, style? { fill, fontFamily, fontSize, align, textStroke, textShadow } } — add a small text/shape/badge-style element
  - "removeElement": a slot id to remove from the targeted outputs
  - "recompose": a composition id (one of: ${COMPOSITION_IDS.join(', ')}) — swap the WHOLE arrangement when the problem is the layout itself (the stack anchored at the wrong edge, copy in the wrong region, a panel where the reference has none); the design re-composes under the new arrangement with the same copy and imagery, so pair it only with layout-level findings
  - "note": free-text guidance when no numeric edit is possible

${VISION_CRITIC_SCHEMA_BLOCK}

If the contact sheet looks good, return { "findings": [] }.`;
  }

  private async _escalate(
    orgId: string,
    payload: CritiqueRequest,
    findings: VisionFinding[],
    signal?: AbortSignal
  ): Promise<VisionFinding[]> {
    const escalatedFormats = new Set<string>();
    const detailKeywords = [
      'small',
      'tiny',
      'illegible',
      'detail',
      'blur',
      'low resolution',
      'hard to read',
      // Contrast/occlusion findings need the full-res pass too — they are
      // exactly what the ≤400px contact sheet hides.
      'contrast',
      'unreadable',
      'invisible',
      'covered',
      'overlap',
      'occluded',
      // Rendering defects (double-drawn text, exposure, cropping, detached
      // elements) that only the full-res pass can confirm and localize.
      'duplicate',
      'ghost',
      'washed',
      'faded',
      'clipped',
      'cut off',
      'floating',
    ];

    for (const f of findings) {
      const text = `${f.issue} ${f.fix?.note || ''}`.toLowerCase();
      if (detailKeywords.some((k) => text.includes(k)) && f.formatId) {
        escalatedFormats.add(f.formatId);
      }
    }

    if (escalatedFormats.size === 0) return [];

    const extra: VisionFinding[] = [];
    await Promise.all(
      (payload.outputPreviews || [])
        .filter((o) => escalatedFormats.has(o.formatId))
        .map(async (o) => {
          throwIfAborted(signal);
          try {
            const resolved = await this._resolveOrDownscale(orgId, o.url);
            if (!resolved) return;
            const imageUrl = resolved.url;
            // The escalation carries only the schema block, not the criteria
            // list — brand_safety has to be restated inline or a swoosh that
            // the contact sheet was too small to show goes unflagged here too.
            const prompt = `Review this full-resolution design for the "${o.formatId}" output. Focus on legibility, safe-zone compliance, and whether any text or important detail would be lost at real size. Also flag brand_safety defects: any recognizable third-party brand logo, trademark, brand mark, branded product or celebrity likeness in the generated imagery — fix those with "regenerateAsset" targeting the image slot, never with a text fix, and set "criterion" to "brand_safety". ${VISION_CRITIC_SCHEMA_BLOCK}; keep it brief.`;
            const raw = await this._aiDefaults.vision(orgId, imageUrl, prompt, { signal });
            const parsed = this._extractFindings(raw);
            for (const f of parsed.findings) {
              if (!f.formatId) f.formatId = o.formatId;
              extra.push(f);
            }
          } catch (err) {
            // A cancel is not a per-format escalation failure.
            throwIfAborted(signal);
            this._logger.warn(
              `Escalated critique failed for ${o.formatId}: ${(err as Error).message}`
            );
          }
        })
    );

    return extra;
  }

  private _extractFindings(raw: string): {
    findings: VisionFinding[];
    parseable: boolean;
  } {
    try {
      const parsed = this._extractJson(raw) as { findings?: unknown } | null;
      if (!parsed || !Array.isArray(parsed.findings)) {
        return { findings: [], parseable: false };
      }
      return {
        findings: parsed.findings
          .map((f) => this._normalizeFinding(f))
          .filter((f): f is VisionFinding => f !== null),
        parseable: true,
      };
    } catch {
      return { findings: [], parseable: false };
    }
  }

  private _normalizeFinding(item: unknown): VisionFinding | null {
    if (!item || typeof item !== 'object') return null;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.issue !== 'string' || !candidate.issue.trim()) {
      return null;
    }

    const finding: VisionFinding = {
      issue: candidate.issue.trim(),
    };

    if (typeof candidate.formatId === 'string') {
      finding.formatId = candidate.formatId;
    }
    if (typeof candidate.slotId === 'string') {
      finding.slotId = candidate.slotId;
    }
    // The criterion drives the conductor's regeneration technique — keep it,
    // bounded (a rambling model must not smuggle a paragraph through it).
    // A finding WITHOUT one defaults to aesthetic_quality: the conductor's
    // hold-back gate filters on `criterion && AESTHETIC_CRITERIA.has(...)`,
    // so a criterion-less finding used to slip straight past it.
    if (typeof candidate.criterion === 'string' && candidate.criterion.trim()) {
      finding.criterion = candidate.criterion.trim().slice(0, 60);
    } else {
      finding.criterion = 'aesthetic_quality';
    }
    if (candidate.fix && typeof candidate.fix === 'object') {
      finding.fix = this._normalizeFix(candidate.fix as Record<string, unknown>);
    }

    return finding;
  }

  private _normalizeFix(raw: Record<string, unknown>): Fix {
    const scope: FixScope =
      raw.scope === 'format-only' || raw.scope === 'shared'
        ? (raw.scope as FixScope)
        : 'shared';

    const fix: Fix = { scope };

    if (Array.isArray(raw.targetSlots)) {
      const slots = raw.targetSlots.filter(
        (s): s is string => typeof s === 'string'
      );
      if (slots.length > 0) fix.targetSlots = slots;
    }

    // Design-language repairs. Names are carried through verbatim and bounded;
    // the composer is what decides whether a name means anything, so an id from
    // a newer catalog is dropped there rather than rejected here.
    if (Array.isArray(raw.effects)) {
      const effects = raw.effects
        .filter((e): e is string => typeof e === 'string')
        .slice(0, 4)
        .map((e) => e.slice(0, 100));
      if (effects.length) fix.effects = effects;
    }
    for (const key of ['treatment', 'mask', 'blend', 'recompose'] as const) {
      const value = raw[key];
      if (typeof value === 'string' && value.trim()) {
        fix[key] = value.trim().slice(0, 100);
      }
    }

    // Sanitize to the Fix shape rather than casting: an off-shape key or a
    // string-typed number from the vision model must not ride into the strict
    // updateElement patch schema downstream.
    if (raw.geometry && typeof raw.geometry === 'object') {
      const src = raw.geometry as Record<string, unknown>;
      const geometry: NonNullable<Fix['geometry']> = {};
      for (const key of ['x', 'y', 'width', 'height', 'fontSize'] as const) {
        const value = src[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          geometry[key] = value;
        }
      }
      // fontSize is PIXELS. The model occasionally answers with a ratio
      // ("0.8" for "20% smaller") — as an op that value fails the strict
      // patch schema (fontSize ≥ 1) and, unguarded, one such fix aborted an
      // entire variant's format expansion live. No real px ask is under 4.
      if (geometry.fontSize !== undefined && geometry.fontSize < 4) {
        delete geometry.fontSize;
      }
      if (Object.keys(geometry).length > 0) fix.geometry = geometry;
    }

    if (raw.style && typeof raw.style === 'object') {
      const src = raw.style as Record<string, unknown>;
      const style: NonNullable<Fix['style']> = {};
      if (typeof src.fill === 'string') style.fill = src.fill;
      if (typeof src.stroke === 'string') style.stroke = src.stroke;
      if (typeof src.opacity === 'number' && Number.isFinite(src.opacity)) {
        style.opacity = Math.max(0, Math.min(1, src.opacity));
      }
      if (typeof src.fontFamily === 'string') style.fontFamily = src.fontFamily;
      // Alignment is a property of the DESIGN, not of one canvas: applying it
      // format-only leaves the same slot left-aligned on one output and
      // centered on another. The critic keeps the vocabulary — a genuinely
      // global alignment problem still gets fixed through a shared-scope fix.
      if (
        scope === 'shared' &&
        (src.align === 'left' || src.align === 'center' || src.align === 'right')
      ) {
        style.align = src.align;
      }
      if (
        src.verticalAlign === 'top' ||
        src.verticalAlign === 'middle' ||
        src.verticalAlign === 'bottom'
      ) {
        style.verticalAlign = src.verticalAlign;
      }
      if (src.textStroke && typeof src.textStroke === 'object') {
        const stroke = src.textStroke as Record<string, unknown>;
        if (
          typeof stroke.color === 'string' &&
          typeof stroke.width === 'number' &&
          Number.isFinite(stroke.width)
        ) {
          style.textStroke = { color: stroke.color, width: stroke.width };
        }
      }
      if (typeof src.textShadow === 'boolean') style.textShadow = src.textShadow;
      // The prompt advertises both and the composer applies both (with the
      // same clamps) — dropping them here silently discarded every tracking/
      // leading fix, which made craft_polish findings recur until the variant
      // was held back.
      if (
        typeof src.letterSpacing === 'number' &&
        Number.isFinite(src.letterSpacing)
      ) {
        style.letterSpacing = Math.max(-2, Math.min(20, src.letterSpacing));
      }
      if (typeof src.lineHeight === 'number' && Number.isFinite(src.lineHeight)) {
        style.lineHeight = Math.max(1, Math.min(1.6, src.lineHeight));
      }
      if (typeof src.textScaleX === 'number' && Number.isFinite(src.textScaleX)) {
        style.textScaleX = Math.max(0.5, Math.min(1.25, src.textScaleX));
      }
      if (
        src.textTransform === 'none' ||
        src.textTransform === 'uppercase' ||
        src.textTransform === 'lowercase' ||
        src.textTransform === 'capitalize'
      ) {
        style.textTransform = src.textTransform;
      }
      if (typeof src.curve === 'number' && Number.isFinite(src.curve)) {
        style.curve = Math.max(-60, Math.min(60, src.curve));
      }
      if (typeof src.warpBend === 'number' && Number.isFinite(src.warpBend)) {
        style.warpBend = Math.max(-100, Math.min(100, src.warpBend));
      }
      if (typeof src.backdropBlur === 'number' && Number.isFinite(src.backdropBlur)) {
        style.backdropBlur = Math.max(0, Math.min(40, src.backdropBlur));
      }
      if (typeof src.blend === 'string') style.blend = src.blend;
      if (
        src.badgeStyle === 'pill' ||
        src.badgeStyle === 'burst' ||
        src.badgeStyle === 'ribbon'
      ) {
        style.badgeStyle = src.badgeStyle;
      }
      if (Object.keys(style).length > 0) fix.style = style;
    }

    if (
      raw.text &&
      typeof raw.text === 'object' &&
      typeof (raw.text as Record<string, unknown>).slotId === 'string' &&
      typeof (raw.text as Record<string, unknown>).newText === 'string'
    ) {
      fix.text = {
        slotId: (raw.text as Record<string, unknown>).slotId as string,
        newText: (raw.text as Record<string, unknown>).newText as string,
      };
    }

    if (raw.regenerateAsset && typeof raw.regenerateAsset === 'object') {
      const src = raw.regenerateAsset as Record<string, unknown>;
      if (typeof src.slotId === 'string' && src.slotId.trim()) {
        fix.regenerateAsset = {
          slotId: src.slotId.trim(),
          // The brief rides into the regeneration prompt — cap it so a
          // rambling critic can't balloon the image-model call.
          ...(typeof src.brief === 'string' && src.brief.trim()
            ? { brief: src.brief.trim().slice(0, 500) }
            : {}),
        };
      }
    }

    if (raw.addElement && typeof raw.addElement === 'object') {
      const addElement = this._normalizeAddElement(
        raw.addElement as Record<string, unknown>
      );
      if (addElement) fix.addElement = addElement;
    }

    if (typeof raw.removeElement === 'string' && raw.removeElement.trim()) {
      fix.removeElement = raw.removeElement.trim();
    }

    if (typeof raw.note === 'string') {
      fix.note = raw.note;
    }

    return fix;
  }

  /**
   * Sanitize a critic-proposed addElement to the constrained spec — anything
   * outside text/shape/badge-style additions is dropped before it can reach
   * the composer.
   */
  private _normalizeAddElement(
    raw: Record<string, unknown>
  ): Fix['addElement'] | undefined {
    if (typeof raw.slotId !== 'string' || !raw.slotId.trim()) return undefined;
    if (raw.type !== 'text' && raw.type !== 'shape') return undefined;

    const spec: NonNullable<Fix['addElement']> = {
      slotId: raw.slotId.trim(),
      type: raw.type,
    };

    if (typeof raw.text === 'string') spec.text = raw.text;
    if (
      raw.shape === 'rect' ||
      raw.shape === 'ellipse' ||
      raw.shape === 'line' ||
      raw.shape === 'star'
    ) {
      spec.shape = raw.shape;
    }

    if (raw.box && typeof raw.box === 'object') {
      const src = raw.box as Record<string, unknown>;
      const box: NonNullable<NonNullable<Fix['addElement']>['box']> = {};
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        const value = src[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          box[key] = value;
        }
      }
      if (Object.keys(box).length > 0) spec.box = box;
    }

    if (raw.style && typeof raw.style === 'object') {
      const src = raw.style as Record<string, unknown>;
      const style: NonNullable<NonNullable<Fix['addElement']>['style']> = {};
      if (typeof src.fill === 'string') style.fill = src.fill;
      if (typeof src.fontFamily === 'string') style.fontFamily = src.fontFamily;
      if (typeof src.fontSize === 'number' && Number.isFinite(src.fontSize)) {
        style.fontSize = src.fontSize;
      }
      if (src.align === 'left' || src.align === 'center' || src.align === 'right') {
        style.align = src.align;
      }
      if (src.textStroke && typeof src.textStroke === 'object') {
        const stroke = src.textStroke as Record<string, unknown>;
        if (
          typeof stroke.color === 'string' &&
          typeof stroke.width === 'number' &&
          Number.isFinite(stroke.width)
        ) {
          style.textStroke = { color: stroke.color, width: stroke.width };
        }
      }
      if (typeof src.textShadow === 'boolean') style.textShadow = src.textShadow;
      if (Object.keys(style).length > 0) spec.style = style;
    }

    return spec;
  }

  private _extractJson(raw: string): unknown {
    const trimmed = raw.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  /**
   * Public-URL passthrough / local-upload inlining — see
   * `ai/vision-image-url`, which the focal-point detector shares. The `orgId`
   * stays on the signature: resolution is per-call, not per-org, but every
   * call site already threads it and dropping it would churn them all.
   */
  private async _resolveImageUrl(
    _orgId: string,
    url: string
  ): Promise<string | null> {
    return resolveVisionImageUrl(url, {
      warn: (message) => this._logger.warn(message),
      label: 'Vision critic',
      maxInlineBytes: VISION_CRITIC_MAX_INLINE_BYTES,
    });
  }

  /**
   * `_resolveImageUrl`, plus size recovery: an inline-able image (data URI or
   * local upload) over the inline cap is DOWNSCALED through sharp instead of
   * refused — a refusal made the whole critique return `skipped` and the
   * variant shipped unreviewed (happened live). `bytes` rides along whenever
   * the image is inline, so the feed-scale thumbnail can reuse them.
   */
  private async _resolveOrDownscale(
    orgId: string,
    url: string
  ): Promise<{ url: string; bytes?: Buffer } | null> {
    const resolved = await this._resolveImageUrl(orgId, url);
    if (resolved) {
      if (resolved.startsWith('data:')) {
        return {
          url: resolved,
          bytes: Buffer.from(
            resolved.slice(resolved.indexOf(',') + 1),
            'base64'
          ),
        };
      }
      return { url: resolved };
    }
    const raw = await loadVisionImageBytes(url, {
      warn: (message) => this._logger.warn(message),
      label: 'Vision critic',
    });
    if (!raw) return null;
    try {
      const downscaled = await this._downscaleToDataUri(raw);
      return {
        url: downscaled,
        bytes: Buffer.from(
          downscaled.slice(downscaled.indexOf(',') + 1),
          'base64'
        ),
      };
    } catch (err) {
      this._logger.warn(
        `Vision critic could not downscale oversized image: ${(err as Error).message}`
      );
      return null;
    }
  }

  /**
   * The design at ~feed scale (25%), as a second image for the same call —
   * legibility is judged against the pixels a feed actually shows. Fail-soft:
   * the full-size critique runs without it.
   */
  private async _thumbnailDataUri(buffer: Buffer): Promise<string | null> {
    try {
      const meta = await sharp(buffer).metadata();
      if (!meta.width) return null;
      const small = await sharp(buffer)
        .resize({ width: Math.max(1, Math.round(meta.width * 0.25)) })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: REFERENCE_IMAGE_JPEG_QUALITY })
        .toBuffer();
      return `data:image/jpeg;base64,${small.toString('base64')}`;
    } catch (err) {
      this._logger.warn(
        `Vision critic could not build the feed-scale thumbnail: ${(err as Error).message}`
      );
      return null;
    }
  }

  /** fileId → downscaled data URI (or the passthrough https URL). */
  private readonly _referenceImageCache = new Map<string, string>();

  /**
   * Resolve a reference file to something a vision provider can consume NEXT
   * TO the render. Bytes we would inline (data URIs, local uploads) are
   * downscaled through sharp first — see REFERENCE_IMAGE_MAX_EDGE. A verified
   * public HTTPS URL passes through untouched (the provider fetches it; no
   * inline payload to bound). Returns null on any failure — the caller
   * degrades to the cue-only critique.
   */
  private async _resolveReferenceImage(
    orgId: string,
    fileId: string
  ): Promise<string | null> {
    const cached = this._referenceImageCache.get(fileId);
    if (cached) return cached;
    try {
      const file = await this._fileService.getFileById(orgId, fileId);
      if (!file || !file.path) return null;

      let resolved: string | null = null;
      if (/^data:image\//i.test(file.path)) {
        resolved = await this._downscaleToDataUri(
          Buffer.from(file.path.slice(file.path.indexOf(',') + 1), 'base64')
        );
      } else if (isLocalStorageUrl(file.path)) {
        resolved = await this._downscaleToDataUri(
          await readLocalUpload(file.path)
        );
      } else if (await isSafePublicHttpsUrl(file.path)) {
        resolved = file.path;
      }

      if (resolved) {
        if (this._referenceImageCache.size >= REFERENCE_IMAGE_CACHE_MAX) {
          const oldest = this._referenceImageCache.keys().next().value;
          if (oldest !== undefined) this._referenceImageCache.delete(oldest);
        }
        this._referenceImageCache.set(fileId, resolved);
      }
      return resolved;
    } catch (err) {
      this._logger.warn(
        `Vision critic could not attach reference ${fileId}: ${(err as Error).message}`
      );
      return null;
    }
  }

  private async _downscaleToDataUri(buffer: Buffer): Promise<string> {
    const small = await sharp(buffer)
      .resize({
        width: REFERENCE_IMAGE_MAX_EDGE,
        height: REFERENCE_IMAGE_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      // JPEG drops alpha — flatten onto white so a transparent-PNG reference
      // doesn't silhouette onto black.
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: REFERENCE_IMAGE_JPEG_QUALITY })
      .toBuffer();
    return `data:image/jpeg;base64,${small.toString('base64')}`;
  }
}
