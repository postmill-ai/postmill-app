import { defineSkill } from '../define-skill';

/**
 * Commerce genres — designs whose job is to move a specific offer.
 *
 * Grouped by family rather than one file per genre. Forty-odd single-skill
 * files would be forty near-identical imports and one registry line each; a
 * family reads as a set, which is how these are actually written and revised.
 */

const OFFER_FIDELITY =
  'Never invent, round or "tidy" a price, a discount, a code or a date. If the brief does not supply one, leave the slot out rather than filling it — plausible filler is the single most damaging thing a promotional design can carry, because the user ships it believing it is true.';

export const SaleDiscountSkill = defineSkill({
  id: 'sale-discount',
  title: 'Sale / Discount',
  // NOT bare 'off': it is a whole word in "show off", "day off" and "off to",
  // which routed half the product briefs here. The same substring trap the
  // router's own spec was written for.
  signals: ['sale', 'discount', 'clearance', 'markdown', '% off', 'percent off'],
  requires: ['intent'],
  direction:
    'Aim at a department-store window card, not a coupon booklet. The number IS the design: set it enormous, everything else is a caption to it. One loud accent against a restrained ground — a design shouting in three colours reads as spam, and a discount that looks like spam is not believed.',
  rules: [
    'The percent-off number is display type: condense it with style textScaleX 0.62-0.75 rather than shrinking it, and set the small print in tracked caps (textTransform "uppercase", letterSpacing 2-6).',
    'The discount figure is the largest element on the canvas by a wide margin — at least twice the headline.',
    OFFER_FIDELITY,
    'Expiry and conditions go in a legal slot, small but present. A sale with no end date reads as permanent, which devalues it.',
    'One CTA, imperative and short: "Shop the sale", not "Click here to browse our discounted items".',
    'Imagery is optional and secondary. If the product is the draw, show one; if the offer is, do not dilute it.',
  ],
  slots: [
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
    { id: 'legal', role: 'legal', kind: 'text' },
    { id: 'image', role: 'image', kind: 'image' },
  ],
  art: {
    warps: ['arc-banner'],
    compositions: ['badge-burst', 'type-dominant', 'hero-fullbleed', 'poster-left'],
    effects: ['hard-shadow', 'sticker-pop', 'long-shadow'],
    treatments: ['contrast-punch', 'duotone-brand'],
    decor: ['burst', 'diagonal-stripes', 'rule'],
  },
  criteria: [
    { name: 'offer_prominence', description: 'The discount is unmissable at a glance', weight: 0.3 },
    { name: 'urgency', description: 'A deadline or scarcity cue is present and legible', weight: 0.2 },
  ],
  examples: [{ description: '"40% off everything" for a coffee roaster, ends Sunday.' }],
});

export const CouponOfferSkill = defineSkill({
  id: 'coupon-offer',
  title: 'Coupon / Promo Code',
  signals: ['coupon', 'promo code', 'voucher', 'code', 'redeem'],
  direction:
    'Aim at a physical ticket stub — perforations, a dashed tear line, a code set in monospace like something printed rather than designed. The tactile reference is what makes a code feel redeemable instead of decorative.',
  rules: [
    'The stub reads as a ticket: give the plate asymmetric corners with style borderRadius [12, 12, 0, 0] (or the mirror) so it tears like one.',
    'The code is set in a monospaced or heavily-tracked face, in its own bounded field, and is never re-cased or re-spaced.',
    OFFER_FIDELITY,
    'A dashed rule or notch reads as "tear here" and is worth more than any amount of colour.',
    'State what the code gets you and where to use it. A code with no offer attached is unusable.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'code', role: 'subhead', kind: 'text' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
    { id: 'legal', role: 'legal', kind: 'text' },
    { id: 'divider', role: 'decor', kind: 'divider' },
  ],
  art: {
    compositions: ['type-dominant', 'stacked-thirds', 'minimal-centered'],
    effects: ['keyline', 'hard-shadow'],
    decor: ['dashed-rule', 'ticket-notches', 'rule'],
  },
  criteria: [
    { name: 'code_fidelity', description: 'The code is exact, isolated and easy to copy', weight: 0.35 },
  ],
});

export const NewArrivalSkill = defineSkill({
  id: 'new-arrival',
  title: 'New Arrival',
  signals: ['new arrival', 'just landed', 'new in', 'introducing', 'now available', 'drop'],
  direction:
    'Aim at a fashion lookbook page. The product is photographed, not illustrated, and it is given room — generous margins say "considered", crowding says "clearance". Type is quiet and small against a large image; the restraint is the message.',
  rules: [
    'Imagery dominates: at least two-thirds of the canvas. This genre fails when the copy competes.',
    'One short headline naming the thing. No adjectives stacked in front of it.',
    'A "new" marker earns its place only if the design would otherwise read as a generic product shot.',
    'Price is optional here and usually omitted — a lookbook does not shout its prices.',
  ],
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
  ],
  art: {
    compositions: ['hero-fullbleed', 'poster-frame', 'editorial-sidebar', 'overlap-card', 'poster-left'],
    effects: ['soft-lift', 'keyline'],
    treatments: ['faded-matte', 'mono-tint', 'crisp'],
    masks: ['soft-corners', 'arch'],
    decor: ['short-rule', 'none'],
  },
  criteria: [
    { name: 'product_clarity', description: 'The product is unobstructed and well cropped', weight: 0.3 },
  ],
});

export const BundleDealSkill = defineSkill({
  id: 'bundle-deal',
  title: 'Bundle / Multi-buy',
  signals: ['bundle', 'multi-buy', 'combo', 'set', 'pack', 'buy one'],
  direction:
    'Aim at a meal-deal board: the arithmetic is the appeal, so show the components and the saving as one legible equation. Everything is in service of "this costs less together".',
  rules: [
    'Name every item in the bundle. A bundle whose contents are vague is not a bundle.',
    'Show the saving explicitly — either a struck-through total or a stated amount.',
    OFFER_FIDELITY,
    'Group the components visually so they read as one purchase, not as a list of separate products.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
    { id: 'legal', role: 'legal', kind: 'text' },
  ],
  art: {
    compositions: ['stacked-thirds', 'split-panel', 'badge-burst'],
    effects: ['soft-lift', 'sticker-outline'],
    treatments: ['crisp', 'contrast-punch'],
    decor: ['rule', 'chevron'],
  },
  criteria: [
    { name: 'value_clarity', description: 'What is included and what is saved are both obvious', weight: 0.3 },
  ],
});

export const FlashSaleSkill = defineSkill({
  id: 'flash-sale',
  title: 'Flash Sale',
  signals: ['flash sale', 'today only', 'ends tonight', 'limited time', '24 hours', 'hurry'],
  direction:
    'Aim at an emergency broadcast, not a poster. High contrast, hard edges, motion cues — diagonal stripes or a chevron. This is the one genre where loud is correct, but loud still means ONE loud gesture executed properly.',
  rules: [
    'Urgency is condensed: headline textScaleX 0.62-0.7, all-caps via textTransform, never a smaller font.',
    'The deadline is a first-class element, not fine print. "Today only" belongs at headline weight.',
    OFFER_FIDELITY,
    'Two colours maximum plus a neutral. Three competing brights read as a scam.',
    'Keep the copy to a handful of words. Urgency and explanation are opposites.',
  ],
  slots: [
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
    { id: 'legal', role: 'legal', kind: 'text' },
  ],
  art: {
    warps: ['rise-banner'],
    compositions: ['type-dominant', 'badge-burst', 'banner-strip'],
    effects: ['hard-shadow', 'sticker-pop', 'neon-glow'],
    treatments: ['contrast-punch', 'high-contrast-mono'],
    decor: ['diagonal-stripes', 'chevron', 'burst'],
  },
  criteria: [
    { name: 'urgency', description: 'The deadline is impossible to miss', weight: 0.35 },
  ],
});

export const MenuPricingSkill = defineSkill({
  id: 'menu-pricing',
  title: 'Menu / Price List',
  signals: ['menu', 'price list', 'pricing', 'tariff', 'rates', 'specials'],
  direction:
    'Aim at a letterpress café menu. This is a typographic problem, not a decorative one: consistent leading, aligned prices, a rule between courses. Restraint reads as quality, and quality is what a price list is selling.',
  rules: [
    'Section headers in tracked caps (textTransform "uppercase", letterSpacing 3-6); prices never condensed.',
    'Prices align on a common edge. Ragged prices are the fastest way to look amateur.',
    'Every item and price comes from the brief verbatim. Never invent a dish or a number.',
    'Group with rules and space, never with boxes — boxes turn a menu into a spreadsheet.',
    'One display face for headings, one text face for items. No third face.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'items', role: 'body', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'divider', role: 'decor', kind: 'divider' },
    { id: 'legal', role: 'legal', kind: 'text' },
  ],
  art: {
    compositions: ['type-dominant', 'minimal-centered', 'stacked-thirds'],
    effects: ['letterpress', 'keyline'],
    treatments: ['faded-matte', 'mono'],
    decor: ['rule', 'double-rule', 'short-rule'],
  },
  criteria: [
    { name: 'price_alignment', description: 'Prices sit on a common alignment', weight: 0.25 },
    { name: 'typographic_calm', description: 'Two faces at most, consistent leading', weight: 0.2 },
  ],
});

export const COMMERCE_SKILLS = [
  SaleDiscountSkill,
  CouponOfferSkill,
  NewArrivalSkill,
  BundleDealSkill,
  FlashSaleSkill,
  MenuPricingSkill,
];
