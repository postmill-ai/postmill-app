import type { DesignBrief } from '../../ai-designer.types';
import type { DesignSkill } from '../design-skill.interface';

export const AdvertisementSkill: DesignSkill = {
  id: 'advertisement',
  title: 'Advertisement',
  match: (brief: DesignBrief) => {
    const text = `${brief.intent} ${brief.audience || ''}`.toLowerCase();
    const signals = ['ad', 'advert', 'promote', 'promotion', 'sale', 'discount', 'buy'];
    return signals.some((s) => text.includes(s)) ? 0.9 : 0.25;
  },
  requiredBriefFields: ['intent', 'audience'],
  systemPrompt: `You are a conversion-focused ad designer. Rules:
- One clear hero image, one dominant headline, one CTA.
- Use brand colors; keep 60-30-10 color ratio.
- Headline max 8 words; CTA button text max 3 words.
- Place CTA in the lower third, clear of safe zones.
- Maintain visual hierarchy: headline → image → CTA.`,
  rubric: {
    criteria: [
      { name: 'hierarchy', description: 'Headline, image, CTA are clearly ordered', weight: 0.3 },
      { name: 'cta_visibility', description: 'CTA is prominent and unobstructed', weight: 0.3 },
      { name: 'brand_alignment', description: 'Colors/fonts match brand voice', weight: 0.2 },
      { name: 'safe_zone', description: 'Key text/CTA avoids platform UI overlays', weight: 0.2 },
    ],
  },
};
