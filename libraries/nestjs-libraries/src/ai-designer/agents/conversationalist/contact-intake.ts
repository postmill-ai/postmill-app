import type { DesignBrief } from '../../ai-designer.types';
import { URL_TLDS } from '../../conductor/brief-values';
import { CONTACT_PATTERNS } from '../art-director/copy-grounding';

/**
 * Contact-info intake step.
 *
 * Service/promotional briefs (pool cleaning, live — twice) produce designs
 * that NEED a contact CTA target, but the brief never contains one. The art
 * director first shipped "(PHONE NUMBER NEEDED)" placeholders, then INVENTED
 * numbers ("(555) 123-4567", "1-800-VAN-SUPPLY"). Both are now lint-stripped
 * upstream (copy-grounding), which is correct but leaves the design with no
 * CTA target at all. The right fix is asking the USER during chat intake —
 * once, after tone and before the recap. The answer lands in `fixedCopy`, so
 * it becomes REQUIRED verbatim copy AND grounds the contact-fact lint.
 */
export const CONTACT_QUESTION =
  "Should the design include a phone number, website, or address? Share it, or say 'none'.";

/** URL/domain tokens — the art director's `URL_TOKEN_RE` shape, sharing the
 *  spoken-URL normalizer's TLD allowlist. A brief that already names a URL
 *  has its CTA target. */
const URL_RE = new RegExp(
  `(?:https?:\\/\\/)?(?:www\\.)?(?:[a-z0-9-]+\\.)+(?:${URL_TLDS.join('|')})(?:\\/\\S*)?`,
  'i'
);

/**
 * Broad business/promotional cues in the intent. Deliberately broad — when in
 * doubt, ask: a design that doesn't need contact info is answered with "none"
 * at zero cost, while a missed ask ships a promo with no way to respond to it.
 */
const BUSINESS_INTENT_RE =
  /\b(?:sale|sales|discount\w*|promo\w*|offer\w*|deal|deals|coupon\w*|special\w*|service\w*|business\w*|compan(?:y|ies)|shop\w*|store\w*|salon\w*|clinic\w*|restaurant\w*|cafe|menu|clean\w*|repair\w*|plumb\w*|landscap\w*|lawn|pool|hvac|roof\w*|book(?:ing)?s?|appointment\w*|quotes?|estimate\w*|consult\w*|hire|hiring|order\w*|buy|purchase\w*|subscri\w*|sign\s?ups?|join|member\w*|customer\w*|client\w*|grand\s+opening|open(?:ing)?|launch\w*|pricing|price\w*|advert\w*|flyer\w*|agenc(?:y|ies)|event\w*|class(?:es)?|workshop\w*|catering|delivery|real\s+estate|realtor\w*|percent\s+off|%\s?off|free)\b|\$\s?\d|\d+\s?%/i;

/** A negative answer to the contact question — stores nothing. */
const DECLINE_RE = /^(?:none|no|nope|skip|n\/?a|no\s+thanks?|nothing)[.!?,\s]*$/i;

export const isContactDecline = (text: string): boolean =>
  typeof text === 'string' && DECLINE_RE.test(text.trim());

/**
 * Ask the contact question when the brief reads business/promotional and the
 * brief corpus (intent + fixedCopy) carries no phone number and no URL.
 * Never twice (`questionsAsked`), and never after the recap checkpoint.
 */
export const needsContactQuestion = (brief: DesignBrief): boolean => {
  if (brief.recapShown === true) return false;
  if ((brief.questionsAsked ?? []).includes('contact')) return false;
  const intent = typeof brief.intent === 'string' ? brief.intent : '';
  if (!BUSINESS_INTENT_RE.test(intent)) return false;
  const corpus = [
    intent,
    typeof brief.fixedCopy === 'string' ? brief.fixedCopy : '',
  ].join(' ');
  if (URL_RE.test(corpus)) return false;
  // `match` (not `test`): the shared lint patterns carry the /g flag, and a
  // stateful `test` would skip every other call.
  return !CONTACT_PATTERNS.some((re) => corpus.match(re) !== null);
};
