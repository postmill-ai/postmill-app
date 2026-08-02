import type { DesignBrief } from '../ai-designer.types';

/**
 * Brief keys the server owns. `form:submit` values are merged into the session
 * brief wholesale; without this list a client could overwrite `lastPlans` (and
 * have `accept:plan` execute an arbitrarily long, attacker-shaped plan list) or
 * redirect `pendingReviseTarget`. Server-side writers set these keys directly
 * on the brief object, never through the values merge.
 */
export const RESERVED_BRIEF_KEYS = new Set([
  'lastPlans',
  'lastDeliveredDesignIds',
  'skillId',
  'pendingReviseTarget',
  'questionsAsked',
  'referenceCues',
  'recapShown',
  'classifierFailures',
  'llmWarningShown',
]);

/**
 * Delivery-form control values. They drive the form handler directly and are
 * not brief content — merging them would accumulate `action`/`variantId`/…
 * in the persisted brief JSON and ride into every later agent prompt.
 */
export const FORM_CONTROL_KEYS = new Set([
  'action',
  'variantId',
  'dontSaveTemplate',
  'instruction',
]);

/** Return `values` without the server-owned brief keys and form controls. */
export const sanitizeBriefValues = (
  values: Record<string, unknown>
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!RESERVED_BRIEF_KEYS.has(key) && !FORM_CONTROL_KEYS.has(key)) {
      out[key] = value;
    }
  }
  return out;
};

/**
 * Bounds on the merged brief. Every form submit can add up to the gateway's
 * 32 KB of arbitrary keys and the whole brief is serialized into later agent
 * prompts — without a cap a long session inflates the row and every prompt's
 * token cost. A merge that would push the serialized brief past the cap keeps
 * the existing brief (only `questionsAsked` still advances, itself capped).
 */
export const MAX_BRIEF_BYTES = 64 * 1024;
export const MAX_QUESTIONS_ASKED = 50;

/**
 * TLD allowlist shared by the spoken-URL normalizer here and the art
 * director's offer-token URL extraction — one list, so a domain the
 * normalizer produces is always a domain the token check recognizes.
 */
export const URL_TLDS = [
  'com',
  'co',
  'shop',
  'net',
  'io',
  'org',
  'ai',
  'app',
  'dev',
  'store',
] as const;

/**
 * Spoken-style URLs in free text ("glowlab dot shop", "neonkickz dotco" →
 * dotted domains). Users dictate briefs; the un-normalized form rides into
 * plan copy and offer-token checks as a non-URL. Conservative by design: the
 * separator must be a standalone "dot" word and the TLD must be in the list.
 */
const SPOKEN_URL_RE = new RegExp(
  `\\b([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\\s+dot\\s*(${URL_TLDS.join('|')})\\b`,
  'gi'
);

export const normalizeSpokenUrls = (value: string): string =>
  value.replace(
    SPOKEN_URL_RE,
    (_match, name: string, tld: string) => `${name}.${tld.toLowerCase()}`
  );

/**
 * Quoted spans in the intent ('COFFEE, PERFECTED', "Join now") are copy the
 * user wants verbatim — but the classifier only fills `fixedCopy` for
 * explicit "exact" asks, so quoted taglines carried no verbatim semantics.
 * Conservative by design: a span needs a closing quote of the SAME kind
 * (straight or curly, single or double), 2–80 chars, and single quotes must
 * sit on word boundaries so apostrophes (don't, it's) never match.
 */
const QUOTED_SPAN_RES = [
  /"([^"\n]{2,80})"/g,
  /“([^“”\n]{2,80})”/g,
  /(?<![\p{L}\p{N}])'([^'\n]{2,80})'(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])‘([^‘’\n]{2,80})’(?![\p{L}\p{N}])/gu,
];

/** Separator between atomic fixed-copy units ("Join now | BEAN30"). */
export const FIXED_COPY_SEPARATOR = ' | ';

/** Cap from `DesignBriefSchema.fixedCopy` — never grow it past validation. */
const MAX_FIXED_COPY_LENGTH = 5000;

/** Cap from `DesignBriefSchema.intent` — never grow it past validation. */
export const MAX_INTENT_LENGTH = 5000;

const normalizeForContainment = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, ' ').trim();

export const extractQuotedSpans = (text: string): string[] => {
  const spans: string[] = [];
  for (const re of QUOTED_SPAN_RES) {
    for (const m of text.matchAll(re)) {
      const span = m[1].trim();
      if (span.length >= 2) spans.push(span);
    }
  }
  return spans;
};

/** Merge sanitized form values into the brief, bounded by the caps above.
 *  `replyTo` (a prompt id, the intake field just asked, or — from the intake
 *  form path — the submitted field names) is appended to `questionsAsked`
 *  when given.
 *
 *  `rawText` is THIS turn's user message, when there is one. `intent` is
 *  pinned to the first substantive turn on purpose (so "yes" / "looks good"
 *  can never pollute skill routing or the downstream prompts), which means
 *  scanning `intent` alone re-reads message 1 forever: a quoted fine-print
 *  line or badge the user adds on turn 2+ never reached `fixedCopy` at all.
 *  Passing the raw message here scans it for quoted spans WITHOUT letting it
 *  near `intent`. */
export const mergeBriefValues = (
  existing: DesignBrief,
  values: Record<string, unknown>,
  replyTo?: string | string[],
  rawText?: string
): DesignBrief => {
  const asked = replyTo
    ? Array.isArray(replyTo)
      ? replyTo
      : [replyTo]
    : [];
  const questionsAsked = [
    ...(existing.questionsAsked ?? []),
    ...asked,
  ].slice(-MAX_QUESTIONS_ASKED);
  const merged: DesignBrief = {
    ...existing,
    ...values,
    intent: existing.intent || (values.intent as string) || '',
    questionsAsked,
  };
  // Spoken-URL normalization runs on the MERGED brief (carried-over fields
  // included) so every later consumer — planning, offer-token checks, copy —
  // sees the dotted domain. Idempotent: an already-dotted URL never matches.
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === 'string') {
      (merged as Record<string, unknown>)[key] = normalizeSpokenUrls(value);
    }
  }
  // Quoted spans become fixedCopy atomic units, deterministic and
  // classifier-independent. Runs AFTER the spoken-URL normalization so a
  // quoted "northbean dot shop" lands already dotted (the raw message gets the
  // same normalization here). Scanned across the pinned `intent` UNION this
  // turn's raw message — see the note on `rawText` above. Spans the existing
  // fixedCopy already carries (case-insensitive, whitespace-normalized
  // containment) are skipped, so re-scanning the intent every turn is a no-op.
  const spanSources = [
    typeof merged.intent === 'string' ? merged.intent : '',
    typeof rawText === 'string' && rawText ? normalizeSpokenUrls(rawText) : '',
  ].filter(Boolean);
  if (spanSources.length > 0) {
    let fixedCopy =
      typeof merged.fixedCopy === 'string' ? merged.fixedCopy : '';
    const spans = [
      ...new Set(spanSources.flatMap((source) => extractQuotedSpans(source))),
    ];
    for (const span of spans) {
      if (normalizeForContainment(fixedCopy).includes(normalizeForContainment(span))) {
        continue;
      }
      const candidate = fixedCopy
        ? `${fixedCopy}${FIXED_COPY_SEPARATOR}${span}`
        : span;
      if (candidate.length > MAX_FIXED_COPY_LENGTH) break;
      fixedCopy = candidate;
    }
    if (fixedCopy) {
      merged.fixedCopy = fixedCopy;
    }
  }
  if (JSON.stringify(merged).length > MAX_BRIEF_BYTES) {
    return { ...existing, questionsAsked };
  }
  return merged;
};
