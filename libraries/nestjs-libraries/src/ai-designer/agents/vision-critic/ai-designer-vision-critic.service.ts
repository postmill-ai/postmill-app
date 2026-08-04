import '@postmill-ai/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentResponse, ContextPacket } from '@reaatech/agent-mesh';
import { AiDefaultsService } from '@postmill-ai/nestjs-libraries/ai/defaults/ai-defaults.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import { resolveVisionImageUrl } from '@postmill-ai/nestjs-libraries/ai/vision-image-url';
import type {
  DesignPlan,
  Fix,
  FixScope,
  VisionFinding,
} from '../../ai-designer.types';
import {
  isAgentInputError,
  parseAgentInput,
} from '../../util/parse-agent-input';
import { throwIfAborted } from '../../util/throw-if-aborted';

const VISION_CRITIC_MAX_INLINE_BYTES = 2 * 1024 * 1024;

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
      'Decoration is deliberate and sparse. Competing decorative marks, or ornament with no purpose, fails — the fix is to REMOVE, never to add.',
    weight: 0.5,
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
];

interface CritiqueRequest {
  type: 'critique-request';
  contactSheetUrl: string;
  plans?: DesignPlan[];
  outputs: { formatId: string; width: number; height: number }[];
  rubric: {
    criteria: { name: string; description: string; weight: number }[];
  };
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

    const payload = parseAgentInput<CritiqueRequest | InterpretRequest>(
      context.raw_input
    );
    if (isAgentInputError(payload)) {
      return {
        content: JSON.stringify(payload),
        workflow_complete: false,
      };
    }

    if (payload.type === 'interpret-request') {
      const cues = await this.interpretReferences(orgId, payload.fileIds, signal);
      return {
        content: JSON.stringify({ type: 'interpretations', cues }),
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
  ): Promise<string[]> {
    const cues: string[] = [];
    await Promise.all(
      fileIds.map(async (id) => {
        throwIfAborted(signal);
        try {
          const file = await this._fileService.getFileById(orgId, id);
          // Defense-in-depth: the repository already scopes to the org.
          if (!file || !file.path) return;
          const imageUrl = await this._resolveImageUrl(orgId, file.path);
          if (!imageUrl) return;
          const prompt =
            'Describe this image concisely for a design assistant. List the dominant colors, mood/style, any text or logos, and the main subject. Keep it under 80 words.';
          const raw = await this._aiDefaults.vision(orgId, imageUrl, prompt, { signal });
          const text = typeof raw === 'string' ? raw : String(raw);
          if (text.trim()) cues.push(text.trim());
        } catch (err) {
          // A cancel is not a per-file interpretation failure.
          throwIfAborted(signal);
          this._logger.warn(
            `Reference interpretation failed for ${id}: ${(err as Error).message}`
          );
        }
      })
    );
    return cues;
  }

  private async _critique(
    orgId: string,
    payload: CritiqueRequest,
    signal?: AbortSignal
  ): Promise<{ findings: VisionFinding[]; skipped: boolean }> {
    const imageUrl = await this._resolveImageUrl(orgId, payload.contactSheetUrl);
    if (!imageUrl) {
      // Not a clean pass: the evidence never reached the model (over the
      // inline size cap, unreadable file, …) — flag it as skipped.
      return { findings: [], skipped: true };
    }

    const prompt = this._buildPrompt(payload);
    const raw = await this._aiDefaults.vision(orgId, imageUrl, prompt, { signal });

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

  private _buildPrompt(payload: CritiqueRequest): string {
    // Every skill's rubric gets the base criteria appended centrally (a
    // headline spilling past its band, baked-in asset text, a framed inset,
    // illegible-at-thumbnail copy, wrong copy, or misaligned/colliding text
    // is a defect no matter the genre). The composer's font-size clamp and
    // overlap guard are the deterministic backstops.
    const criteria = [
      ...payload.rubric.criteria,
      ...BASE_CRITERIA.filter(
        (base) => !payload.rubric.criteria.some((c) => c.name === base.name)
      ),
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
    // rendered doc without them.
    const planSummary = (payload.plans ?? [])
      .map((p) => {
        const slots = (p.slots ?? [])
          .map((s) => `        - ${s.id} (${s.kind}, role=${s.role})`)
          .join('\n');
        return [
          `  - variant ${p.variantId}: ${p.skill}`,
          `    concept: ${p.concept}`,
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

    return `You are a meticulous visual-design critic reviewing a contact sheet of generated design variants.

Evaluate the contact sheet against this rubric:
${criteria}

Outputs and channel-safe zones:
${outputLines}

${planSummary ? `Design plans:\n${planSummary}` : ''}

${expectedCopy ? `Expected copy (the render must show exactly this text; letter case may differ per the style preset — e.g. an all-caps headline transform — so judge text_accuracy case-insensitively):\n${expectedCopy}` : ''}

${docSummary ? `Design doc elements (authoritative geometry/colors per output — use them to catch low-contrast fills and overlapping/occluding elements the pixels may hide):\n${docSummary}` : ''}

Look at the contact sheet and identify concrete, actionable visual issues. For each issue, produce a finding with:
- "formatId" (optional): which output format is affected, if known.
- "slotId" (optional): which design slot is affected, if known.
- "criterion" (optional): the name of the rubric criterion above that this finding violates (e.g. "brand_safety", "text_fit") — always include it when the finding maps to one; the repair strategy depends on it.
- "issue": a short, specific description of the problem (e.g. "Bottom caption is too close to the Instagram Reel bottom-UI safe zone and may be covered by captions", "Headline text is too small to read at thumbnail size", "Light text on a bright background lacks contrast").
- "fix" (optional): an object describing the fix, with one of these shapes:
  - "scope": "shared" or "format-only"
  - "targetSlots": array of slot ids the fix applies to
  - "geometry": partial element geometry such as { x, y, width, height, fontSize }
  - "style": partial style such as { fill, stroke, opacity, fontFamily, align ("left"|"center"|"right"), verticalAlign ("top"|"middle"|"bottom"), textStroke { color, width }, textShadow (true = add a default shadow, false = remove it) }
  - "text": { slotId, newText } — rewrite the copy of a TEXT slot only; never target an image slot with a text fix
  - "regenerateAsset": { slotId, brief? } — regenerate the underlying imagery for that slot; the ONLY fix for a no_baked_in_text, text_accuracy or brand_safety defect inside a generated photo: imagery containing baked-in text, letters, logos, watermarks, or a recognizable third-party brand mark / branded product / celebrity likeness must be fixed with regenerateAsset targeting the image slot — never with a text fix. Optional "brief" adds guidance for the regeneration (subject, mood, what to avoid — e.g. "generic unbranded sneaker, no logos or brand marks")
  - "addElement": { slotId, type: "text" | "shape", text?, shape?, box? { x, y, width, height }, style? { fill, fontFamily, fontSize, align, textStroke, textShadow } } — add a small text/shape/badge-style element
  - "removeElement": a slot id to remove from the targeted outputs
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
            const imageUrl = await this._resolveImageUrl(orgId, o.url);
            if (!imageUrl) return;
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
    if (typeof candidate.criterion === 'string' && candidate.criterion.trim()) {
      finding.criterion = candidate.criterion.trim().slice(0, 60);
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
}
