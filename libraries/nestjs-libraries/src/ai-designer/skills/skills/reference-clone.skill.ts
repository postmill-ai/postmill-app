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
- HIERARCHY COMES FROM SIZE, NOT MEANING: whatever line is physically LARGEST in the reference is the headline, even when another line reads as the "real" message. Observed failure: a poster whose largest word by far was "PIZZA" was planned with "Fresh & Tasty" as the headline and "PIZZA" dropped entirely — the result shared no silhouette with the reference. Rank the reference's lines by size, assign headline → subhead → body in that order, and only then decide what each one says.
- A word the reference shows TWICE at different sizes is a deliberate echo: plan both, with the SAME role, so the repetition survives. The echo repeats the headline's OWN words at the second size — never assign a different line to the echo slot.
- The kicker is the SMALL line that sits immediately ABOVE the main headline in the reference (a script or condensed-caps line like "Italian") — it is never small print; URLs, dates and "your logo here" stay in "legal" slots.
- The reference's LARGEST line stays the largest in the plan: the headline's typeScale is the biggest number in the plan, the echo's the second biggest, and no supporting line ever plans at or above the headline's size.
- Match the reference's ANCHOR with the composition: a type stack that starts at the TOP of the canvas demands "poster-left" (the only top-anchored arrangement); a stack anchored to the bottom third is "hero-fullbleed"; copy in a solid side panel is "split-panel". A top-anchored reference planned as hero-fullbleed fails the silhouette no matter how good the parts are.
- Ornaments come from the DECOR list (swash-pair, wavy-rule, rule…) — never from divider or shape slots.
- If the reference has no call-to-action, OMIT the cta slot — never include one hidden with opacity 0.
- EVERY text line in the reference gets its OWN slot — never merge two reference lines into one slot, never drop a line, and never tuck small print into the headline or subhead text (a second line inside the headline renders at headline size, which destroys the hierarchy).
- The slot schema below is a FLOOR, not a ceiling: when the reference has more lines than the schema has slots, ADD slots and reuse roles — a kicker above the headline ("kicker", role "accent"), the second hit of an echoed word ("echo", role "headline"), a logo line ("logo-line", role "legal"). Slots that share a role stack in plan order, so plan order is reading order.
- Small print (URL, tagline, date, "your logo here") uses the "legal" slot — small, tracked-out (style letterSpacing 2-6).
- Script/handwritten accent lines use the "accent" slot with a script fontFamily override (formal copperplate: Great Vibes; casual: Dancing Script, Lobster, Pacifico, Caveat, Shadows Into Light) and an accent-colour fill.
- Reproduce the mood devices: a dark/moody reference demands treatment "moody-dark" + effect "vignette" + a slot "scrim" on the copy side; a bright/clean reference demands a light treatment and quiet type zones, no vignette.
- Reproduce the decor with the closest DECOR recipe (a swash under a script line, a rule between blocks, a wavy divider) — "none" only when the reference is truly bare.
- Keep the hierarchy: the headline at least 2.5x the subhead; small print genuinely small (typeScale legal at most 0.2).
- Condensed display type in the reference is style textScaleX 0.6-0.8 on the SAME face — never a wider face at a smaller size, and never squashed copy.
- All-caps lines in the reference use style textTransform "uppercase" (case is a render property — keep the copy as authored) with letterSpacing 2-6 on small tracked lines.
- An arched or waving ribbon plate is style badgeStyle "ribbon" on the badge slot (a bowed banner is NOT a pill and NOT a starburst — when the cues describe a band that bows, choose ribbon); a curved accent LINE of text uses style curve "arc-up" or "arc-down".
- Choose the styleId whose DISPLAY face matches the reference's headline class (slab serif, condensed sans, …). A script-display preset on a poster whose headline is a slab serif fails the silhouette — script faces belong to the accent/kicker slots only, never the headline or echo.
- A gradient headline in the reference is effect "gradient-headline"; a frosted panel behind copy is effect "glass-panel".
- Variants may differ in arrangement (composition, panel side, badge corner) but NEVER in fidelity: every variant carries the reference's full type stack, mood devices and decor.`,
  layoutHints: {
    formatTemplates: ['poster-left', 'hero-fullbleed', 'split-panel'],
    slotSchema: [
      { id: 'image', role: 'product-image', kind: 'image' },
      { id: 'kicker', role: 'accent', kind: 'text' },
      { id: 'headline', role: 'headline', kind: 'text' },
      { id: 'echo', role: 'headline', kind: 'text' },
      { id: 'accent', role: 'accent', kind: 'text' },
      { id: 'subhead', role: 'benefit', kind: 'text' },
      { id: 'badge', role: 'price-badge', kind: 'badge' },
      { id: 'legal', role: 'legal', kind: 'text' },
      { id: 'cta', role: 'cta', kind: 'cta-button' },
    ],
  },
  artDirection: {
    compositions: ['poster-left', 'hero-fullbleed', 'split-panel'],
    effects: ['vignette', 'scrim-veil', 'legibility-halo', 'soft-lift', 'gradient-headline', 'glass-panel'],
    warps: ['arc-banner', 'arc-down-banner', 'flag-wave'],
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
