import { describe, it, expect } from 'vitest';
import { WARP_PRESETS } from '../../media/designer-doc/warp';
import { WARP_RECIPES, expandWarp, warpCatalogPrompt } from './warp-recipes';

/**
 * The warp catalog follows the same offered=implemented contract as every
 * other recipe table: names in the generated prompt must expand to warps the
 * renderer draws, and unknown names must degrade to nothing.
 */

describe('warp recipes', () => {
  it('every recipe names a preset the renderer implements', () => {
    const presets = new Set(WARP_PRESETS.map((p) => p.value));
    for (const recipe of WARP_RECIPES) {
      expect(presets.has(recipe.warp.preset), recipe.id).toBe(true);
    }
  });

  it('every bend is inside the schema range', () => {
    for (const recipe of WARP_RECIPES) {
      expect(Math.abs(recipe.warp.bend ?? 0), recipe.id).toBeLessThanOrEqual(100);
    }
  });

  it('expands by name and returns a copy, never the table entry', () => {
    const a = expandWarp('arc-banner')!;
    const b = expandWarp('arc-banner')!;
    expect(a).toEqual({ preset: 'arc', bend: 26 });
    expect(a).not.toBe(b);
  });

  it('degrades an unknown name to nothing — a stored plan may outlive a recipe', () => {
    expect(expandWarp('gone-in-v2')).toBeUndefined();
    expect(expandWarp(undefined)).toBeUndefined();
  });

  it('generates the prompt from the table, so offered cannot drift from implemented', () => {
    const prompt = warpCatalogPrompt();
    for (const recipe of WARP_RECIPES) {
      expect(prompt).toContain(recipe.id);
    }
  });
});
