import { Injectable } from '@nestjs/common';
import type { DesignBrief } from '../ai-designer.types';
import { DESIGN_SKILLS, getDesignSkill } from './design-skill.registry';
import type {
  DesignSkillArtDirection,
  DesignSkillLayoutHints,
} from './design-skill.interface';

@Injectable()
export class AiDesignerSkillRouter {
  /**
   * Score every registered skill against the brief and return the best fit.
   * If the top score is below `threshold`, signal low confidence so the
   * Conversationalist can ask the user to choose.
   *
   * A user-picked skill (`brief.preferredSkill`, collected by the intake
   * choice form) is a hard override: it routes with full confidence.
   */
  route(
    brief: DesignBrief,
    threshold = 0.5
  ): {
    skillId: string;
    confidence: number;
    lowConfidence: boolean;
    alternatives: { skillId: string; title: string; confidence: number }[];
  } {
    const preferred =
      typeof brief.preferredSkill === 'string'
        ? getDesignSkill(brief.preferredSkill)
        : undefined;
    if (preferred) {
      return {
        skillId: preferred.id,
        confidence: 1,
        lowConfidence: false,
        alternatives: [],
      };
    }

    const scored = DESIGN_SKILLS.map((skill) => ({
      skill,
      confidence: skill.match(brief),
    })).sort((a, b) => b.confidence - a.confidence);

    const top = scored[0];
    const alternatives = scored.slice(1, 4).map((s) => ({
      skillId: s.skill.id,
      title: s.skill.title,
      confidence: s.confidence,
    }));

    return {
      skillId: top?.skill.id ?? DESIGN_SKILLS[0].id,
      confidence: top?.confidence ?? 0,
      lowConfidence: (top?.confidence ?? 0) < threshold,
      alternatives,
    };
  }

  getSkillPrompt(skillId: string): string {
    return getDesignSkill(skillId)?.systemPrompt ?? '';
  }

  getLayoutHints(skillId: string): DesignSkillLayoutHints | undefined {
    return getDesignSkill(skillId)?.layoutHints;
  }

  getRubric(skillId: string) {
    const exact = getDesignSkill(skillId)?.rubric;
    if (exact) return exact;
    // The planner improvises suffixes on the plan's skill echo
    // ("reference-clone-poster" for "reference-clone"); resolve to the
    // registered skill the id extends, longest prefix first, or the critique
    // goes out rubric-less.
    return DESIGN_SKILLS.filter((s) => skillId.startsWith(`${s.id}-`)).sort(
      (a, b) => b.id.length - a.id.length
    )[0]?.rubric;
  }

  /** The skill's curated art-direction catalog (preferred compositions,
   *  decor, effects, treatments) — suffix-tolerant like `getRubric`. */
  getArtDirection(skillId: string): DesignSkillArtDirection | undefined {
    const exact = getDesignSkill(skillId)?.artDirection;
    if (exact) return exact;
    return DESIGN_SKILLS.filter((s) => skillId.startsWith(`${s.id}-`)).sort(
      (a, b) => b.id.length - a.id.length
    )[0]?.artDirection;
  }
}
