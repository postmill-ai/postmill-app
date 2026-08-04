import type { DesignBrief } from '../../ai-designer.types';
import type { DesignSkill } from '../design-skill.interface';
import { matchesAnySignal } from '../signal-match';

export const AdvertisementSkill: DesignSkill = {
  id: 'advertisement',
  title: 'Advertisement',
  match: (brief: DesignBrief) => {
    const text = `${brief.intent} ${brief.audience || ''}`.toLowerCase();
    // `'ad'` was the worst offender of the old substring matching: it hit
    // "headline", "ready", "made", "gradient", "loaded" — every brief. It is
    // now a whole word; the longer forms it used to cover as a substring
    // (advertising, advertisement) are spelled out.
    const signals = [
      'ad',
      'advert',
      'advertising',
      'advertisement',
      'promote',
      'promoting',
      'promotion',
      'sale',
      'discount',
      'discounted',
      'buy',
    ];
    return matchesAnySignal(text, signals) ? 0.9 : 0.25;
  },
  requiredBriefFields: ['intent', 'audience'],
  systemPrompt: `You are a conversion-focused ad designer. Rules:
- One hero image, one dominant headline, one CTA — an ad with two messages converts nobody.
- Visual hierarchy is strict: image stops the scroll, headline sells the benefit, CTA closes. Size them in that order.
- Headline max 8 words and benefit-led ("Softer skin in 7 days"), never feature-led ("New formula v2").
- Subhead is optional and strictly shorter than the headline — one line of proof or detail, nothing more.
- The CTA is a cta-button slot (pill or high-contrast block), text max 3 words, verb-first ("Shop now", "Try free").
- Place the CTA in the lower third, vertically centered in its band, clear of every platform safe zone.
- Use brand colors in a 60-30-10 ratio: dominant field, secondary support, one accent reserved for the CTA and at most one badge.
- A badge ("-30%", "Limited") is the only decoration allowed — small, upper corner or beside the CTA, never competing with the headline.
- Keep 5-8% margin breathing room on all sides; ads that bleed text to the edges get cropped by feed previews.
- Over a busy hero image, give the text a shadow or glow so it reads against the picture — never raw text on noise, and never a scrim/overlay band over the photo.
- If the brief names an offer, the offer goes in the headline or badge — not buried in the subhead.`,
  layoutHints: {
    formatTemplates: ['hero-fullbleed', 'poster-left', 'split-panel'],
    slotSchema: [
      { id: 'image', role: 'image', kind: 'image' },
      { id: 'headline', role: 'headline', kind: 'text' },
      { id: 'subhead', role: 'subhead', kind: 'text' },
      { id: 'cta', role: 'cta', kind: 'cta-button' },
      { id: 'badge', role: 'offer-badge', kind: 'badge' },
    ],
  },
  rubric: {
    criteria: [
      { name: 'hierarchy', description: 'Headline, image, CTA are clearly ordered', weight: 0.3 },
      { name: 'cta_visibility', description: 'CTA is prominent and unobstructed', weight: 0.3 },
      { name: 'brand_alignment', description: 'Colors/fonts match brand voice', weight: 0.2 },
      { name: 'safe_zone', description: 'Key text/CTA avoids platform UI overlays', weight: 0.2 },
    ],
  },
};
