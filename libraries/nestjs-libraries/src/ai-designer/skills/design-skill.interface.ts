import type { DesignBrief, DesignPlan, DesignSlot } from '../ai-designer.types';

export interface DesignSkillExample {
  description: string;
  plan?: Partial<DesignPlan>;
}

export interface ScoringRubric {
  criteria: { name: string; description: string; weight: number }[];
}

export interface DesignSkillLayoutHints {
  /**
   * Preferred layout-gallery templates (composer `LayoutId` values such as
   * `hero-fullbleed` / `split-panel`), most-preferred first. The art director
   * picks the plan's `formatTemplate` from this list unless the brief demands
   * otherwise.
   */
  formatTemplates: string[];
  /**
   * Canonical slot list for this format — the ids/roles/kinds the composer
   * can lay out deterministically. Plans should name these slots so copy,
   * assets, and revise fixes all key off the same ids.
   */
  slotSchema: Pick<DesignSlot, 'id' | 'role' | 'kind'>[];
}

export interface DesignSkill {
  id: string;
  title: string;
  match(brief: DesignBrief): number;
  /** Brief fields the intake flow must collect before planning with this skill. */
  requiredBriefFields: string[];
  systemPrompt: string;
  layoutHints: DesignSkillLayoutHints;
  rubric: ScoringRubric;
  examples?: DesignSkillExample[];
}
