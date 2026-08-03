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

// Round 7 C1: signals were matched with `String.includes`, so the
// advertisement skill's `'ad'` fired on "he-ad-line", "re-ad-y", "gr-ad-ient"
// and scored 0.9 for essentially every brief. Six consecutive live runs all
// routed to `advertisement`; four of the five skills had never executed.
describe('AiDesignerSkillRouter word-boundary signal matching (round 7 C1)', () => {
  const router = new AiDesignerSkillRouter();
  const score = (skillId: string, brief: DesignBrief) =>
    DESIGN_SKILLS.find((s) => s.id === skillId)!.match(brief);

  it.each([
    ['headline', 'a bold headline for our page'],
    ['ready', 'something ready for the weekend'],
    ['gradient', 'a soft gradient backdrop'],
    ['made', 'a design made for our page'],
    ['loaded', 'a fully loaded overview'],
    ['shade', 'a calm shade of green'],
  ])('no longer scores advertisement 0.9 on "%s"', (_word, intent) => {
    expect(score('advertisement', { intent })).toBe(0.25);
    expect(router.route({ intent }).skillId).not.toBe('advertisement');
  });

  it('still routes a real ad brief to advertisement', () => {
    for (const intent of [
      'an ad for our new roast',
      'run some ads this weekend',
      'get people to buy the sampler',
    ]) {
      expect(score('advertisement', { intent }), intent).toBe(0.9);
      expect(router.route({ intent }).skillId, intent).toBe('advertisement');
    }
  });

  it('hands a brief that names a specific genre to that genre', () => {
    // DELIBERATE CHANGE. These two used to route to `advertisement`, because
    // it was the only genre that claimed "sale" and "discount". Now that the
    // catalog has genres for them, the specific one wins — which is the entire
    // reason for adding them: `sale-discount` carries art direction for a
    // discount (the figure leads, one accent, an expiry), and `advertisement`
    // carries art direction for an ad in general.
    //
    // `advertisement` still matches these; it just no longer wins them.
    for (const intent of ['a weekend sale on all beans', 'promote the 20% discount']) {
      expect(score('advertisement', { intent }), intent).toBe(0.9);
      expect(router.route({ intent }).skillId, intent).toBe('sale-discount');
    }
  });

  it('matches every skill on its own signals', () => {
    expect(router.route({ intent: 'a funny meme', tone: 'playful' }).skillId).toBe('meme');
    expect(router.route({ intent: 'a birthday card for Ana' }).skillId).toBe('greeting-card');
    expect(router.route({ intent: 'show off our new product line' }).skillId).toBe(
      'product-promo'
    );
    expect(router.route({ intent: 'a testimonial from a happy client' }).skillId).toBe(
      'testimonial'
    );
    expect(router.route({ intent: 'announce our new opening hours' }).skillId).toBe(
      'announcement'
    );
  });

  it('keeps multi-word signals working', () => {
    expect(score('greeting-card', { intent: 'a thank you note for the team' })).toBe(0.9);
    expect(score('announcement', { intent: 'we are hiring two designers' })).toBe(0.9);
    expect(score('announcement', { intent: 'the studio is now open' })).toBe(0.9);
    expect(score('product-promo', { intent: 'our new arrivals for autumn' })).toBe(0.9);
    // …and only as a phrase: the words apart are not the signal.
    expect(score('announcement', { intent: 'open a new tab now' })).toBe(0.25);
  });

  it('tolerates plurals without re-opening the substring hole', () => {
    expect(score('meme', { intent: 'a few jokes about standups' })).toBe(0.95);
    expect(score('product-promo', { intent: 'three items on offer' })).toBe(0.9);
    // "discard"/"cardboard" must not read as a greeting card.
    expect(score('greeting-card', { intent: 'a cardboard packaging shot' })).toBe(0.15);
    expect(score('greeting-card', { intent: 'discard the old layout' })).toBe(0.15);
    // "itemised" must not read as a product promo.
    expect(score('product-promo', { intent: 'an itemised receipt graphic' })).toBe(0.3);
  });

  it('is case-insensitive', () => {
    expect(score('advertisement', { intent: 'A SALE this weekend' })).toBe(0.9);
    expect(score('meme', { intent: 'A MEME about Mondays' })).toBe(0.95);
  });
});
