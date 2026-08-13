import { defineSkill } from '../define-skill';

/** Authority genres — designs whose job is to be believed. */

const DATA_FIDELITY =
  'Every figure comes from the brief. Never invent a statistic, never round one for balance, and never add a source that was not given. A fabricated number is the one error that destroys the credibility the whole genre depends on.';

export const StatisticCalloutSkill = defineSkill({
  id: 'statistic-callout',
  title: 'Statistic Callout',
  signals: ['statistic', 'stat', 'percent', 'data point', 'number', 'survey', 'study'],
  direction:
    'Aim at an annual-report pull-quote. The figure is enormous and everything else is a footnote to it. Restraint and precision are the message — a statistic surrounded by decoration reads as marketing rather than as fact.',
  rules: [
    'The figure is the largest thing on the canvas by a wide margin.',
    DATA_FIDELITY,
    'One line of context under the number, naming what it measures.',
    'Cite the source in a legal slot. An uncited statistic is an assertion.',
    'No decorative shapes competing with the number. A rule is the most ornament this genre should carry.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'subhead', role: 'subhead', kind: 'text' },
    { id: 'legal', role: 'legal', kind: 'text' },
    { id: 'divider', role: 'decor', kind: 'divider' },
    { id: 'logo', role: 'logo', kind: 'logo' },
  ],
  art: {
    compositions: ['type-dominant', 'minimal-centered', 'stacked-thirds'],
    effects: ['letterpress', 'keyline'],
    treatments: ['mono', 'duotone-brand'],
    decor: ['rule', 'short-rule', 'dot-grid'],
  },
  criteria: [
    { name: 'figure_dominance', description: 'The number leads unmistakably', weight: 0.3 },
    { name: 'sourcing', description: 'The source is present and legible', weight: 0.15 },
  ],
});

export const ListicleSkill = defineSkill({
  id: 'listicle',
  title: 'Listicle / Tips',
  signals: ['tips', 'ways', 'reasons', 'things', 'list', 'lessons', 'mistakes'],
  direction:
    'Aim at a well-set editorial sidebar. Numbered items with consistent spacing and a clear entry point. The design\'s job is rhythm — each item identical in treatment so the eye can move down without re-orienting.',
  rules: [
    'Numbers are consistent in size, weight and offset. Inconsistent numerals destroy the rhythm the genre depends on.',
    'Three to five items. More than five stops being readable at social sizes.',
    'Each item is one line where possible. A wrapping item breaks the grid.',
    'The count belongs in the headline: "4 ways", not "Some ways".',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'items', role: 'body', kind: 'text' },
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'divider', role: 'decor', kind: 'divider' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
  ],
  art: {
    compositions: ['type-dominant', 'stacked-thirds', 'editorial-sidebar'],
    effects: ['keyline', 'soft-lift'],
    treatments: ['mono-tint', 'faded-matte'],
    decor: ['rule', 'short-rule', 'dot-grid'],
  },
  criteria: [
    { name: 'rhythm', description: 'Items share one consistent treatment', weight: 0.3 },
  ],
});

export const HowToStepsSkill = defineSkill({
  id: 'how-to-steps',
  title: 'How-to / Steps',
  signals: ['how to', 'step', 'guide', 'tutorial', 'walkthrough', 'recipe steps'],
  direction:
    'Aim at IKEA instructions: numbered, sequential, wordless where possible. Direction is the design problem — the eye must know what follows what without being told.',
  rules: [
    'Steps are numbered and visually sequential. Ambiguous order is a failed instruction.',
    'A directional cue between steps — a chevron or a rule — does more than any amount of copy.',
    'One action per step, phrased as an imperative.',
    'Three to four steps. Beyond that the format wants a carousel, not one card.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'steps', role: 'body', kind: 'text' },
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'decor', role: 'decor', kind: 'divider' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
  ],
  art: {
    compositions: ['stacked-thirds', 'type-dominant', 'split-panel'],
    effects: ['keyline', 'soft-lift'],
    treatments: ['crisp', 'mono-tint'],
    decor: ['chevron', 'rule', 'dashed-rule'],
  },
  criteria: [
    { name: 'sequence_clarity', description: 'The order of steps is unambiguous', weight: 0.3 },
  ],
});

export const MythVsFactSkill = defineSkill({
  id: 'myth-vs-fact',
  title: 'Myth vs Fact',
  signals: ['myth', 'fact', 'misconception', 'truth', 'debunk', 'actually'],
  direction:
    'Aim at a fact-check card. The whole design is one opposition, so it must be built on contrast: two halves, two colours, two weights. Any ambiguity about which side is the truth is a total failure.',
  rules: [
    'Two clearly separated zones. The division is the design.',
    'The correction must be visually dominant — never let the myth read as the answer.',
    'Label both sides explicitly. Colour alone is not enough; some readers cannot use it.',
    'One myth per design. Two oppositions on one card cancel each other out.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'myth', role: 'body', kind: 'text' },
    { id: 'fact', role: 'subhead', kind: 'text' },
    { id: 'divider', role: 'decor', kind: 'divider' },
    { id: 'badge', role: 'badge', kind: 'badge' },
  ],
  art: {
    compositions: ['split-panel', 'stacked-thirds', 'type-dominant'],
    effects: ['keyline', 'hard-shadow'],
    treatments: ['high-contrast-mono', 'duotone-brand'],
    decor: ['rule', 'double-rule'],
  },
  criteria: [
    { name: 'opposition_clarity', description: 'Which side is true is unmistakable', weight: 0.35 },
  ],
});

export const ComparisonSkill = defineSkill({
  id: 'comparison',
  title: 'Comparison',
  signals: ['vs', 'versus', 'compare', 'comparison', 'difference between', 'which'],
  direction:
    'Aim at a spec-comparison table stripped to its essentials. Symmetry is the point: two columns of equal weight, aligned rows, one axis of difference. Asymmetry reads as bias.',
  rules: [
    'Both sides get identical treatment. Favouring one visually undermines the comparison.',
    'Rows align across columns. Misaligned rows make a comparison unreadable.',
    'Compare on three points at most.',
    'Never invent a specification for either side.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'left', role: 'body', kind: 'text' },
    { id: 'right', role: 'subhead', kind: 'text' },
    { id: 'divider', role: 'decor', kind: 'divider' },
    { id: 'badge', role: 'badge', kind: 'badge' },
  ],
  art: {
    compositions: ['split-panel', 'stacked-thirds', 'type-dominant'],
    effects: ['keyline'],
    treatments: ['mono', 'duotone-brand'],
    decor: ['rule', 'double-rule'],
  },
  criteria: [
    { name: 'symmetry', description: 'Both sides are treated evenly', weight: 0.3 },
  ],
});

export const FaqSkill = defineSkill({
  id: 'faq',
  title: 'FAQ / Q&A',
  signals: ['faq', 'question', 'q&a', 'ask', 'answered', 'common questions'],
  direction:
    'Aim at a well-set reference card. The question and answer must be typographically distinct — different weight, different colour, or both — so the eye can scan questions alone and stop at the relevant one.',
  rules: [
    'Question and answer differ in weight or colour. Same treatment for both makes the card unscannable.',
    'One or two questions per design. An FAQ list belongs in a carousel.',
    'Questions are phrased as a reader would ask them, not as a company would title them.',
    'Answer in one or two lines. Longer answers do not belong on a card.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'answer', role: 'body', kind: 'text' },
    { id: 'badge', role: 'badge', kind: 'badge' },
    { id: 'divider', role: 'decor', kind: 'divider' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
  ],
  art: {
    compositions: ['type-dominant', 'stacked-thirds', 'editorial-sidebar'],
    effects: ['keyline', 'soft-lift'],
    treatments: ['mono-tint', 'faded-matte'],
    decor: ['rule', 'short-rule'],
  },
  criteria: [
    { name: 'scannability', description: 'Question and answer are visually distinct', weight: 0.3 },
  ],
});

export const InfographicSkill = defineSkill({
  id: 'infographic',
  title: 'Infographic',
  signals: ['infographic', 'breakdown', 'chart', 'visualize', 'data', 'anatomy of'],
  direction:
    'Aim at a broadsheet explainer graphic. A visual hierarchy of one headline figure, a small number of supporting facts, and connective structure between them. Density is allowed here — but it must be organised density, not clutter.',
  rules: [
    'One lead figure or idea, with at most four supporting points.',
    DATA_FIDELITY,
    'Use rules and alignment to connect related facts. Random placement destroys comprehension.',
    'A consistent visual language for every data point — same weight, same colour role, same spacing.',
  ],
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'points', role: 'body', kind: 'text' },
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'legal', role: 'legal', kind: 'text' },
    { id: 'divider', role: 'decor', kind: 'divider' },
  ],
  art: {
    compositions: ['stacked-thirds', 'type-dominant', 'editorial-sidebar'],
    effects: ['keyline', 'soft-lift'],
    treatments: ['mono', 'duotone-brand'],
    decor: ['rule', 'dot-grid', 'double-rule'],
  },
  criteria: [
    { name: 'organised_density', description: 'Dense but structured, never cluttered', weight: 0.3 },
    { name: 'sourcing', description: 'Figures are attributed', weight: 0.15 },
  ],
});

export const AUTHORITY_SKILLS = [
  StatisticCalloutSkill,
  ListicleSkill,
  HowToStepsSkill,
  MythVsFactSkill,
  ComparisonSkill,
  FaqSkill,
  InfographicSkill,
];
