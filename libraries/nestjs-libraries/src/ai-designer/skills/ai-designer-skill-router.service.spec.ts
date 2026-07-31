import { describe, expect, it } from 'vitest';
import { AiDesignerSkillRouter } from './ai-designer-skill-router.service';
import { DESIGN_SKILLS } from './design-skill.registry';
import type { DesignBrief } from '../ai-designer.types';

describe('AiDesignerSkillRouter', () => {
  const router = new AiDesignerSkillRouter();

  it('routes a clearly-matching brief with high confidence', () => {
    const brief: DesignBrief = { intent: 'a funny meme about remote work' };
    const routed = router.route(brief);

    expect(routed.skillId).toBe('meme');
    expect(routed.confidence).toBeGreaterThanOrEqual(0.5);
    expect(routed.lowConfidence).toBe(false);
  });

  it('surfaces lowConfidence with a list of alternatives on a vague brief', () => {
    const brief: DesignBrief = { intent: 'something nice for our page' };
    const routed = router.route(brief);

    expect(routed.lowConfidence).toBe(true);
    expect(routed.confidence).toBeLessThan(0.5);
    expect(routed.alternatives.length).toBeGreaterThan(0);
    expect(routed.alternatives.length).toBeLessThanOrEqual(3);
    // The top-scoring skill itself is not among the alternatives, and every
    // alternative carries a human-readable title for the choice form.
    const ids = new Set(DESIGN_SKILLS.map((s) => s.id));
    for (const alt of routed.alternatives) {
      expect(alt.skillId).not.toBe(routed.skillId);
      expect(ids.has(alt.skillId)).toBe(true);
      expect(alt.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('honors a user-picked preferredSkill as a full-confidence override', () => {
    const brief: DesignBrief = {
      intent: 'something nice for our page',
      preferredSkill: 'greeting-card',
    };
    const routed = router.route(brief);

    expect(routed.skillId).toBe('greeting-card');
    expect(routed.confidence).toBe(1);
    expect(routed.lowConfidence).toBe(false);
  });

  it('ignores an unknown preferredSkill', () => {
    const brief: DesignBrief = {
      intent: 'a funny meme about remote work',
      preferredSkill: 'not-a-skill',
    };
    expect(router.route(brief).skillId).toBe('meme');
  });

  it('exposes layout hints for every registered skill', () => {
    for (const skill of DESIGN_SKILLS) {
      const hints = router.getLayoutHints(skill.id);
      expect(hints, skill.id).toBeDefined();
      expect(hints!.formatTemplates.length).toBeGreaterThan(0);
      expect(hints!.slotSchema.length).toBeGreaterThan(0);
    }
  });
});
