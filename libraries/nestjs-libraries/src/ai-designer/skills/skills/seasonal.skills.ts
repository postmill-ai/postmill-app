import { defineSkill } from '../define-skill';

/** Seasonal and relational genres — designs whose job is a gesture. */

export const HolidaySkill = defineSkill({
  id: 'holiday',
  title: 'Holiday / Seasonal',
  signals: ['holiday', 'christmas', 'thanksgiving', 'diwali', 'eid', 'lunar new year', 'seasonal', 'easter', 'hanukkah'],
  direction:
    'Aim at a well-made seasonal card, not a stock template. Pick the season\'s palette and ONE motif, then execute it properly — the failure mode of this genre is a scatter of clip-art snowflakes standing in for a decision.',
  rules: [
    'One motif, used once, at size. Repeated ornament reads as a template.',
    'The greeting is short and specific to the occasion named in the brief.',
    'Do not assume a religion or a culture the brief did not state.',
    'Brand presence stays small — a seasonal greeting that sells is not a greeting.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'logo', role: 'logo', kind: 'logo' },
    { id: 'decor', role: 'decor', kind: 'accent-shape' },
  ],
  art: {
    compositions: ['centred-emblem', 'minimal-centered', 'hero-fullbleed', 'poster-frame'],
    effects: ['gradient-sheen', 'letterpress', 'halo', 'chisel'],
    treatments: ['warm-tint', 'faded-matte', 'mono-tint'],
    masks: ['arch', 'circle'],
    decor: ['arc', 'short-rule', 'blob'],
  },
  criteria: [
    { name: 'motif_restraint', description: 'One motif, executed once', weight: 0.25 },
  ],
});

export const CountdownSkill = defineSkill({
  id: 'countdown',
  title: 'Countdown',
  signals: ['countdown', 'days to go', 'days left', 'starts in', 'almost here'],
  direction:
    'Aim at a departure board. The number is mechanical and enormous; everything else is a label. The genre works because the number is unambiguous, so any decorative treatment that obscures it is a failure.',
  rules: [
    'The remaining count is the largest element and is unambiguous — "3 DAYS", never "just a few days".',
    'Name what is being counted down to. A countdown to nothing is noise.',
    'Never invent the date or the count.',
    'One accent colour against a neutral ground; a countdown in five colours reads as a party invitation.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
  ],
  art: {
    compositions: ['type-dominant', 'badge-burst', 'minimal-centered'],
    effects: ['hard-shadow', 'letterpress', 'neon-glow'],
    treatments: ['high-contrast-mono', 'contrast-punch'],
    decor: ['rule', 'chevron', 'double-rule'],
  },
  criteria: [
    { name: 'count_clarity', description: 'The remaining count is unmistakable', weight: 0.35 },
  ],
});

export const ThankYouSkill = defineSkill({
  id: 'thank-you',
  title: 'Thank You',
  signals: ['thank you', 'thanks', 'grateful', 'appreciate', 'shout out'],
  direction:
    'Aim at a handwritten note reproduced well. Warm palette, generous space, a single line of type given room. Anything that looks produced undercuts the sentiment.',
  rules: [
    'Two lines at most. Extended thanks reads as a press release.',
    'Say who is being thanked and what for, if the brief gives it.',
    'No CTA. A thank-you that sells is not a thank-you.',
    'Space is the design. Resist filling it.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'logo', role: 'logo', kind: 'logo' },
    { id: 'decor', role: 'decor', kind: 'accent-shape' },
  ],
  art: {
    compositions: ['minimal-centered', 'centred-emblem', 'type-dominant'],
    effects: ['letterpress', 'soft-lift'],
    treatments: ['warm-tint', 'faded-matte'],
    decor: ['underline-swash', 'short-rule', 'arc'],
  },
  criteria: [
    { name: 'warmth', description: 'Reads as a gesture, not as marketing', weight: 0.3 },
  ],
});

export const GiveawaySkill = defineSkill({
  id: 'giveaway',
  title: 'Giveaway / Competition',
  signals: ['giveaway', 'competition', 'win', 'prize', 'contest', 'enter to'],
  direction:
    'Aim at a fairground prize board: energetic, but with the mechanics laid out plainly. The tension in this genre is excitement versus rules, and the rules must survive — an unclear giveaway generates complaints, not entries.',
  rules: [
    'The prize is the headline. What someone wins comes before how they enter.',
    'Entry mechanics are explicit and numbered where there is more than one step.',
    'The closing date and any restrictions go in a legal slot — present, not hidden.',
    'Never invent a prize, a deadline or an eligibility rule.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'steps', role: 'body', kind: 'text' },
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
    { id: 'legal', role: 'legal', kind: 'text' },
  ],
  art: {
    compositions: ['badge-burst', 'stacked-thirds', 'hero-fullbleed'],
    effects: ['sticker-pop', 'hard-shadow', 'neon-glow'],
    treatments: ['contrast-punch', 'crisp'],
    decor: ['burst', 'diagonal-stripes', 'rule'],
  },
  criteria: [
    { name: 'mechanics_clarity', description: 'Prize, entry steps and deadline all legible', weight: 0.3 },
  ],
});

export const SEASONAL_SKILLS = [HolidaySkill, CountdownSkill, ThankYouSkill, GiveawaySkill];
