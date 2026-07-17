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
  'skillId',
  'pendingReviseTarget',
  'questionsAsked',
  'referenceCues',
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

/** Merge sanitized form values into the brief, bounded by the caps above. */
export const mergeBriefValues = (
  existing: DesignBrief,
  values: Record<string, unknown>,
  replyTo: string
): DesignBrief => {
  const questionsAsked = [...(existing.questionsAsked ?? []), replyTo].slice(
    -MAX_QUESTIONS_ASKED
  );
  const merged: DesignBrief = {
    ...existing,
    ...values,
    intent: existing.intent || (values.intent as string) || '',
    questionsAsked,
  };
  if (JSON.stringify(merged).length > MAX_BRIEF_BYTES) {
    return { ...existing, questionsAsked };
  }
  return merged;
};
