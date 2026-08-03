import type { DesignBrief } from '../ai-designer.types';
import { matchesAnySignal } from './signal-match';
import type {
  DesignSkill,
  DesignSkillArtDirection,
  DesignSkillLayoutHints,
  ScoringRubric,
} from './design-skill.interface';

/**
 * The boilerplate every genre shares, so a skill file is only the part that
 * makes it that genre.
 *
 * Without this each of forty genres would restate the same match function, the
 * same three legibility criteria and the same slot plumbing — and the ones that
 * matter, the art direction and the copy rules, would be buried in it.
 */

export interface SkillSlot {
  id: string;
  role: string;
  kind: DesignSkillLayoutHints['slotSchema'][number]['kind'];
}

export interface SkillDefinition {
  id: string;
  title: string;
  /** Words that mean this genre. Whole-word matched, plural-tolerant. */
  signals: string[];
  /** Brief fields intake must collect first. */
  requires?: string[];
  /**
   * The art direction, leading. What is this aiming at, and what does that
   * imply for type, imagery and depth — before any structural rule.
   */
  direction: string;
  /** The genre's own rules, one per line. */
  rules: string[];
  slots: SkillSlot[];
  art: DesignSkillArtDirection;
  /** Criteria beyond the shared ones. */
  criteria?: ScoringRubric['criteria'];
  examples?: { description: string }[];
}

/**
 * Criteria every genre is judged on. Genre-specific ones are appended, and the
 * vision critic appends its own genre-independent set on top of both.
 */
const SHARED_CRITERIA: ScoringRubric['criteria'] = [
  {
    name: 'legibility',
    description: 'Every line reads at feed-thumbnail size',
    weight: 0.25,
  },
  {
    name: 'hierarchy',
    description: 'One element clearly leads; the eye knows where to start',
    weight: 0.25,
  },
];

export const defineSkill = (def: SkillDefinition): DesignSkill => ({
  id: def.id,
  title: def.title,
  match: (brief: DesignBrief) => {
    const text = `${brief.intent} ${brief.audience || ''} ${brief.tone || ''}`.toLowerCase();
    return matchesAnySignal(text, def.signals) ? 0.95 : 0.2;
  },
  requiredBriefFields: def.requires ?? ['intent'],
  systemPrompt: [
    `You are an expert designer working on a ${def.title.toLowerCase()}.`,
    '',
    'ART DIRECTION — decide this before anything else:',
    def.direction,
    '',
    'Rules:',
    ...def.rules.map((r) => `- ${r}`),
  ].join('\n'),
  layoutHints: {
    formatTemplates: def.art.compositions,
    slotSchema: def.slots,
  },
  rubric: {
    criteria: [...SHARED_CRITERIA, ...(def.criteria ?? [])],
  },
  examples: def.examples,
  artDirection: def.art,
});
