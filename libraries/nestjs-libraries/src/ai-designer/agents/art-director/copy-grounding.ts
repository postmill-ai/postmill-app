import type { DesignPlan } from '../../ai-designer.types';
import { CTA_FRAGMENT_NOUNS, CTA_VERBS } from '../../skills/copy-rules';

/**
 * Inverse fact-check on plan copy.
 *
 * The prompt's fact-fidelity rules and `_planMissingTokens` check one
 * direction only — that the brief's tokens made it INTO the plan. Nothing
 * checked the other direction, and it showed live: a plain "buy 1 get 1
 * free" brief shipped a "TONIGHT ONLY" badge, an "ENDS TONIGHT. SELECT
 * PIZZAS ONLY." legal line, and a "B1G1 FREE" headline — urgency, scope
 * qualifiers and jargon the user never stated, presented as fact.
 *
 * The lexicon is phrase-level, not word-level: "tonight" alone in a brief
 * about a concert is fine; the lint only fires on the claim shapes
 * promotional copy fabricates. A hit is grounded (and kept) when the brief's
 * own words contain it.
 */

export interface UngroundedClaim {
  slotId: string;
  phrase: string;
}

/** Claim shapes a plan may only carry when the brief states them. */
const CLAIM_PATTERNS: RegExp[] = [
  /\btonight(?:\s+only)?\b/gi,
  /\btoday\s+only\b/gi,
  /\bone\s+(?:day|night|week)\s+only\b/gi,
  /\bends\s+(?:tonight|today|soon|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
  /\bhurry\b/gi,
  /\blimited[-\s]time\b/gi,
  /\blast\s+chance\b/gi,
  /\bwhile\s+(?:supplies|stocks?|quantities)\s+last\b/gi,
  /\bselect\s+\w+\s+only\b/gi,
  /\bparticipating\s+\w+\s+only\b/gi,
  /\bexclusions\s+apply\b/gi,
  /\bfinal\s+(?:hours?|days?|week)\b/gi,
  /\bthis\s+week(?:end)?\s+only\b/gi,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\s+only\b/gi,
  /\bexpires?\s+(?:tonight|today|soon|\d[\d/.-]*|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
];

/** Offer-mechanics jargon: never acceptable unless the user typed it. */
const JARGON_PATTERNS: RegExp[] = [
  /\bB\d\s?G\d\b/gi,
  /\bBOGO\b/gi,
  /\b\dF\d\b/gi,
];

/**
 * Contact facts: a phone number in a design is a REAL number people will
 * dial. The model invented "(555) 123-4567" and "1-800-VAN-SUPPLY" for a
 * brief that named no number at all — worse than a placeholder, because it
 * ships looking true. Grounded iff the brief contains it, like every claim.
 *
 * Exported: the conversationalist's contact-intake step reuses these to tell
 * whether the brief already carries a phone number (same shapes the lint
 * grounds against).
 */
export const CONTACT_PATTERNS: RegExp[] = [
  /\(\d{3}\)\s?\d{3}[-.\s]?\d{4}/g,
  /\b\d{3}[-.]\d{3}[-.]\d{4}\b/g,
  /\b1[-\s]?[87]\d{2}[-\s][A-Z0-9]{3,}(?:[-\s][A-Z0-9]{2,})*\b/g,
];

/**
 * Placeholder copy: the model's way of asking for data mid-design. The
 * fact-fidelity rule says OMIT a slot whose fact the brief doesn't supply —
 * instead "(PHONE NUMBER NEEDED)" shipped as display type, live. These are
 * never groundable; the slot dies rather than the placeholder shipping.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  // Parenthesized asks: "(PHONE NUMBER NEEDED)", "(insert address)". Narrow —
  // real copy like "no appointment needed" stays untouched.
  /\([^()\n]{0,50}\b(?:needed|required|goes here|here)\)/gi,
  /\b(?:phone(?:\s+number)?|number|url|website|address|logo)\s+(?:needed|required)\b/gi,
  /\byour\s+(?:phone|number|text|url|website|address|name)\s+here\b/gi,
  /\bTBD\b/g,
  /\bXXX+\b/g,
  /\bplaceholder\b/gi,
  /\[[^\]\n]{0,60}\]/g,
];

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The user-authored text a claim can be grounded in: intent, fixedCopy, tone,
 * audience — plus reference cues, because a reference clone legitimately
 * repeats the reference's own urgency line.
 */
export const briefCorpus = (brief: {
  intent?: string;
  fixedCopy?: string;
  tone?: string;
  audience?: string;
  referenceCues?: string[];
}): string =>
  normalize(
    [
      brief.intent,
      brief.fixedCopy,
      brief.tone,
      brief.audience,
      ...(brief.referenceCues ?? []),
    ]
      .filter((v): v is string => typeof v === 'string')
      .join(' ')
  );

/** A claim is grounded when the corpus contains it — "TONIGHT ONLY" also
 *  counts as grounded when the brief says just "tonight": the qualifier word
 *  is presentation, the time claim is the fact being checked. */
const isGrounded = (phrase: string, corpus: string): boolean => {
  const norm = normalize(phrase);
  if (corpus.includes(norm)) return true;
  const withoutOnly = norm.replace(/\s*\bonly\b\s*/g, ' ').trim();
  return withoutOnly.length > 0 && corpus.includes(withoutOnly);
};

/** Every ungrounded claim/jargon hit across the plan's texts. */
export const findUngroundedClaims = (
  plan: DesignPlan,
  corpus: string
): UngroundedClaim[] => {
  const out: UngroundedClaim[] = [];
  for (const [slotId, text] of Object.entries(plan.texts ?? {})) {
    if (typeof text !== 'string') continue;
    for (const pattern of [
      ...CLAIM_PATTERNS,
      ...JARGON_PATTERNS,
      ...CONTACT_PATTERNS,
    ]) {
      for (const m of text.matchAll(pattern)) {
        if (!isGrounded(m[0], corpus)) {
          out.push({ slotId, phrase: m[0] });
        }
      }
    }
    // Placeholders are ungrounded by definition — a user typing "(phone
    // number needed)" verbatim into a brief is not a thing.
    for (const pattern of PLACEHOLDER_PATTERNS) {
      for (const m of text.matchAll(pattern)) {
        out.push({ slotId, phrase: m[0] });
      }
    }
  }
  return out;
};

/** Leftover separators after a phrase is cut out ("• ", " · ", dangling
 *  periods) — stripped so the remaining copy still reads as a line. */
const tidy = (value: string): string =>
  value
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!•·])/g, '$1')
    .replace(/(?:[.•·,|]\s*){2,}/g, '. ')
    .replace(/^[\s.,!•·|-]+/, '')
    .replace(/[\s,•·|-]+$/, '')
    .trim();

/**
 * Deterministic backstop after the repair retry: cut each still-ungrounded
 * phrase out of its slot text. A slot whose text dies entirely (a fabricated
 * legal line, an urgency badge) is dropped whole — texts entry and slot —
 * matching the prompt's own rule: omit the slot rather than invent the fact.
 * Returns log descriptions.
 */
export const stripUngroundedClaims = (
  plan: DesignPlan,
  claims: UngroundedClaim[]
): string[] => {
  const stripped: string[] = [];
  if (!plan.texts) return stripped;
  // Longest phrase first: "ENDS TONIGHT" contains "TONIGHT", and cutting the
  // short match first would strand the verb ("ENDS.") in the copy.
  const ordered = [...claims].sort(
    (a, b) => b.phrase.length - a.phrase.length
  );
  for (const { slotId, phrase } of ordered) {
    const current = plan.texts[slotId];
    if (typeof current !== 'string') continue;
    const next = tidy(
      current.replace(
        new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        ' '
      )
    );
    if (/[a-z0-9]/i.test(next)) {
      plan.texts[slotId] = next;
      stripped.push(`"${phrase}" cut from ${slotId}`);
    } else {
      delete plan.texts[slotId];
      plan.slots = (plan.slots ?? []).filter((s) => s.id !== slotId);
      stripped.push(`"${phrase}" emptied ${slotId}; slot dropped`);
    }
  }
  return stripped;
};

/**
 * CTA lint: a real command, not a label or a fragment. Word-count limits are
 * `_enforceSlotCopyLimits`' job; this checks the shape of what remains.
 */
export const lintCta = (text: string): boolean => {
  const words = text
    .replace(/[•|]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  const first = words[0].toLowerCase().replace(/[^a-z]/g, '');
  if (!CTA_VERBS.has(first)) return false;
  if (
    words.length === 2 &&
    CTA_FRAGMENT_NOUNS.has(words[1].toLowerCase().replace(/[^a-z]/g, ''))
  ) {
    return false;
  }
  return true;
};
