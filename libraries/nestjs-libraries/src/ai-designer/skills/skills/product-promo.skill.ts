import type { DesignBrief } from '../../ai-designer.types';
import type { DesignSkill } from '../design-skill.interface';

export const ProductPromoSkill: DesignSkill = {
  id: 'product-promo',
  title: 'Product Promo',
  match: (brief: DesignBrief) => {
    const text = `${brief.intent} ${brief.audience || ''}`.toLowerCase();
    const signals = ['product', 'feature', 'launch', 'new arrival', 'collection', 'item'];
    return signals.some((s) => text.includes(s)) ? 0.9 : 0.3;
  },
  requiredBriefFields: ['intent', 'audience'],
  systemPrompt: `You are a product-promo designer. Rules:
- Hero product image centered or offset with clean backdrop.
- Product name + one-line benefit + price/offer if provided.
- Minimal text; let the product breathe.
- Use subtle shadow or color block to separate product from background.`,
  rubric: {
    criteria: [
      { name: 'product_focus', description: 'Product is the clear focal point', weight: 0.35 },
      { name: 'copy_clarity', description: 'Name/benefit/offer are legible', weight: 0.25 },
      { name: 'background_separation', description: 'Product separates from background', weight: 0.25 },
      { name: 'safe_zone', description: 'Text avoids platform UI overlays', weight: 0.15 },
    ],
  },
};
