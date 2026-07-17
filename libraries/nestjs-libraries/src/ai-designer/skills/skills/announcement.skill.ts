import type { DesignBrief } from '../../ai-designer.types';
import type { DesignSkill } from '../design-skill.interface';

export const AnnouncementSkill: DesignSkill = {
  id: 'announcement',
  title: 'Announcement',
  match: (brief: DesignBrief) => {
    const text = `${brief.intent} ${brief.audience || ''}`.toLowerCase();
    const signals = ['announce', 'news', 'update', 'event', 'launching', 'we are', 'now open'];
    return signals.some((s) => text.includes(s)) ? 0.9 : 0.25;
  },
  requiredBriefFields: ['intent'],
  systemPrompt: `You are an announcement designer. Rules:
- Bold, authoritative headline first.
- Supporting detail line second (shorter than headline).
- Use brand accent color for emphasis.
- Keep layout clean; one optional supporting image or icon.
- Ensure headline is fully within safe zones.`,
  rubric: {
    criteria: [
      { name: 'headline_impact', description: 'Headline commands attention', weight: 0.35 },
      { name: 'readability', description: 'Headline + detail are legible', weight: 0.3 },
      { name: 'brand_alignment', description: 'Accent colors/fonts match brand', weight: 0.2 },
      { name: 'safe_zone', description: 'Text avoids platform UI overlays', weight: 0.15 },
    ],
  },
};
