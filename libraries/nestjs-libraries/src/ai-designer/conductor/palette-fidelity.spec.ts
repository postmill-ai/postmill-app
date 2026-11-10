import { describe, expect, it } from 'vitest';
import { applyPaletteConstraints, explicitPromptColors } from './palette-fidelity';
import type { DesignPlan } from '../ai-designer.types';

const makePlan = (): DesignPlan => ({
  variantId: 'variant-1',
  skill: 'advertisement',
  concept: 'Sale',
  palette: ['#ffffff', '#000000', '#123456'],
  typeScale: {},
  background: { kind: 'solid', value: '#ffffff' },
  slots: [],
  assetNeeds: [],
} as unknown as DesignPlan);

describe('palette constraints', () => {
  it('makes the selected brand palette win over a pinned style palette', () => {
    const [plan] = applyPaletteConstraints([makePlan()], {
      brandPalette: ['#FF0000', '#00ff00', '#0000ff'],
    });
    expect(plan.palette).toEqual([
      '#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#123456',
    ]);
    expect(plan.background.value).toBe('#ff0000');
  });

  it('keeps explicit prompt hexes and fills short brand palettes readably', () => {
    const [plan] = applyPaletteConstraints([makePlan()], {
      brandPalette: ['#ff0000'],
      intent: 'Use #abcdef for the accent',
    });
    expect(plan.palette.slice(0, 3)).toEqual(['#ff0000', '#abcdef', '#ffffff']);
    expect(explicitPromptColors('Use #abcdef and #123456')).toEqual(['#abcdef', '#123456']);
  });

  it('ignores malformed brand values and leaves unconstrained plans unchanged', () => {
    expect(applyPaletteConstraints([makePlan()], { brandPalette: ['red'] })).toEqual([makePlan()]);
  });
});
