import type { DesignBrief, DesignPlan } from '../../ai-designer.types';
import type { DesignSkill } from '../design-skill.interface';
import { matchesAnySignal } from '../signal-match';

export const MemeSkill: DesignSkill = {
  id: 'meme',
  title: 'Meme',
  match: (brief: DesignBrief) => {
    const text = `${brief.intent} ${brief.audience || ''} ${brief.tone || ''}`.toLowerCase();
    const signals = ['meme', 'funny', 'joke', 'viral', 'reaction'];
    return matchesAnySignal(text, signals) ? 0.95 : 0.2;
  },
  requiredBriefFields: ['intent', 'tone'],
  systemPrompt: `You are an expert meme designer. Rules:
- The image carries the joke; the captions only set it up and land it. Never let copy cover the subject's face or the visual punchline.
- Use a heavy condensed display font (e.g. Anton) — bold, all-caps, readable at thumbnail size.
- Classic layout: top/bottom caption bars (the "top-bottom" template). Top caption sets context, bottom caption delivers the punchline.
- Keep each caption under 10 words; two short lines beat one long one.
- Every caption gets a dark text stroke (3-5% of font size) or sits on a high-contrast band — memes get reposted onto busy feeds and must survive any background.
- Scale captions to fill 70-90% of the canvas width; tiny meme text reads as a screenshot, not a meme.
- Center captions horizontally; vertical-align top caption to the top band, bottom caption to the bottom band.
- Safe-zone: keep captions inside the central 80% vertically — platform UI overlays eat the top and bottom 10%.
- No CTAs, no badges, no gradients — meme grammar is image + two captions. Resist decorating it.
- If the brief's joke needs more than two captions, it is not a meme — simplify the joke, don't add slots.`,
  layoutHints: {
    formatTemplates: ['top-bottom'],
    slotSchema: [
      { id: 'image', role: 'image', kind: 'image' },
      { id: 'top', role: 'top-caption', kind: 'text' },
      { id: 'bottom', role: 'bottom-caption', kind: 'text' },
    ],
  },
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
