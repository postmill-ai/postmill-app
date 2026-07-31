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
- One heartfelt main message, centered, in an elegant display face — this is the whole card.
- An optional short secondary line ("with love, the team") sits below at half the size or less.
- Generous whitespace is mandatory: the message should occupy the middle third with air on every side.
- Background is a soft gradient, subtle pattern, or a gentle illustration — never a busy photo behind the text.
- Center everything horizontally; ceremonial layouts are symmetrical. The minimal-centered and badge-burst templates are home.
- A small decorative badge or accent shape (wreath, star, heart) may frame the message — one motif, not a border of clip-art.
- Palette: soft, warm, low-saturation; one slightly richer accent for the message itself.
- Type treatment: no strokes, no heavy shadows — at most a whisper of shadow for legibility over texture.
- Occasion first: match the mood (playful for birthdays, serene for sympathy, festive for holidays) before matching the brand.
- No CTAs, no prices, no urgency. A greeting card that sells is a failed greeting card.`,
  layoutHints: {
    formatTemplates: ['minimal-centered', 'badge-burst'],
    slotSchema: [
      { id: 'message', role: 'headline', kind: 'text' },
      { id: 'signoff', role: 'subhead', kind: 'text' },
      { id: 'badge', role: 'motif-badge', kind: 'badge' },
      { id: 'accent', role: 'decoration', kind: 'accent-shape' },
    ],
  },
  rubric: {
    criteria: [
      { name: 'readability', description: 'Message is easy to read', weight: 0.35 },
      { name: 'mood', description: 'Visual mood matches occasion', weight: 0.3 },
      { name: 'balance', description: 'Whitespace and layout feel balanced', weight: 0.2 },
      { name: 'safe_zone', description: 'Text avoids platform UI overlays', weight: 0.15 },
    ],
  },
};
