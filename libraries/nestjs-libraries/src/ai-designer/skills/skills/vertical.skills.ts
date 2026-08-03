import { defineSkill } from '../define-skill';

/**
 * Vertical genres — the same structural problems, but with conventions that
 * belong to one trade.
 *
 * These exist because the reference class differs even when the slots do not: a
 * restaurant dish and a SaaS feature are both "one image, one claim", and a
 * design that treats them the same gets both wrong.
 */

export const RestaurantDishSkill = defineSkill({
  id: 'restaurant-dish',
  title: 'Restaurant / Dish',
  signals: ['dish', 'menu item', 'restaurant', 'cafe', '食', 'special', 'chef', 'cuisine', 'bakery'],
  direction:
    'Aim at a food magazine spread. The photograph is everything: shot close, warm, shallow. Type stays out of its way — a small caption at the edge, never a headline across the plate.',
  rules: [
    'The food fills the frame. A dish photographed small looks unappetising.',
    'Warm the imagery slightly; cool grading makes food look inedible.',
    'Name the dish exactly as the brief gives it, including any accents or diacritics.',
    'Price only if the brief supplies it, and small.',
  ],
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'badge', role: 'badge', kind: 'badge' },
  ],
  art: {
    compositions: ['hero-fullbleed', 'poster-frame', 'overlap-card', 'editorial-sidebar'],
    effects: ['soft-lift', 'legibility-halo'],
    treatments: ['warm-tint', 'sun-drenched', 'crisp'],
    masks: ['soft-corners', 'arch', 'circle'],
    decor: ['short-rule', 'none'],
  },
  criteria: [
    { name: 'appetite_appeal', description: 'Warm, close and appetising', weight: 0.3 },
  ],
});

export const FitnessClassSkill = defineSkill({
  id: 'fitness-class',
  title: 'Fitness / Class',
  signals: ['fitness', 'gym', 'workout', 'class', 'training', 'yoga', 'bootcamp', 'pilates'],
  direction:
    'Aim at a sportswear campaign: high contrast, motion, hard-edged type set tight and uppercase. Cool or desaturated grading with one hot accent. Energy comes from contrast and angle, not from exclamation marks.',
  rules: [
    'Schedule facts — day, time, place — are load-bearing and must be legible.',
    'Type set tight and heavy. Light weights read as wellness, not as training.',
    'Grade imagery hard: raise contrast, drop saturation, keep one accent hot.',
    'Never invent a class time or a location.',
  ],
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'schedule', role: 'subhead', kind: 'text' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
    { id: 'badge', role: 'badge', kind: 'badge' },
  ],
  art: {
    compositions: ['hero-fullbleed', 'banner-strip', 'stacked-thirds', 'type-dominant'],
    effects: ['hard-shadow', 'sticker-outline', 'legibility-halo'],
    treatments: ['bleach', 'high-contrast-mono', 'contrast-punch', 'moody-dark'],
    masks: ['subject-knockout'],
    decor: ['diagonal-stripes', 'chevron', 'rule'],
  },
  criteria: [
    { name: 'schedule_clarity', description: 'When and where are unmissable', weight: 0.25 },
  ],
});

export const SalonServiceSkill = defineSkill({
  id: 'salon-service',
  title: 'Salon / Beauty Service',
  signals: ['salon', 'beauty', 'hair', 'nails', 'spa', 'treatment', 'lashes', 'barber'],
  direction:
    'Aim at a beauty-counter card: soft, high-key, a restrained palette of two neutrals and one muted accent. Elegance is the product. Hard shadows and heavy outlines belong to a different trade entirely.',
  rules: [
    'High-key imagery with soft contrast. Harsh grading looks clinical rather than luxurious.',
    'Light or medium type weights, generously spaced. Heavy condensed faces fight the genre.',
    'Service names and prices exactly as given.',
    'Ornament is a thin rule or a soft curve, never a burst.',
  ],
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
    { id: 'legal', role: 'legal', kind: 'text' },
  ],
  art: {
    compositions: ['minimal-centered', 'editorial-sidebar', 'poster-frame', 'centred-emblem'],
    effects: ['soft-lift', 'keyline', 'satin-sheen'],
    treatments: ['high-key', 'faded-matte', 'warm-tint', 'mono-tint'],
    masks: ['arch', 'circle', 'squircle'],
    decor: ['arc', 'short-rule', 'underline-swash'],
  },
  criteria: [
    { name: 'elegance', description: 'Soft, spacious and restrained', weight: 0.25 },
  ],
});

export const RealEstateListingSkill = defineSkill({
  id: 'real-estate-listing',
  title: 'Real Estate Listing',
  signals: ['listing', 'property', 'for sale', 'real estate', 'bedroom', 'house', 'apartment', 'rent'],
  direction:
    'Aim at an estate agent\'s window card. The property photograph is the design; the facts sit in a clean band beneath it. Sober, well-aligned, no promotional loudness — buyers distrust a shouty listing.',
  rules: [
    'The property photo dominates and is never treated beyond a light contrast lift.',
    'Bedrooms, bathrooms and price are the three facts that matter, aligned consistently.',
    'Never invent a price, a size or a feature. Legal exposure lives in this genre.',
    'Address exactly as given, including any deliberate vagueness.',
  ],
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'facts', role: 'subhead', kind: 'text' },
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'logo', role: 'logo', kind: 'logo' },
    { id: 'legal', role: 'legal', kind: 'text' },
  ],
  art: {
    compositions: ['stacked-thirds', 'poster-frame', 'overlap-card', 'editorial-sidebar'],
    effects: ['soft-lift', 'keyline'],
    treatments: ['crisp', 'high-key'],
    masks: ['soft-corners'],
    decor: ['rule', 'short-rule'],
  },
  criteria: [
    { name: 'fact_alignment', description: 'Key facts are aligned and legible', weight: 0.25 },
  ],
});

export const SaasFeatureSkill = defineSkill({
  id: 'saas-feature',
  title: 'SaaS Feature',
  signals: ['feature', 'integration', 'dashboard', 'saas', 'platform', 'app update', 'now supports'],
  direction:
    'Aim at a developer-tool landing page: dark or near-dark ground, one accent, a UI fragment shown at an angle with a soft glow behind it. Precision reads as competence, which is what the genre is selling.',
  rules: [
    'Show a fragment of the interface, not the whole screen. A full screenshot is illegible at social size.',
    'One capability per design. Feature lists belong in a carousel.',
    'Technical accuracy matters — never invent a capability or an integration.',
    'Give the UI fragment depth: a soft glow or shadow separating it from the ground.',
  ],
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
    { id: 'badge', role: 'badge', kind: 'badge' },
  ],
  art: {
    compositions: ['overlap-card', 'split-panel', 'hero-fullbleed', 'stacked-thirds'],
    effects: ['drop-depth', 'halo', 'glass-edge', 'gradient-sheen'],
    treatments: ['moody-dark', 'cool-tint', 'crisp'],
    masks: ['soft-corners', 'squircle'],
    decor: ['dot-grid', 'rule', 'arc'],
  },
  criteria: [
    { name: 'ui_legibility', description: 'The interface fragment reads at social size', weight: 0.3 },
  ],
});

export const NonprofitAppealSkill = defineSkill({
  id: 'nonprofit-appeal',
  title: 'Nonprofit Appeal',
  signals: ['donate', 'charity', 'fundraiser', 'appeal', 'nonprofit', 'support us', 'cause'],
  direction:
    'Aim at a documentary still. Honest photography, unglamorous grading, plain type. The one number that matters — what a donation does — is set large. Anything that looks like advertising reduces giving.',
  rules: [
    'One concrete outcome, tied to an amount: "£20 feeds a family for a week".',
    'Never invent a figure, an outcome or a beneficiary.',
    'Do not over-treat the photography. Heavy grading on documentary imagery reads as manipulation.',
    'One clear ask. A design with two ways to help gets neither.',
  ],
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
    { id: 'logo', role: 'logo', kind: 'logo' },
    { id: 'legal', role: 'legal', kind: 'text' },
  ],
  art: {
    compositions: ['hero-fullbleed', 'stacked-thirds', 'type-dominant'],
    effects: ['legibility-halo', 'soft-lift'],
    treatments: ['none', 'mono', 'faded-matte'],
    decor: ['rule', 'short-rule', 'none'],
  },
  criteria: [
    { name: 'concrete_ask', description: 'A specific outcome tied to a specific amount', weight: 0.3 },
    { name: 'dignity', description: 'Imagery is honest and not over-treated', weight: 0.2 },
  ],
});

export const EcommerceGridSkill = defineSkill({
  id: 'ecommerce-grid',
  title: 'Product Grid',
  signals: ['collection', 'range', 'shop the', 'product grid', 'lineup', 'all products'],
  direction:
    'Aim at a catalogue page. Identical treatment for every product — same crop, same background, same spacing — so the eye compares rather than wanders. Consistency IS the design here.',
  rules: [
    'Every product gets an identical cell: same size, same crop, same treatment.',
    'Two to four products. More becomes unreadable at social sizes.',
    'A single shared background. Per-product backgrounds destroy the comparison.',
    'Names and prices come from the brief exactly, aligned consistently across cells.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'items', role: 'body', kind: 'text' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
    { id: 'badge', role: 'badge', kind: 'badge' },
  ],
  art: {
    compositions: ['stacked-thirds', 'split-panel', 'poster-frame'],
    effects: ['soft-lift', 'keyline'],
    treatments: ['crisp', 'high-key'],
    masks: ['soft-corners', 'squircle'],
    decor: ['rule', 'none'],
  },
  criteria: [
    { name: 'cell_consistency', description: 'Every product cell is treated identically', weight: 0.3 },
  ],
});

export const LocalServiceSkill = defineSkill({
  id: 'local-service',
  title: 'Local Service',
  signals: ['plumber', 'electrician', 'cleaning', 'local', 'call us', 'serving', 'contractor', 'repair'],
  direction:
    'Aim at a van livery: high contrast, unmissable phone number, no subtlety. Trust here comes from clarity and local specificity, not from polish. The phone number is the design.',
  rules: [
    'The phone number is the second-largest element after the service name, and is never restyled or re-spaced.',
    'Name the service area explicitly. "Local" without a place is meaningless.',
    'High contrast, two colours. This is read at speed, often on a small screen.',
    'Never invent a phone number, a licence, or a service area.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'phone', role: 'subhead', kind: 'text' },
    { id: 'area', role: 'body', kind: 'text' },
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
    { id: 'image', role: 'image', kind: 'image' },
  ],
  art: {
    compositions: ['banner-strip', 'type-dominant', 'split-panel', 'stacked-thirds'],
    effects: ['hard-shadow', 'sticker-outline', 'keyline'],
    treatments: ['contrast-punch', 'crisp'],
    decor: ['rule', 'chevron', 'diagonal-stripes'],
  },
  criteria: [
    { name: 'contact_prominence', description: 'The phone number is unmissable and exact', weight: 0.3 },
  ],
});

export const VERTICAL_SKILLS = [
  RestaurantDishSkill,
  FitnessClassSkill,
  SalonServiceSkill,
  RealEstateListingSkill,
  SaasFeatureSkill,
  NonprofitAppealSkill,
  EcommerceGridSkill,
  LocalServiceSkill,
];
