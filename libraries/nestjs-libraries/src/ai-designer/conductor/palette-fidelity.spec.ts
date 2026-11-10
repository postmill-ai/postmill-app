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
  it('adds brand colors without replacing the style surface, text or accents', () => {
    const [plan] = applyPaletteConstraints([makePlan()], {
      brandPalette: ['#FF0000', '#00ff00', '#0000ff'],
    });
    expect(plan.palette).toEqual([
      '#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#123456',
    ]);
    expect(plan.background.value).toBe('#ffffff');
  });

  it('keeps a pinned style palette intact and only adds explicit prompt colors', () => {
    const [plan] = applyPaletteConstraints([makePlan()], {
      brandPalette: ['#ff0000'],
      intent: 'Use #abcdef for the accent',
      pinnedStyle: true,
    });
    expect(plan.palette).toEqual(['#ffffff', '#000000', '#abcdef', '#123456']);
  });

  it('keeps explicit prompt hexes and adds unpinned brand accents', () => {
    const [plan] = applyPaletteConstraints([makePlan()], {
      brandPalette: ['#ff0000'],
      intent: 'Use #abcdef for the accent',
    });
    expect(plan.palette).toEqual(['#ffffff', '#000000', '#abcdef', '#ff0000', '#123456']);
    expect(explicitPromptColors('Use #abcdef and #123456')).toEqual(['#abcdef', '#123456']);
  });

  it('ignores malformed brand values and leaves unconstrained plans unchanged', () => {
    expect(applyPaletteConstraints([makePlan()], { brandPalette: ['red'] })).toEqual([makePlan()]);
  });
});
