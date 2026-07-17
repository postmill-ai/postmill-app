import type { DesignBrief, DesignPlan } from '../../ai-designer.types';
import type { DesignSkill } from '../design-skill.interface';

export const MemeSkill: DesignSkill = {
  id: 'meme',
  title: 'Meme',
  match: (brief: DesignBrief) => {
    const text = `${brief.intent} ${brief.audience || ''} ${brief.tone || ''}`.toLowerCase();
    const signals = ['meme', 'funny', 'joke', 'viral', 'reaction'];
    return signals.some((s) => text.includes(s)) ? 0.95 : 0.2;
  },
  requiredBriefFields: ['intent', 'tone'],
  systemPrompt: `You are an expert meme designer. Rules:
- Use big, readable Impact-style sans-serif text.
- Classic layouts: top/bottom caption, two-panel, or image-macro.
- Keep copy short and punchy; the image carries the joke.
- Ensure text has a dark stroke or sits on a high-contrast background.
- Safe-zone: keep captions away from platform UI overlays (top/bottom 10%).`,
  rubric: {
    criteria: [
      { name: 'legibility', description: 'Text is readable at thumbnail size', weight: 0.3 },
      { name: 'contrast', description: 'Text contrasts with background', weight: 0.3 },
      { name: 'safe_zone', description: 'Text avoids platform UI safe zones', weight: 0.2 },
      { name: 'humor_clarity', description: 'Joke is clear without explanation', weight: 0.2 },
    ],
  },
  examples: [
    {
      description: 'Remote work meme: top "When the standup could have been an email", bottom "Me pretending to pay attention".',
    },
  ],
};
