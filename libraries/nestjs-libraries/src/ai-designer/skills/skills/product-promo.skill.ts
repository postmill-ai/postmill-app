import type { DesignBrief } from '../../ai-designer.types';
import type { DesignSkill } from '../design-skill.interface';
import { matchesAnySignal } from '../signal-match';

export const ProductPromoSkill: DesignSkill = {
  id: 'product-promo',
  title: 'Product Promo',
  match: (brief: DesignBrief) => {
    const text = `${brief.intent} ${brief.audience || ''}`.toLowerCase();
    // `'item'` no longer matches "itemised"/"itemized", and `'product'` no
    // longer matches "production". `'launching'` deliberately stays OUT of
    // this list: it belongs to `announcement`, and adding it here would tie
    // the two skills at 0.9 and let registry order steal every launch brief.
    const signals = ['product', 'feature', 'featuring', 'launch', 'new arrival', 'collection', 'item'];
    return matchesAnySignal(text, signals) ? 0.9 : 0.3;
  },
  requiredBriefFields: ['intent', 'audience'],
  systemPrompt: `You are a product-promo designer. Rules:
- The product is the hero: centered or offset on a clean backdrop, occupying 50-70% of the canvas. Nothing overlaps it.
- Copy is a strict trio: product name (headline), one-line benefit (subhead), price or offer (badge). No fourth text element.
- Let the product breathe — whitespace around the product is what makes it look premium. Keep 8%+ clear space on all sides.
- Separate product from background with a subtle shadow or a soft color block, never a hard outline.
- Split-panel layouts pair product (one side) with copy (other side); hero-fullbleed works when the product shot is atmospheric enough to carry shadowed text directly on it.
- The price/offer badge sits near the product or the headline, small and high-contrast — it should be found in the second glance, not the first.
- Background: studio-gradient or muted solid from the palette. Loud backgrounds make the product look cheaper.
- Headline is the product name, short and confident; the benefit line is strictly smaller and one sentence max.
- A cta-button is optional — promos can sell on desire alone. If present, it is small, lower third, and never touches the product.
- Keep all copy inside safe zones; the product may bleed to edges only when the template calls for full-bleed imagery.`,
  layoutHints: {
    formatTemplates: ['split-panel', 'poster-left', 'hero-fullbleed'],
    slotSchema: [
      { id: 'image', role: 'product-image', kind: 'image' },
      { id: 'headline', role: 'headline', kind: 'text' },
      { id: 'subhead', role: 'benefit', kind: 'text' },
      { id: 'badge', role: 'price-badge', kind: 'badge' },
      { id: 'cta', role: 'cta', kind: 'cta-button' },
    ],
  },
  rubric: {
    criteria: [
      { name: 'product_focus', description: 'Product is the clear focal point', weight: 0.35 },
      { name: 'copy_clarity', description: 'Name/benefit/offer are legible', weight: 0.25 },
      { name: 'background_separation', description: 'Product separates from background', weight: 0.25 },
      { name: 'safe_zone', description: 'Text avoids platform UI overlays', weight: 0.15 },
    ],
  },
};
