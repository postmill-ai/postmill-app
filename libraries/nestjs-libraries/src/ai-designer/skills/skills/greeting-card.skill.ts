import type { DesignBrief } from '../../ai-designer.types';
import type { DesignSkill } from '../design-skill.interface';

export const GreetingCardSkill: DesignSkill = {
  id: 'greeting-card',
  title: 'Greeting Card',
  match: (brief: DesignBrief) => {
    const text = `${brief.intent} ${brief.audience || ''}`.toLowerCase();
    const signals = ['birthday', 'holiday', 'greeting', 'card', 'wishes', 'congrats', 'thank you'];
    return signals.some((s) => text.includes(s)) ? 0.9 : 0.15;
  },
  requiredBriefFields: ['intent'],
  systemPrompt: `You are a warm greeting-card designer. Rules:
- Centered, elegant typography with generous whitespace.
- Soft gradients or subtle patterns as background.
- One heartfelt main message + optional short secondary line.
- Avoid hard-sell CTAs; focus on emotion and readability.`,
  rubric: {
    criteria: [
      { name: 'readability', description: 'Message is easy to read', weight: 0.35 },
      { name: 'mood', description: 'Visual mood matches occasion', weight: 0.3 },
      { name: 'balance', description: 'Whitespace and layout feel balanced', weight: 0.2 },
      { name: 'safe_zone', description: 'Text avoids platform UI overlays', weight: 0.15 },
    ],
  },
};
