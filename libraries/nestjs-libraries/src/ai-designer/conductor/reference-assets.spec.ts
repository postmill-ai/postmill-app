import { describe, expect, it } from 'vitest';
import { ensureExplicitLogoSlots, visualReferenceFileId } from './reference-assets';
import type { DesignPlan } from '../ai-designer.types';

const plan = {
  variantId: 'variant-1',
  skill: 'advertisement',
  concept: 'Sale',
  palette: ['#fff', '#000', '#f00'],
  typeScale: {},
  background: { kind: 'solid' },
  slots: [],
  assetNeeds: [],
} as unknown as DesignPlan;

describe('reference roles', () => {
  it('never conditions hero imagery on the designated logo', () => {
    expect(visualReferenceFileId({ referenceFileIds: ['logo-1'] , logoFileId: 'logo-1' })).toBeUndefined();
    expect(visualReferenceFileId({ referenceFileIds: ['logo-1', 'scene-1'], logoFileId: 'logo-1' })).toBe('scene-1');
  });

  it('adds an explicitly requested logo slot without changing other plans', () => {
    const withLogo = ensureExplicitLogoSlots([plan], 'logo-1');
    expect(withLogo[0].slots).toEqual([{ id: 'logo', role: 'logo', kind: 'logo' }]);
    expect(plan.slots).toEqual([]);
    expect(ensureExplicitLogoSlots(withLogo, 'logo-1')).toEqual(withLogo);
    expect(ensureExplicitLogoSlots([plan])).toEqual([plan]);
  });
});
