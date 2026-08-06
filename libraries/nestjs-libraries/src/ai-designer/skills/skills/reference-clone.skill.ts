import type { DesignBrief } from '../../ai-designer.types';
import type { DesignSkill } from '../design-skill.interface';

/**
 * Reference Clone — the skill for "make it look like THIS".
 *
 * Every other skill optimizes for its genre's conventions (a promo trio, a
 * meme's two captions). A user who attached a reference wants the reference's
 * structure, and genre conventions actively destroy it — observed live: a
 * near-clone pizza-poster brief routed to product-promo, whose "strict trio,
 * no fourth text element" rule collapsed an 8-line type stack into 3 slots
 * and stuffed the URL into the headline. When reference cues exist, this
 * skill outranks every genre skill and the reference becomes the spec.
 */
export const ReferenceCloneSkill: DesignSkill = {
  id: 'reference-clone',
  title: 'Reference Clone',
  match: (brief: DesignBrief) =>
    brief.referenceCues?.length ? 0.98 : 0,
  requiredBriefFields: ['intent'],
  systemPrompt: `You are a reference-match designer. The user attached a reference design — its interpreted cues are in the brief, and the reference is the SPEC: reproduce its type stack, mood, hierarchy and decor as closely as the plan schema allows, with the user's subject and copy.

ART DIRECTION: Aim at the reference itself, not at a genre. A great result is one the user could put next to the reference and see the same design intelligence: the same mood (dark and cinematic versus bright and clean), the same scale contrast between headline and small print, the same kind of ornament in the same kind of places, the same breathing room. Copy the craft, not the pixels — the subject, the palette names and the words are the user's; the art direction is the reference's.

Rules:
- EVERY text line in the reference gets its OWN slot — never merge two reference lines into one slot, never drop a line, and never tuck small print into the headline or subhead text (a second line inside the headline renders at headline size, which destroys the hierarchy).
- Small print (URL, tagline, date, "your logo here") uses the "legal" slot — small, tracked-out (style letterSpacing 2-6).
- Script/handwritten accent lines use the "accent" slot with a script fontFamily override (formal copperplate: Great Vibes; casual: Dancing Script, Lobster, Pacifico, Caveat, Shadows Into Light) and an accent-colour fill.
- Reproduce the mood devices: a dark/moody reference demands treatment "moody-dark" + effect "vignette" + a slot "scrim" on the copy side; a bright/clean reference demands a light treatment and quiet type zones, no vignette.
- Reproduce the decor with the closest DECOR recipe (a swash under a script line, a rule between blocks, a wavy divider) — "none" only when the reference is truly bare.
- Keep the hierarchy: the headline at least 2.5x the subhead; small print genuinely small (typeScale legal at most 0.2).
- Variants may differ in arrangement (composition, panel side, badge corner) but NEVER in fidelity: every variant carries the reference's full type stack, mood devices and decor.`,
  layoutHints: {
    formatTemplates: ['poster-left', 'hero-fullbleed', 'split-panel'],
    slotSchema: [
      { id: 'image', role: 'product-image', kind: 'image' },
      { id: 'accent', role: 'accent', kind: 'text' },
      { id: 'headline', role: 'headline', kind: 'text' },
      { id: 'subhead', role: 'benefit', kind: 'text' },
      { id: 'badge', role: 'price-badge', kind: 'badge' },
      { id: 'legal', role: 'legal', kind: 'text' },
      { id: 'cta', role: 'cta', kind: 'cta-button' },
    ],
  },
  artDirection: {
    compositions: ['poster-left', 'hero-fullbleed', 'split-panel'],
    effects: ['vignette', 'scrim-veil', 'legibility-halo', 'soft-lift'],
    treatments: ['moody-dark', 'contrast-punch', 'high-key', 'film-grain'],
    decor: ['underline-swash', 'swash-pair', 'wavy-rule', 'short-rule', 'rule', 'quote-marks'],
  },
  rubric: {
    criteria: [
      {
        name: 'reference_structure',
        description:
          'Every line of the reference\'s type stack is present as its OWN element — no merged, dropped, or re-roled copy; small print is small and tracked, not riding the headline.',
        weight: 1,
      },
      {
        name: 'mood_match',
        description:
          'The render matches the reference\'s mood — dark and cinematic versus bright and clean — through the treatment, vignette and scrim choices, not just the palette.',
        weight: 0.8,
      },
    ],
  },
};
