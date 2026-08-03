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

/**
 * The art direction a genre carries, beyond its copy rules.
 *
 * A skill that is all structure — slot ids, word counts, safe zones — produces
 * structurally correct and completely generic work. What makes a testimonial
 * look like a testimonial rather than a filled-in form is the reference class
 * it is aiming at, and that has to be stated.
 *
 * Every id here is validated against the live catalogs by the registry spec, so
 * a genre cannot quietly reference a recipe that no longer exists.
 */
export interface DesignSkillArtDirection {
  /** Composition ids, most-preferred first. */
  compositions: string[];
  /** Effect recipe ids this genre reaches for. */
  effects?: string[];
  /** Image treatment ids that suit this genre. */
  treatments?: string[];
  /** Decor recipe ids that suit this genre. */
  decor?: string[];
  /** Mask recipe ids that suit this genre. */
  masks?: string[];
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
  /** Optional while the older genres are migrated. */
  artDirection?: DesignSkillArtDirection;
}
