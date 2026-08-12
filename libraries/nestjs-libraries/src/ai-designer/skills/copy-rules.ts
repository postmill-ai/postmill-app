/**
 * Copy rules shared across genres.
 *
 * OFFER_FIDELITY started life in commerce.skills.ts, but the router can land
 * an offer brief on any genre — "buy 1 get 1 free" routed to advertisement,
 * whose prompt never mentioned abbreviations, and "B1G1 FREE" shipped as a
 * headline. The rule lives here so every skill that can carry an offer says
 * the same thing.
 */

export const OFFER_FIDELITY =
  'Never invent, round or "tidy" a price, a discount, a code or a date — and never abbreviate the mechanics: "buy 1 get 1 free" is set as "BUY 1 GET 1 FREE", never "B1G1" (jargon the user never said, and half the audience cannot parse it). If the brief does not supply one, leave the slot out rather than filling it — plausible filler is the single most damaging thing a promotional design can carry, because the user ships it believing it is true.';

/**
 * First words a CTA may start with. A CTA is a command a person would say out
 * loud; anything not verb-first ("Sale now", "Free pizza") reads as a label,
 * not a button.
 */
export const CTA_VERBS = new Set([
  'order',
  'shop',
  'buy',
  'get',
  'grab',
  'claim',
  'book',
  'join',
  'try',
  'start',
  'visit',
  'call',
  'reserve',
  'save',
  'discover',
  'explore',
  'learn',
  'see',
  'taste',
  'enjoy',
  'download',
  'sign',
  'subscribe',
  'follow',
  'watch',
  'listen',
  'read',
  'send',
  'share',
  'swipe',
  'tap',
  'redeem',
  'browse',
  'find',
  'unlock',
  'apply',
  'register',
  'rsvp',
  'donate',
  'give',
  'come',
  'bring',
  'win',
]);

/**
 * Two-word CTAs of the shape verb + offer-noun ("Shop sale", "Buy deal") are
 * headless fragments — the article is what makes them parse ("Shop the
 * sale"). These nouns flag the fragment; three-word forms pass.
 */
export const CTA_FRAGMENT_NOUNS = new Set([
  'sale',
  'deal',
  'offer',
  'discount',
  'promo',
  'savings',
  'bargain',
]);

/**
 * The replacement when a CTA fails lint after the repair retry, picked by
 * what the brief is about. "Order now" for anything you eat or drink, "Shop
 * now" for anything you buy, "Learn more" when neither reads.
 */
export const defaultCta = (briefCorpus: string): string => {
  if (
    /\b(pizza|food|restaurant|menu|order|eat|dine|dinner|lunch|breakfast|drink|coffee|cafe|burger|taco|sushi|meal|bakery|bar|brunch)\b/i.test(
      briefCorpus
    )
  ) {
    return 'Order now';
  }
  if (
    /\b(shop|store|sale|buy|product|collection|merch|clothing|fashion|retail)\b/i.test(
      briefCorpus
    )
  ) {
    return 'Shop now';
  }
  return 'Learn more';
};
