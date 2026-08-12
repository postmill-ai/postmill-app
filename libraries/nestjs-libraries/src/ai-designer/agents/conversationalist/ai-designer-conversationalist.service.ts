import '@postmill-ai/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentConfig, AgentResponse, ContextPacket } from '@reaatech/agent-mesh';
import { AIModelProvider } from '@postmill-ai/nestjs-libraries/ai/ai-model.provider';
import type {
  DesignBrief,
  FormField,
  RevisionRequest,
} from '../../ai-designer.types';
import {
  isAgentInputError,
  parseAgentInput,
} from '../../util/parse-agent-input';
import { throwIfAborted } from '../../util/throw-if-aborted';
import { isDeliveredAccept } from '../../util/accept-phrases';
import { FIXED_COPY_SEPARATOR } from '../../conductor/brief-values';
import {
  CONTACT_QUESTION,
  isContactDecline,
  needsContactQuestion,
} from './contact-intake';
import { AiDesignerSkillRouter } from '../../skills/ai-designer-skill-router.service';
import { getDesignSkill } from '../../skills/design-skill.registry';

interface ChatInput {
  type: 'chat';
  text: string;
  /** The last assistant message — the question the user is answering. */
  lastQuestion?: string;
  session: {
    mode: 'chat' | 'prompt';
    state: 'intake' | 'planning' | 'awaiting_plan' | 'executing' | 'delivered' | 'revising';
    brief: DesignBrief;
    questionsAsked: string[];
    activeDesignIds?: string[];
    /**
     * The delivered designs, LABELLED. `activeDesignIds` alone is a bare array
     * of opaque cuids with nothing to pick from — asked for "the Facebook
     * version" the classifier simply named one, and the only validation was set
     * membership, so a wrong pick was indistinguishable from a right one.
     */
    designs?: DesignCatalogueEntry[];
  };
}

/** One delivered design, as the classifier sees it. */
export interface DesignCatalogueEntry {
  /** 1-based, and the SAME number the delivery captions used. */
  ordinal: number;
  designId: string;
  /** The formats this design actually carries ("fb-post", "ig-story"). */
  formatIds?: string[];
  /** Display names for those formats ("Facebook Post"). */
  formatNames?: string[];
  /** The plan concept this design was built from, when known. */
  concept?: string;
}

interface ClassificationResult {
  intent: 'clarify' | 'revise' | 'accept' | 'general';
  text: string;
  /** Brief fields extracted from the user's free text during intake. */
  extracted?: Record<string, string>;
  revision?: Partial<RevisionRequest>;
  /** The classifier call threw/misparsed — this result is the blind fallback.
   *  Rides the response as `classifierFailed` so the conductor can count
   *  consecutive failures and surface a dead-LLM warning. */
  failed?: boolean;
}

/**
 * Brief keys the recap never narrates: the base three (handled separately),
 * server-owned bookkeeping, and machine values (skill/style ids) that would
 * read as gibberish in a sentence. Everything else collected during intake
 * (e.g. fixedCopy) is surfaced so the user can catch a mangled brief.
 */
const SUMMARY_SKIP_KEYS = new Set([
  'intent',
  'audience',
  'tone',
  'questionsAsked',
  'recapShown',
  'preferredSkill',
  'lastPlans',
  'lastDeliveredDesignIds',
  'referenceCues',
  'answeredPromptIds',
  'pendingReviseTarget',
  'skillId',
  'styleId',
  'includeLogo',
  'revisionInstruction',
  'classifierFailures',
  'llmWarningShown',
]);

/** English indefinite article by leading vowel ("an excited tone"). */
const indefiniteArticle = (word: string): string =>
  /^[aeiou]/i.test(word.trim()) ? 'an' : 'a';

@Injectable()
export class AiDesignerConversationalistService implements OnModuleInit {
  private readonly _logger = new Logger(AiDesignerConversationalistService.name);

  constructor(
    private readonly _ai: AIModelProvider,
    private readonly _skillRouter: AiDesignerSkillRouter
  ) {}

  onModuleInit() {
    registerInProcessAgent('conversationalist', this._handler.bind(this));
  }

  private _handler: InProcessHandler = async (
    context: ContextPacket,
    _agent: AgentConfig
  ): Promise<AgentResponse> => {
    // The session signal rides in metadata from the conductor — a cancelled
    // or timed-out session must not start a billable classification call.
    const signal = context.metadata?.signal as AbortSignal | undefined;
    throwIfAborted(signal);
    const parsed = parseAgentInput<ChatInput>(context.raw_input);
    if (isAgentInputError(parsed)) {
      return {
        content: JSON.stringify(parsed),
        workflow_complete: false,
      };
    }
    const input = this._normalizeInput(parsed);
    const orgId = this._extractOrgId(context);

    const classification = await this._classify(input, orgId, signal);

    const content = this._buildResponse(input, classification);

    return {
      // `classifierFailed` rides every response shape so the conductor can
      // count consecutive classification failures server-side.
      content: JSON.stringify(
        classification.failed
          ? { ...(content as Record<string, unknown>), classifierFailed: true }
          : content
      ),
      workflow_complete: false,
    };
  };

  private _normalizeInput(parsed: ChatInput): ChatInput {
    return {
      type: parsed.type ?? 'chat',
      text: parsed.text ?? '',
      lastQuestion:
        typeof parsed.lastQuestion === 'string' && parsed.lastQuestion.trim()
          ? parsed.lastQuestion.slice(0, 500)
          : undefined,
      session: {
        mode: parsed.session?.mode ?? 'chat',
        state: parsed.session?.state ?? 'intake',
        brief: parsed.session?.brief ?? { intent: '' },
        questionsAsked: parsed.session?.questionsAsked ?? [],
        activeDesignIds: parsed.session?.activeDesignIds,
        designs: Array.isArray(parsed.session?.designs)
          ? parsed.session.designs
          : undefined,
      },
    };
  }

  private _extractOrgId(context: ContextPacket): string | undefined {
    const orgId = context.metadata?.orgId;
    return typeof orgId === 'string' ? orgId : undefined;
  }

  private async _classify(
    input: ChatInput,
    orgId: string | undefined,
    signal?: AbortSignal
  ): Promise<ClassificationResult> {
    const { session, text } = input;

    const system = [
      'You are the conversationalist agent for the AI Designer feature in Postmill.',
      'Read the user message and current session state, then classify intent and return JSON.',
      '',
      'Possible intents:',
      '- clarify: more information is needed before creating or changing a design. Ask ONE focused follow-up question.',
      '- revise: the user wants to change an already-delivered design. Extract the revision instruction and any targets.',
      '- accept: the user is satisfied with the current plan, delivered design, or summarized brief.',
      '- general: greeting, small talk, or anything else.',
      '',
      'Return ONLY a JSON object with this schema:',
      '{',
      '  "intent": "clarify" | "revise" | "accept" | "general",',
      '  "text": "concise friendly response to the user",',
      '  "extracted": { "intent": "...", "audience": "...", "tone": "..." }, // intake only',
      '  "revision": { // only when intent is "revise"',
      '    "instruction": "the exact change requested",',
      '    "targetDesignId": "optional design id mentioned by the user",',
      '    "scope": "shared" | "format-only",',
      '    "targetOutputs": ["optional output/format ids"],',
      '    "targetSlots": ["optional slot ids"]',
      '  }',
      '}',
      '',
      'During intake (state "intake") the brief is collected conversationally:',
      '- ALWAYS populate "extracted" with any brief fields the message supplies — intent (what the design is about), audience (who it is for), tone (the desired mood), plus any other concrete detail (e.g. fixedCopy). Extract on EVERY turn, including answers to earlier questions; omit keys the message does not supply.',
      '- The intent MUST preserve the user\'s concrete specifics — event/occasion names, offers, dates, themes — never compress it to a generic category like "social media post". If the user\'s wording carries the specifics, reuse it.',
      '- Extract "tone" from casual phrasing too — "patriotic themed" → tone: "patriotic"; "make it funny" → tone: "funny"; "warm, heartfelt" → tone: "warm and heartfelt".',
      '- Style, mood, and aesthetic adjectives ARE the tone, in ANY intake turn: "minimal Scandinavian, warm" → tone: "minimal Scandinavian, warm"; "clean and editorial" → tone: "clean and editorial".',
      '- A field that already has a value may be REPLACED. When the user states a new style/tone/aesthetic, emit "tone" with their new wording even though the brief already carries one — the latest answer wins. "Never re-ask a question" means do not ASK again; it does NOT mean the field can never be updated.',
      '- Keep schedule, date, and recurrence specifics verbatim in the "intent". "first Friday of every month" must survive exactly; never compress it to "monthly". Compound schedule/offer sentences belong in the intent, NOT in "fixedCopy".',
      '- Extract "fixedCopy" as ATOMIC verbatim units — a coupon code, a CTA phrase, a tagline — each kept EXACTLY as the user wrote it. One unit per concept; join several units with " | ". NEVER a compound sentence gluing offer + CTA + code together.',
      '- Example: "social media post for our Labor Day Sale, coupon code LABOR26" → { "intent": "Labor Day Sale social media post", "fixedCopy": "LABOR26" }.',
      '- Example: "say Join now, 30% off with code BEAN30" → { "fixedCopy": "Join now | 30% off | BEAN30" } — three atomic units, never the whole sentence.',
      '- An offer sentence is NOT one unit, even with no CTA in it: "First box 30% off with code BEAN30" → { "fixedCopy": "30% off | BEAN30" } — the amount and the code are separate units and the framing words ("First box…with code") stay in the intent.',
      '- When the prompt below names the question the user is answering, interpret the message as an answer to THAT question when extracting fields — a short reply like "followers" to "Who is the audience?" IS the audience, even though it would not look like one out of context.',
      '- When required brief fields are still missing, intent is "clarify" and text asks ONE natural follow-up question for the next missing field, in this order: intent, audience, tone. Never re-ask a question that already has an answer in the brief.',
      '- When every required brief field is present, text is a one-line summary of the brief followed by a "ready for concepts?" confirmation ask.',
      '- When the user confirms the summary ("yes", "go ahead", "looks good"), intent is "accept".',
      '',
      'For revise scope, use "shared" for changes that should apply to every output (copy, colors, overall layout) and "format-only" for changes that target specific formats or sizes.',
      'When the user names a channel, size, or format ("only on Facebook", "the story version", "the square one"), set scope to "format-only" and put what they said into "targetOutputs" — one entry per format they named. Prefer the formatId from the design catalogue below when you can tell which one they mean; the plain word they used ("Facebook", "the story") also resolves, so ALWAYS populate it rather than leaving it empty.',
      '"targetDesignId" MUST be one of the designIds in the catalogue below, and you must be able to point at the catalogue entry that justifies it — the user named its ordinal ("variant 2", "the second one"), its concept, or a format only that design carries. If the message does not identify one, OMIT "targetDesignId" entirely; do not guess. Omitting it is correct and safe.',
      'If the user refers to "this one", "the first one", or similar without an id, prefer the first design in the catalogue.',
    ].join('\n');

    const prompt = [
      `User message: "${text}"`,
      ...(input.lastQuestion
        ? [`The user is answering this question: "${input.lastQuestion}"`]
        : []),
      '',
      'Current session state:',
      `- mode: ${session.mode}`,
      `- state: ${session.state}`,
      `- brief so far: ${JSON.stringify(session.brief)}`,
      `- questions already asked: ${JSON.stringify(session.questionsAsked)}`,
      // The catalogue, not the bare id array: an id with an ordinal, its
      // formats and its concept is something a revision request can actually be
      // matched against. The bare list is kept for sessions/paths that supply
      // no catalogue.
      session.designs?.length
        ? `- delivered designs (catalogue): ${JSON.stringify(session.designs)}`
        : `- active design ids: ${JSON.stringify(session.activeDesignIds ?? [])}`,
      '',
      'What is the user\'s intent? Return the JSON object described in your instructions.',
    ].join('\n');

    try {
      const raw = await this._ai.generateText('utility', prompt, { system, orgId, signal });
      const cleaned = this._stripMarkdownFences(raw);
      const parsed = JSON.parse(cleaned) as Partial<ClassificationResult>;

      if (
        parsed.intent &&
        ['clarify', 'revise', 'accept', 'general'].includes(parsed.intent)
      ) {
        return {
          intent: parsed.intent as ClassificationResult['intent'],
          text: typeof parsed.text === 'string' ? parsed.text : '',
          extracted: this._sanitizeExtracted(parsed.extracted),
          revision: parsed.revision,
        };
      }
    } catch (err) {
      // An abort is a cancel, not a classification failure to degrade over.
      throwIfAborted(signal);
      this._logger.warn(`Conversationalist classification failed: ${(err as Error).message}`);
      return { intent: 'general', text: text || 'How can I help?', failed: true };
    }

    return { intent: 'general', text: text || 'How can I help?' };
  }

  private _stripMarkdownFences(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.startsWith('```')) {
      const withoutPrefix = trimmed.replace(/^```[a-zA-Z]*\n?/, '');
      return withoutPrefix.replace(/\n?```$/, '');
    }
    return trimmed;
  }

  /**
   * Keep only non-empty string brief values from the classifier's extraction —
   * the result is merged into the session brief (the conductor re-sanitizes
   * the keys before persisting).
   */
  private _sanitizeExtracted(raw: unknown): Record<string, string> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' && value.trim()) {
        out[key] = value.trim().slice(0, 500);
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  private _buildResponse(
    input: ChatInput,
    classification: ClassificationResult
  ): unknown {
    const { session } = input;

    // Intake: collect the brief conversationally. Every turn can carry
    // extracted brief fields; the reply asks ONE follow-up question for the
    // next missing field until the brief is complete, then recaps and asks
    // for the green light. The form survives only as the explicit escape
    // (the user asked for it, or the same question has stalled twice).
    if (session.state === 'intake') {
      let extracted = classification.extracted;
      // First-turn backstop: when the classifier pulled no intent out of the
      // user's first substantive turn — even when it extracted OTHER fields
      // (the partial-extraction miss) — don't re-ask "What is this design
      // about?": the raw text IS the intent, carrying the user's offer/code
      // specifics verbatim. It rides along as an extracted field so the
      // conductor merges it like any other extraction. Bounded to 2000 chars
      // (well under the 64 KB brief cap): an offer late in a long brief must
      // survive into planning.
      if (
        !extracted?.intent &&
        !(session.brief.intent || '').trim() &&
        session.questionsAsked.length === 0 &&
        input.text.trim()
      ) {
        extracted = { ...(extracted ?? {}), intent: input.text.trim().slice(0, 2000) };
      }
      // Answering-field backstop: the user is answering the last intake
      // question (intent/audience/tone) and the classifier's extraction
      // missed it — adopt the raw text for THAT field (language-independent)
      // instead of re-asking a question the user just answered. Greetings,
      // acknowledgments, and "no idea" hedges are not answers and never fill
      // a field. preferredSkill is form-controlled and never filled here.
      const answeringField =
        session.questionsAsked[session.questionsAsked.length - 1];
      if (
        answeringField &&
        ['intent', 'audience', 'tone'].includes(answeringField) &&
        !extracted?.[answeringField] &&
        !((session.brief[answeringField] as string | undefined) || '').trim() &&
        this._isSubstantiveAnswer(input.text)
      ) {
        extracted = {
          ...(extracted ?? {}),
          [answeringField]: input.text.trim().slice(0, 2000),
        };
      }
      // Tone CORRECTION backstop. The fill-only branch above cannot help once
      // tone already has a value, and it keys off `questionsAsked`, which
      // stops growing at the recap stage — so a user answering the tone
      // question with a style ("minimal Scandinavian, warm") kept the stale
      // tone whenever the classifier stayed silent on that turn. Keyed off
      // `lastQuestion` (what the assistant actually just asked) and applied
      // even when tone is already set: the latest answer wins. The
      // classifier's own extraction still takes precedence when it has one.
      if (
        !extracted?.tone &&
        input.lastQuestion &&
        input.lastQuestion.trim().toLowerCase() ===
          this._questionFor('tone').toLowerCase() &&
        this._isSubstantiveAnswer(input.text)
      ) {
        extracted = {
          ...(extracted ?? {}),
          tone: input.text.trim().slice(0, 2000),
        };
      }
      // Contact-answer turn: the assistant just asked the deterministic
      // contact question (`questionsAsked` ends with 'contact'). Handled
      // deterministically, classifier-independent: a decline ("none", "no",
      // "skip") stores nothing; anything substantive is APPENDED to the
      // existing fixedCopy (pipe-separated atomic units) so it becomes
      // required verbatim copy and grounds the art director's contact lint.
      const lastAsked =
        session.questionsAsked[session.questionsAsked.length - 1];
      if (lastAsked === 'contact') {
        if (
          this._isSubstantiveAnswer(input.text) &&
          !isContactDecline(input.text)
        ) {
          const answer = input.text.trim().slice(0, 500);
          const existing =
            typeof session.brief.fixedCopy === 'string'
              ? session.brief.fixedCopy
              : '';
          extracted = {
            ...(extracted ?? {}),
            // Deterministic append wins over the classifier's own extraction
            // for this turn — an extracted `fixedCopy` would REPLACE the
            // stored units on merge, dropping earlier quoted spans.
            fixedCopy: !existing
              ? answer
              : existing.toLowerCase().includes(answer.toLowerCase())
                ? existing
                : `${existing}${FIXED_COPY_SEPARATOR}${answer}`,
          };
        } else if (extracted?.fixedCopy) {
          // A decline must not let the classifier's read of it (e.g.
          // fixedCopy: "none") become required verbatim copy.
          delete extracted.fixedCopy;
          if (Object.keys(extracted).length === 0) extracted = undefined;
        }
      }
      const brief: DesignBrief = { ...session.brief, ...extracted };
      const routed = this._skillRouter.route(brief);
      const skill = getDesignSkill(routed.skillId);
      const missingFields = this._missingRequiredFields(
        brief,
        skill?.requiredBriefFields
      );

      // Green light on the recap — the conductor advances to planning, but
      // ONLY after a recap was actually shown (server-owned `recapShown`):
      // a one-word answer classified as accept on the first turn must not
      // skip the checkpoint. A low-confidence route still needs the skill
      // picked first. A whole-message accept phrase confirms deterministically
      // — with a dead org LLM the classifier fallback is 'general', which
      // would otherwise re-emit the recap forever.
      if (
        (classification.intent === 'accept' || isDeliveredAccept(input.text)) &&
        missingFields.length === 0 &&
        !routed.lowConfidence &&
        session.brief.recapShown
      ) {
        // `fields` rides the accept too. This was the ONE intake return shape
        // that dropped the extraction, so a confirming message that ALSO
        // carried substance ("yes, and add the fine print '…'") lost it
        // wholesale. The conductor merges before it checks `confirmed`, so the
        // extra fields land in the brief that goes straight into planning.
        return {
          type: 'chat-turn',
          confirmed: true,
          ...(extracted ? { fields: extracted } : {}),
        };
      }

      if (missingFields.length > 0) {
        const nextField = missingFields[0];
        const timesAsked = session.questionsAsked.filter(
          (asked) => asked === nextField
        ).length;
        if (/\bform\b/i.test(input.text) || timesAsked >= 2) {
          return {
            type: 'form',
            // Extraction rides along under its own key (the form's `fields`
            // are UI controls) — the conductor merges it before appending
            // the form, or this turn's answer would be re-asked later.
            ...(extracted ? { extracted } : {}),
            prompt:
              'Before I can plan the design, I need a little more information.',
            fields: this._defaultFieldsFor(missingFields, session.questionsAsked),
          };
        }
        return {
          type: 'chat-turn',
          ...(extracted ? { fields: extracted } : {}),
          // The classifier's clarify text was computed against the PRE-merge
          // brief, so it can re-ask for the very field this turn's extraction
          // just supplied. On an extracting turn the deterministic question
          // for the post-merge next field wins; the classifier's phrasing is
          // kept only when nothing was extracted (pre-merge == post-merge).
          reply:
            (!extracted && classification.intent === 'clarify' && classification.text) ||
            this._questionFor(nextField),
        };
      }

      // Low-confidence routing: the brief could be several kinds of design.
      // Ask the user to pick instead of silently committing to a weak guess —
      // the answer lands in brief.preferredSkill and overrides routing.
      if (routed.lowConfidence) {
        const options = [
          { value: routed.skillId, label: skill?.title ?? routed.skillId },
          ...routed.alternatives.map((alt) => ({
            value: alt.skillId,
            label: alt.title,
          })),
        ];
        return {
          type: 'form',
          // Same extraction passthrough as the stall form above — answering a
          // question and hitting the low-confidence skill pick is one turn.
          ...(extracted ? { extracted } : {}),
          prompt:
            'I can take this a few different ways — what kind of design is it?',
          fields: [
            {
              name: 'preferredSkill',
              type: 'radio',
              label: 'What kind of design is this?',
              options,
            },
          ],
        };
      }

      // One MORE intake question, after tone and before the recap: a
      // business/promotional brief with no phone number or URL anywhere
      // produces designs that NEED a contact CTA target — live, the art
      // director first shipped "(PHONE NUMBER NEEDED)" placeholders and then
      // invented numbers, and copy-grounding now strips both, leaving no CTA
      // target. Ask the user once; the answer (handled above) lands in
      // fixedCopy. Asked at most once via questionsAsked ('contact').
      if (
        needsContactQuestion({
          ...brief,
          questionsAsked: session.questionsAsked,
        })
      ) {
        return {
          type: 'chat-turn',
          // 'contact' is not a brief field, so the conductor's own
          // missing-field bookkeeping can't record it — this names the
          // question just asked for questionsAsked tracking.
          asked: 'contact',
          ...(extracted ? { fields: extracted } : {}),
          reply: CONTACT_QUESTION,
        };
      }

      // Everything collected — recap and ask for the green light. `recap:
      // true` marks the checkpoint turn; the conductor persists it as the
      // server-owned `recapShown` gate that a later accept must clear. The
      // reply is ALWAYS the deterministic summary — the classifier's text is
      // an acknowledgment, not a recap (live bug: it returned a stray tone
      // question here, the turn still marked the checkpoint shown, and the
      // next one-word answer confirmed straight through to planning with no
      // recap ever displayed).
      return {
        type: 'chat-turn',
        recap: true,
        ...(extracted ? { fields: extracted } : {}),
        reply: this._summaryFor(brief),
      };
    }

    // Delivered / revising: parse revision requests.
    if (session.state === 'delivered' || session.state === 'revising') {
      if (classification.intent === 'revise') {
        const revision = this._normalizeRevision(
          classification.revision,
          input.text,
          session.activeDesignIds,
          session.designs
        );
        return { type: 'revision', revision };
      }

      if (classification.intent === 'accept') {
        // A distinct type (not a plain reply) so the conductor can run the
        // template auto-save that the removed delivery form used to trigger.
        return {
          type: 'accept',
          text:
            classification.text ||
            'Great! Let me know if you need any other changes.',
        };
      }
    }

    // Default: general narration / reply.
    return {
      type: 'reply',
      text:
        classification.text ||
        'I\'m not sure I understood. Can you tell me more about what you\'d like to design?',
    };
  }

  /**
   * Base intake fields ∪ the routed skill's `requiredBriefFields` — a meme
   * needs a tone, an ad needs an audience, and a skill that asks for more
   * (e.g. fixedCopy) gets it collected here rather than after planning.
   */
  private _missingRequiredFields(
    brief: DesignBrief,
    skillRequired: string[] = []
  ): string[] {
    const required = [...new Set(['intent', 'audience', 'tone', ...skillRequired])];
    return required.filter((field) => {
      const value = brief[field];
      return value === undefined || value === null || value === '';
    });
  }

  /**
   * A free-text answer worth adopting for the asked intake field: more than
   * a bare greeting/acknowledgment and not a "no idea" hedge — adopting
   * those as brief values would move the conversation on with junk and the
   * user's real answer would never be collected.
   */
  private _isSubstantiveAnswer(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length < 2) return false;
    return !/^(hi|hello|hey|yo|hola|yes|yeah|yep|ok|okay|sure|no|nope|si|sí|dunno|idk|not sure\b.*|i don'?t know\b.*|whatever|anything|up to you|you (choose|pick|decide)\b.*)[.!?]*$/i.test(
      trimmed
    );
  }

  /** Follow-up question for a missing field. Wins over the classifier's
   *  clarify text on any turn where extraction advanced the brief (see
   *  `_buildResponse`) — it is computed against the post-merge brief. */
  private _questionFor(field: string): string {
    const questions: Record<string, string> = {
      intent: 'What is this design about?',
      audience: 'Who is the audience?',
      tone: 'What tone should it have — for example funny, professional, or inspiring?',
      fixedCopy: 'Is there any exact copy that must appear in the design?',
    };
    return questions[field] ?? `Could you share the ${field}?`;
  }

  /** Fallback one-line recap when the classifier produced no summary text. */
  private _summaryFor(brief: DesignBrief): string {
    const parts = [
      brief.intent && `a design about "${brief.intent}"`,
      brief.audience && `for ${brief.audience}`,
      brief.tone && `with ${indefiniteArticle(brief.tone)} ${brief.tone} tone`,
    ].filter(Boolean);
    // Every other collected detail (coupon codes, deadlines, …) rides along:
    // the recap is the user's only checkpoint before planning, so a detail
    // dropped here becomes a wrong design. Server-owned bookkeeping keys and
    // the raw field values the classifier merges are excluded.
    for (const [key, value] of Object.entries(brief)) {
      if (SUMMARY_SKIP_KEYS.has(key)) continue;
      if (typeof value !== 'string' || !value.trim()) continue;
      // `fixedCopy` is stored as atomic units joined by a MACHINE separator.
      // Rendering it verbatim leaked that separator into the recap sentence
      // ('with the exact copy "with love, the whole crew | Since 2019"'), which
      // reads as if the pipe were part of the copy the user asked for.
      parts.push(
        key === 'fixedCopy'
          ? `with the exact copy ${value
              .split(FIXED_COPY_SEPARATOR)
              .map((unit) => unit.trim())
              .filter(Boolean)
              .map((unit) => `"${unit}"`)
              .join(' and ')}`
          : `with ${key} "${value}"`
      );
    }
    return `Here's what I have: ${parts.join(', ')}. Ready for concepts?`;
  }

  private _defaultFieldsFor(
    missing: string[],
    questionsAsked: string[]
  ): FormField[] {
    const definitions: Record<string, FormField> = {
      intent: {
        name: 'intent',
        type: 'text',
        label: 'What is this post about?',
        placeholder: 'e.g. A meme about remote work',
      },
      audience: {
        name: 'audience',
        type: 'text',
        label: 'Who is the audience?',
        placeholder: 'e.g. Instagram followers',
      },
      tone: {
        name: 'tone',
        type: 'select',
        label: 'What tone should it have?',
        options: [
          { value: 'funny', label: 'Funny' },
          { value: 'professional', label: 'Professional' },
          { value: 'playful', label: 'Playful' },
          { value: 'inspiring', label: 'Inspiring' },
          { value: 'urgent', label: 'Urgent' },
        ],
      },
      fixedCopy: {
        name: 'fixedCopy',
        type: 'text',
        label: 'Any exact copy that must appear?',
        placeholder: 'e.g. SAVE20 (join several with " | ")',
      },
    };

    // Prefer fields that have not been asked yet, then any remaining missing fields.
    const ordered = missing.sort((a, b) => {
      const aAsked = questionsAsked.includes(a) ? 1 : 0;
      const bAsked = questionsAsked.includes(b) ? 1 : 0;
      return aAsked - bAsked;
    });

    return ordered
      .slice(0, 3)
      .map(
        (field) =>
          definitions[field] ?? {
            name: field,
            type: 'text',
            label: `Could you share the ${field}?`,
          }
      )
      .filter((field): field is FormField => !!field);
  }

  /**
   * The 1-based variant number the user named, if any — "variant 2", "the
   * second one", "#3". Deterministic and language-simple on purpose: it only
   * has to beat a guess.
   */
  private _spokenOrdinal(text: string): number | undefined {
    const words: Record<string, number> = {
      first: 1,
      second: 2,
      third: 3,
      fourth: 4,
      fifth: 5,
      sixth: 6,
      seventh: 7,
      eighth: 8,
      ninth: 9,
      tenth: 10,
    };
    const wordMatch = new RegExp(
      `\\b(${Object.keys(words).join('|')})\\b`,
      'i'
    ).exec(text);
    if (wordMatch) return words[wordMatch[1].toLowerCase()];
    const numeric =
      // `#` needs its own alternative: `\b` never precedes a non-word
      // character, so inside the word-boundaried group "#3" could never match.
      /(?:\b(?:variant|version|option|design)\s*#?\s*|#\s*)(\d{1,2})\b/i.exec(
        text
      );
    if (numeric) {
      const value = Number(numeric[1]);
      if (value >= 1 && value <= 10) return value;
    }
    return undefined;
  }

  private _normalizeRevision(
    revision: Partial<RevisionRequest> | undefined,
    fallbackText: string,
    activeDesignIds?: string[],
    designs?: DesignCatalogueEntry[]
  ): RevisionRequest {
    const instruction =
      typeof revision?.instruction === 'string' && revision.instruction.trim().length > 0
        ? revision.instruction.trim()
        : fallbackText.trim() || 'Apply the requested change';

    let targetDesignId: string | undefined =
      typeof revision?.targetDesignId === 'string'
        ? revision.targetDesignId
        : undefined;

    // An ordinal the user actually said ("variant 2", "the second one") beats
    // the classifier's pick: the pick is an opaque cuid chosen from a list, and
    // set membership — the only check there has ever been — cannot tell a right
    // one from a wrong one. Live, "the Facebook version" came back as V2's id.
    const ordinal = this._spokenOrdinal(fallbackText);
    const named = ordinal
      ? designs?.find((entry) => entry.ordinal === ordinal)
      : undefined;
    if (named) {
      targetDesignId = named.designId;
    } else if (
      targetDesignId &&
      designs?.length &&
      !designs.some((entry) => entry.designId === targetDesignId)
    ) {
      // The classifier invented an id that is not in the catalogue at all.
      targetDesignId = undefined;
    }

    if (!targetDesignId && designs?.length) {
      targetDesignId = designs[0].designId;
    }
    if (!targetDesignId && activeDesignIds && activeDesignIds.length > 0) {
      targetDesignId = activeDesignIds[0];
    }

    const scope: RevisionRequest['scope'] =
      revision?.scope === 'format-only' ? 'format-only' : 'shared';

    const targetOutputs = Array.isArray(revision?.targetOutputs)
      ? revision.targetOutputs.filter((id): id is string => typeof id === 'string')
      : undefined;

    const targetSlots = Array.isArray(revision?.targetSlots)
      ? revision.targetSlots.filter((id): id is string => typeof id === 'string')
      : undefined;

    const normalized: RevisionRequest = {
      instruction,
      scope,
    };

    if (targetDesignId) {
      normalized.targetDesignId = targetDesignId;
    }
    if (targetOutputs?.length) {
      normalized.targetOutputs = targetOutputs;
    }
    if (targetSlots?.length) {
      normalized.targetSlots = targetSlots;
    }

    return normalized;
  }
}
