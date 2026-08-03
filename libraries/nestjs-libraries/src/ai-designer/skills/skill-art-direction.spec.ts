import { describe, it, expect } from 'vitest';
import { DESIGN_SKILLS } from './design-skill.registry';
import { DESIGN_LANGUAGE_IDS } from '../design-language';
import { COMPOSITION_IDS } from '../layout/compositions';

/**
 * Drift guards for the genre catalog.
 *
 * A skill names composition and recipe ids as plain strings, so a renamed
 * recipe fails silently: the art direction is simply dropped and the genre
 * quietly reverts to generic. These are the tests that turn that into a
 * red build.
 */

const withArt = DESIGN_SKILLS.filter((s) => s.artDirection).map(
  (s) => [s.id, s.artDirection!] as const
);

describe('the genre catalog', () => {
  it('covers the social-content genres worth naming', () => {
    expect(DESIGN_SKILLS.length).toBeGreaterThanOrEqual(40);
  });

  it('has unique ids', () => {
    const ids = DESIGN_SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the five original genres, and keeps them first', () => {
    // Order decides ties in the router, so an original genre must not lose a
    // brief it has always won to a newly added one.
    expect(DESIGN_SKILLS.slice(0, 5).map((s) => s.id)).toEqual([
      'meme',
      'advertisement',
      'greeting-card',
      'product-promo',
      'announcement',
    ]);
  });

  it('gives every genre a real system prompt', () => {
    for (const skill of DESIGN_SKILLS) {
      expect(skill.systemPrompt.length, `${skill.id}`).toBeGreaterThan(120);
    }
  });

  it('leads every new genre with art direction, not with structure', () => {
    // A skill that is all slot ids and word counts produces structurally
    // correct, completely generic work.
    for (const [id] of withArt) {
      const skill = DESIGN_SKILLS.find((s) => s.id === id)!;
      const directionAt = skill.systemPrompt.indexOf('ART DIRECTION');
      const rulesAt = skill.systemPrompt.indexOf('Rules:');
      expect(directionAt, `${id} has no art direction`).toBeGreaterThan(-1);
      expect(directionAt, `${id} states rules before direction`).toBeLessThan(rulesAt);
    }
  });

  it('gives every genre at least one slot and a rubric', () => {
    for (const skill of DESIGN_SKILLS) {
      expect(skill.layoutHints.slotSchema.length, `${skill.id}`).toBeGreaterThan(0);
      expect(skill.rubric.criteria.length, `${skill.id}`).toBeGreaterThan(0);
    }
  });
});

describe('art direction references only things that exist', () => {
  it.each(withArt)('%s names real compositions', (id, art) => {
    for (const composition of art.compositions) {
      expect(COMPOSITION_IDS, `${id} names composition "${composition}"`).toContain(composition);
    }
  });

  it.each(withArt)('%s names real effects', (id, art) => {
    for (const effect of art.effects ?? []) {
      expect(DESIGN_LANGUAGE_IDS.effects, `${id} names effect "${effect}"`).toContain(effect);
    }
  });

  it.each(withArt)('%s names real treatments', (id, art) => {
    for (const treatment of art.treatments ?? []) {
      expect(DESIGN_LANGUAGE_IDS.treatments, `${id} names treatment "${treatment}"`).toContain(
        treatment
      );
    }
  });

  it.each(withArt)('%s names real decor', (id, art) => {
    for (const decor of art.decor ?? []) {
      expect(DESIGN_LANGUAGE_IDS.decor, `${id} names decor "${decor}"`).toContain(decor);
    }
  });

  it.each(withArt)('%s names real masks', (id, art) => {
    for (const mask of art.masks ?? []) {
      expect(DESIGN_LANGUAGE_IDS.masks, `${id} names mask "${mask}"`).toContain(mask);
    }
  });

  it.each(withArt)('%s keeps its preferred compositions in the layout hints', (id, art) => {
    const skill = DESIGN_SKILLS.find((s) => s.id === id)!;
    expect(skill.layoutHints.formatTemplates).toEqual(art.compositions);
  });
});

describe('genre routing', () => {
  it('routes a brief to the genre it names', () => {
    const cases: [string, string][] = [
      ['We need a testimonial from a happy customer', 'testimonial'],
      ['A YouTube thumbnail for the new video', 'youtube-thumbnail'],
      ['Flash sale, today only, 50% off', 'flash-sale'],
      ['Hiring a senior engineer, remote', 'hiring-jobpost'],
      ['A quote card for our founder', 'quote-card'],
      ['Property listing, 3 bedroom house', 'real-estate-listing'],
    ];

    for (const [intent, expected] of cases) {
      const scored = DESIGN_SKILLS.map((s) => ({ id: s.id, score: s.match({ intent }) })).sort(
        (a, b) => b.score - a.score
      );
      expect(scored[0].score, `"${intent}" matched nothing`).toBeGreaterThan(0.5);
      expect(
        scored.filter((s) => s.score > 0.5).map((s) => s.id),
        `"${intent}" did not reach ${expected}`
      ).toContain(expected);
    }
  });

  it('leaves an unrelated brief unmatched, so the picker asks', () => {
    // Below the router's confidence threshold, intake shows a genre picker
    // rather than guessing — which is the correct behaviour for a vague brief.
    const scored = DESIGN_SKILLS.map((s) => s.match({ intent: 'something nice for us' }));
    expect(Math.max(...scored)).toBeLessThan(0.5);
  });
});
