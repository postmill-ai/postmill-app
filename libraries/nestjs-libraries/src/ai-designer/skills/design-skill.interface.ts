import type { DesignBrief, DesignPlan } from '../ai-designer.types';

export interface DesignSkillExample {
  description: string;
  plan?: Partial<DesignPlan>;
}

export interface ScoringRubric {
  criteria: { name: string; description: string; weight: number }[];
}

export interface DesignSkill {
  id: string;
  title: string;
  match(brief: DesignBrief): number;
  requiredBriefFields: string[];
  systemPrompt: string;
  rubric: ScoringRubric;
  examples?: DesignSkillExample[];
  channelFit?: string[];
}
