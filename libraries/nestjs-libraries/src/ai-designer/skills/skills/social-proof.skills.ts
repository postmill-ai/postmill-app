import { defineSkill } from '../define-skill';

/** Social-proof genres — designs whose job is to let someone else do the talking. */

const VOICE_FIDELITY =
  'The customer\'s words are quoted exactly. Never improve the grammar, never shorten for balance, never write a testimonial that was not given. An edited testimonial is a fabricated one.';

export const TestimonialSkill = defineSkill({
  id: 'testimonial',
  title: 'Testimonial',
  signals: ['testimonial', 'review', 'customer said', 'feedback', 'client', 'loved'],
  direction:
    'Aim at a jacket blurb on a hardback. The quote is set as a real pull-quote — serif, generous leading, hanging opening mark — and the attribution is small and factual beneath it. Any decoration beyond a rule makes it read as advertising rather than as testimony.',
  rules: [
    VOICE_FIDELITY,
    'Attribute with a name and, where given, a role or company. An anonymous testimonial persuades nobody.',
    'A star rating is worth including only if the brief gives one.',
    'If a customer photo is supplied, keep it small and circular — the words are the evidence, not the face.',
    'Never place the quote over a busy image.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'attribution', role: 'subhead', kind: 'text' },
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'decor', role: 'decor', kind: 'accent-shape' },
  ],
  art: {
    compositions: ['type-dominant', 'minimal-centered', 'overlap-card', 'editorial-sidebar'],
    effects: ['letterpress', 'keyline', 'soft-lift'],
    treatments: ['mono-tint', 'faded-matte'],
    masks: ['circle'],
    decor: ['quote-marks', 'short-rule', 'rule'],
  },
  criteria: [
    { name: 'attribution', description: 'Named and credited', weight: 0.25 },
    { name: 'quote_fidelity', description: 'The words are verbatim', weight: 0.25 },
  ],
});

export const ReviewHighlightSkill = defineSkill({
  id: 'review-highlight',
  title: 'Review Highlight',
  signals: ['rating', 'stars', 'rated', 'score', 'reviews say', '5 star'],
  direction:
    'Aim at a review-aggregator card: the score is the hero, set as a number rather than as a graphic, with the sample size beside it. Precision reads as honesty; a rounded score reads as marketing.',
  rules: [
    'The score and its scale both appear — "4.8" alone is meaningless without "out of 5".',
    'Include the number of reviews. A rating without a sample size is not evidence.',
    'Never round, inflate or invent a score.',
    'Stars are optional; the numeral is not.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'legal', role: 'legal', kind: 'text' },
    { id: 'logo', role: 'logo', kind: 'logo' },
  ],
  art: {
    compositions: ['type-dominant', 'centred-emblem', 'minimal-centered'],
    effects: ['keyline', 'soft-lift', 'gradient-sheen'],
    treatments: ['mono-tint'],
    decor: ['rule', 'short-rule'],
  },
  criteria: [
    { name: 'score_honesty', description: 'Score, scale and sample size all present', weight: 0.3 },
  ],
});

export const UgcRepostSkill = defineSkill({
  id: 'ugc-repost',
  title: 'UGC Repost',
  signals: ['repost', 'ugc', 'shared by', 'tagged us', 'community', 'regram'],
  direction:
    'Aim at a scrapbook page, not a campaign. The customer\'s photo stays exactly as they shot it — untreated, uncropped where possible — and the brand\'s contribution is a small credit and nothing else. Over-designing UGC destroys the authenticity that makes it work.',
  rules: [
    'Do not treat, grade or filter the customer photo. Its imperfection is the point.',
    'Credit the creator by handle, prominently enough to be read.',
    'Brand presence is one small mark. A branded frame turns a repost into an advert.',
    'Never crop a person out of their own photo to fit a format.',
  ],
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'credit', role: 'subhead', kind: 'text' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'logo', role: 'logo', kind: 'logo' },
  ],
  art: {
    compositions: ['hero-fullbleed', 'poster-frame', 'overlap-card'],
    effects: ['soft-lift'],
    treatments: ['none'],
    masks: ['none', 'soft-corners'],
    decor: ['none', 'short-rule'],
  },
  criteria: [
    { name: 'creator_credit', description: 'The creator is clearly credited', weight: 0.3 },
    { name: 'authenticity', description: 'The photo is left untreated', weight: 0.2 },
  ],
});

export const CaseStudySkill = defineSkill({
  id: 'case-study',
  title: 'Case Study / Result',
  signals: ['case study', 'result', 'outcome', 'we helped', 'increased', 'grew', 'reduced'],
  direction:
    'Aim at a consultancy one-pager. A before-and-after arithmetic, the client named, and enough restraint that the number is believed. This genre lives or dies on looking sober.',
  rules: [
    'The result figure leads, with the metric named beside it.',
    'Name the client if the brief does. An anonymous case study is a claim, not a proof.',
    'Never invent or round the figures, and never drop the timeframe — a result with no period is meaningless.',
    'Restrained palette. Bright promotional colour undermines a results claim.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'client', role: 'body', kind: 'text' },
    { id: 'logo', role: 'logo', kind: 'logo' },
    { id: 'legal', role: 'legal', kind: 'text' },
  ],
  art: {
    compositions: ['type-dominant', 'split-panel', 'stacked-thirds'],
    effects: ['keyline', 'letterpress'],
    treatments: ['mono', 'duotone-brand'],
    decor: ['rule', 'short-rule', 'chevron'],
  },
  criteria: [
    { name: 'result_credibility', description: 'Figure, metric and timeframe all present', weight: 0.3 },
  ],
});

export const SOCIAL_PROOF_SKILLS = [
  TestimonialSkill,
  ReviewHighlightSkill,
  UgcRepostSkill,
  CaseStudySkill,
];
