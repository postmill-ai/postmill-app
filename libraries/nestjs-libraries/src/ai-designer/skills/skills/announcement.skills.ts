import { defineSkill } from '../define-skill';

/** Announcement genres — designs whose job is to make one fact land. */

const FACT_FIDELITY =
  'Dates, times, venues, URLs and names come from the brief exactly as written. Never complete a partial fact, never convert a time zone, never tidy "first Friday of every month" into "monthly".';

export const EventPromoSkill = defineSkill({
  id: 'event-promo',
  title: 'Event Promotion',
  // NOT bare 'show': it is a whole word in "show off" and "show us", which
  // routed product briefs to an event poster. Same trap as 'off' and 'ad'.
  signals: ['event', 'concert', 'festival', 'meetup', 'conference', 'gig', 'live show', 'party'],
  requires: ['intent'],
  direction:
    'Aim at a gig poster pasted on a wall — it has to work at ten metres and at arm\'s length. Big name, big date, everything else subordinate. Grit and texture are welcome here in a way they are not in corporate work.',
  rules: [
    'Event name, then date, then venue. That order, that priority, every time.',
    FACT_FIDELITY,
    'The date is a display element, not body copy. A poster whose date needs hunting for has failed.',
    'Imagery sets the tone rather than explaining the event; treat it hard so the type stays on top of it.',
  ],
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'date', role: 'subhead', kind: 'text' },
    { id: 'venue', role: 'body', kind: 'text' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
    { id: 'legal', role: 'legal', kind: 'text' },
  ],
  art: {
    compositions: ['hero-fullbleed', 'type-dominant', 'poster-frame', 'stacked-thirds'],
    effects: ['long-shadow', 'legibility-halo', 'sticker-outline'],
    treatments: ['duotone-brand', 'bleach', 'halftone-print', 'moody-dark'],
    decor: ['rule', 'corner-brackets', 'diagonal-stripes'],
  },
  criteria: [
    { name: 'date_prominence', description: 'When and where are legible at a glance', weight: 0.3 },
  ],
});

export const WebinarInviteSkill = defineSkill({
  id: 'webinar-invite',
  title: 'Webinar / Livestream Invite',
  signals: ['webinar', 'livestream', 'live session', 'workshop', 'masterclass', 'ama'],
  direction:
    'Aim at a conference speaker card: a person\'s face, their name, and what they will say. Credibility is the product, so the treatment is clean and professional — no grit, no distressed textures.',
  rules: [
    'If a speaker is named, show them. A face converts better than any amount of description.',
    'The topic is the headline; the speaker is the subhead. People attend for the subject and stay for the speaker.',
    FACT_FIDELITY,
    'State the time with its zone. A webinar time without a zone is unusable.',
  ],
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'speaker', role: 'subhead', kind: 'text' },
    { id: 'date', role: 'body', kind: 'text' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
    { id: 'badge', role: 'badge', kind: 'badge' },
  ],
  art: {
    compositions: ['split-panel', 'editorial-sidebar', 'overlap-card', 'stacked-thirds'],
    effects: ['soft-lift', 'keyline'],
    treatments: ['mono-tint', 'cool-tint', 'crisp'],
    masks: ['circle', 'squircle'],
    decor: ['short-rule', 'rule'],
  },
  criteria: [
    { name: 'credibility', description: 'Speaker and topic both read clearly', weight: 0.25 },
  ],
});

export const ProductLaunchSkill = defineSkill({
  id: 'product-launch',
  title: 'Product Launch',
  signals: ['launch', 'launching', 'introducing', 'unveil', 'now live', 'ship', 'release'],
  direction:
    'Aim at a keynote slide. One product, dramatically lit, on a ground that recedes. Depth is the whole trick — the object should feel like it is in front of the background rather than pasted onto it.',
  rules: [
    'One product, one claim. A launch that lists features is a spec sheet.',
    'Push the background back: darken, blur or flatten it so the product separates.',
    'The name of the thing is the headline. What it does is the subhead.',
    FACT_FIDELITY,
  ],
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
    { id: 'badge', role: 'badge', kind: 'badge' },
  ],
  art: {
    compositions: ['hero-fullbleed', 'overlap-card', 'minimal-centered', 'poster-frame'],
    effects: ['drop-depth', 'soft-lift', 'gradient-sheen', 'halo'],
    treatments: ['moody-dark', 'soft-backdrop', 'crisp', 'contrast-punch'],
    masks: ['subject-knockout', 'soft-corners'],
    decor: ['none', 'arc'],
  },
  criteria: [
    { name: 'depth', description: 'The product separates from its background', weight: 0.3 },
  ],
});

export const HiringPostSkill = defineSkill({
  id: 'hiring-jobpost',
  title: 'Hiring / Job Post',
  signals: ['hiring', 'job', 'vacancy', 'we are looking', 'join our team', 'recruit', 'career'],
  direction:
    'Aim at a well-set recruitment ad in a trade magazine: confident, plain, no stock-photo handshakes. The role title does the work. Warmth comes from the palette, not from clip art.',
  rules: [
    'The role title is the headline. Not "We are hiring" — that is the subhead at best.',
    'Location and arrangement (remote, hybrid, on-site) are load-bearing facts and belong on the design.',
    FACT_FIDELITY,
    'Avoid generic office imagery. A flat colour ground beats a stock photo of a meeting.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'location', role: 'body', kind: 'text' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'image', role: 'image', kind: 'image' },
  ],
  art: {
    compositions: ['type-dominant', 'split-panel', 'stacked-thirds', 'minimal-centered'],
    effects: ['keyline', 'soft-lift'],
    treatments: ['duotone-brand', 'mono-tint'],
    decor: ['rule', 'short-rule', 'corner-brackets'],
  },
  criteria: [
    { name: 'role_clarity', description: 'The role and its location read immediately', weight: 0.3 },
  ],
});

export const MilestoneSkill = defineSkill({
  id: 'milestone',
  title: 'Milestone / Anniversary',
  signals: ['milestone', 'anniversary', 'years', 'celebrating', 'reached', 'thank you for'],
  direction:
    'Aim at a commemorative plate: the number is the hero, set with real typographic care, surrounded by space. Gratitude reads as quiet, not as confetti.',
  rules: [
    'The number is the design. Set it large and let it breathe.',
    'One line of thanks. Extended gratitude reads as self-congratulation.',
    'Decoration is a rule or a mark, never a scatter of celebratory shapes.',
    FACT_FIDELITY,
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'logo', role: 'logo', kind: 'logo' },
    { id: 'decor', role: 'decor', kind: 'accent-shape' },
  ],
  art: {
    compositions: ['centred-emblem', 'type-dominant', 'minimal-centered'],
    effects: ['letterpress', 'chisel', 'gradient-sheen', 'keyline'],
    treatments: ['mono-tint', 'faded-matte'],
    decor: ['double-rule', 'arc', 'short-rule'],
  },
  criteria: [
    { name: 'restraint', description: 'Celebratory without clutter', weight: 0.25 },
  ],
});

export const ANNOUNCEMENT_SKILLS = [
  EventPromoSkill,
  WebinarInviteSkill,
  ProductLaunchSkill,
  HiringPostSkill,
  MilestoneSkill,
];
