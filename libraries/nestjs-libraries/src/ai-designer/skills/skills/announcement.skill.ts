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
- The headline IS the announcement ("We're open", "Version 2 is here") — bold, authoritative, and the largest type on the canvas.
- One supporting detail line: date, place, or the one thing that changed. Strictly smaller than the headline, never longer than one sentence.
- Structure beats decoration: a clean editorial-sidebar or minimal-centered stack reads as news; clutter reads as an ad.
- Use the brand accent color for exactly one element — the headline keyword, a rule, or a small badge. More than one accent reads as noise.
- A date/location badge ("Sep 12", "Online") is welcome; it anchors the news in time. Keep it small and out of the headline's way.
- At most one supporting image or icon, clearly subordinate to the type. Text-only announcements are often stronger.
- Generous whitespace is the medium: announcements need air to feel important. Keep margins at 6-8% minimum.
- Left-align for editorial authority, center for ceremonial news — never mix the two on one canvas.
- Headline fully inside safe zones, with extra clearance at the bottom where platform UI overlays live.
- No hard-sell CTA. A soft "Learn more" text line is acceptable; a loud button cheapens the news.`,
  layoutHints: {
    formatTemplates: ['editorial-sidebar', 'minimal-centered'],
    slotSchema: [
      { id: 'headline', role: 'headline', kind: 'text' },
      { id: 'detail', role: 'subhead', kind: 'text' },
      { id: 'badge', role: 'date-badge', kind: 'badge' },
      { id: 'image', role: 'image', kind: 'image' },
    ],
  },
  rubric: {
    criteria: [
      { name: 'headline_impact', description: 'Headline commands attention', weight: 0.35 },
      { name: 'readability', description: 'Headline + detail are legible', weight: 0.3 },
      { name: 'brand_alignment', description: 'Accent colors/fonts match brand', weight: 0.2 },
      { name: 'safe_zone', description: 'Text avoids platform UI overlays', weight: 0.15 },
    ],
  },
};
