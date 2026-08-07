import { describe, it, expect } from 'vitest';
import {
  applySlotRecipes,
  limitDecor,
  strengthForDepth,
  treatmentAdjustmentLayers,
  type ApplyContext,
} from './apply';
import { MAX_LOUD_DECOR } from './decor-recipes';

const PALETTE = ['#0b1020', '#f5f5f0', '#ff5a36'];
const box = { width: 600, height: 400 };
const ctx = (over: Partial<ApplyContext> = {}): ApplyContext => ({
  basis: 96,
  palette: PALETTE,
  kind: 'image',
  ...over,
});

describe('applySlotRecipes', () => {
  it('turns effect names into layer styles', () => {
    const patch = applySlotRecipes({ effects: ['soft-lift'] }, box, ctx({ kind: 'text' }));
    expect(patch.styles?.length).toBeGreaterThan(0);
  });

  it('caps effects at two, whatever the plan asks for', () => {
    // A model given a list reaches for three, and three layer styles on one
    // element is the line between designed and decorated.
    const patch = applySlotRecipes(
      { effects: ['soft-lift', 'keyline', 'neon-glow', 'long-shadow'] },
      box,
      ctx({ kind: 'text' })
    );
    const fromTwo = applySlotRecipes({ effects: ['soft-lift', 'keyline'] }, box, ctx({ kind: 'text' }));
    expect(patch.styles).toEqual(fromTwo.styles);
  });

  it('ignores an unknown effect name', () => {
    expect(applySlotRecipes({ effects: ['nope'] }, box, ctx({ kind: 'text' })).styles).toBeUndefined();
  });

  it('applies a treatment only to imagery', () => {
    // A filter stack on a text layer is a silently broken element, not an error.
    expect(applySlotRecipes({ treatment: 'film-grain' }, box, ctx({ kind: 'image' })).smartFilters)
      .toBeDefined();
    expect(applySlotRecipes({ treatment: 'film-grain' }, box, ctx({ kind: 'text' })).smartFilters)
      .toBeUndefined();
  });

  it('applies a mask only to imagery', () => {
    expect(applySlotRecipes({ mask: 'circle' }, box, ctx({ kind: 'image' })).mask).toBeDefined();
    expect(applySlotRecipes({ mask: 'circle' }, box, ctx({ kind: 'shape' })).mask).toBeUndefined();
  });

  it('converts a corner-radius mask against the box', () => {
    const patch = applySlotRecipes({ mask: 'soft-corners' }, box, ctx());
    expect(patch.borderRadius).toBeCloseTo(400 * 0.04, 5);
  });

  it('passes the slot copy to a text knockout', () => {
    expect(applySlotRecipes({ mask: 'text-knockout' }, box, ctx(), 'SALE').mask?.text).toBe('SALE');
  });

  it('accepts a real blend mode and rejects an invented one', () => {
    expect(applySlotRecipes({ blend: 'multiply' }, box, ctx()).blendMode).toBe('multiply');
    expect(applySlotRecipes({ blend: 'sparkle' }, box, ctx()).blendMode).toBeUndefined();
  });

  it('clamps rotation and rejects a non-finite one', () => {
    expect(applySlotRecipes({ rotation: 400 }, box, ctx()).rotation).toBe(180);
    expect(applySlotRecipes({ rotation: -400 }, box, ctx()).rotation).toBe(-180);
    expect(applySlotRecipes({ rotation: NaN }, box, ctx()).rotation).toBeUndefined();
  });

  it('returns an empty patch for a slot asking for nothing', () => {
    expect(applySlotRecipes({}, box, ctx())).toEqual({});
  });
});

describe('treatmentAdjustmentLayers', () => {
  const image = { x: 10, y: 20, width: 600, height: 400, groupId: 'hero' };

  it('clips every adjustment to the image', () => {
    // Unclipped, the adjustment grades the whole canvas — every layer beneath
    // it, including the copy.
    const layers = treatmentAdjustmentLayers({ treatment: 'duotone-brand' }, image, {
      palette: PALETTE,
    });
    expect(layers.length).toBeGreaterThan(0);
    expect(layers.every((l) => l.clipped === true)).toBe(true);
  });

  it('covers exactly the image box', () => {
    const layers = treatmentAdjustmentLayers({ treatment: 'mono' }, image, { palette: PALETTE });
    for (const l of layers) {
      expect([l.x, l.y, l.width, l.height]).toEqual([10, 20, 600, 400]);
    }
  });

  it('travels with the image through a re-fit', () => {
    const layers = treatmentAdjustmentLayers({ treatment: 'mono' }, image, { palette: PALETTE });
    expect(layers.every((l) => l.groupId === 'hero')).toBe(true);
  });

  it('keeps the recipe order, since adjustments compose in sequence', () => {
    // duotone is black-and-white THEN a gradient map; reversed, the ramp is
    // applied to colour and then discarded.
    const layers = treatmentAdjustmentLayers({ treatment: 'duotone-brand' }, image, {
      palette: PALETTE,
    });
    expect(layers.map((l) => l.adjustment!.type)).toEqual(['black-white', 'gradient-map']);
  });

  it('produces nothing for a filter-only or absent treatment', () => {
    expect(treatmentAdjustmentLayers({ treatment: 'film-grain' }, image, { palette: PALETTE })).toEqual([]);
    expect(treatmentAdjustmentLayers({}, image, { palette: PALETTE })).toEqual([]);
  });
});

describe('limitDecor', () => {
  it('keeps a single loud mark', () => {
    expect(limitDecor(['burst'])).toEqual(['burst']);
  });

  it('drops loud marks past the cap but keeps the quiet ones', () => {
    // Restraint has to be structural: a model told to decorate tastefully will
    // not reliably comply, and the cost is every design looking shouty.
    const out = limitDecor(['burst', 'diagonal-stripes', 'rule']);
    expect(out.filter((id) => id === 'burst' || id === 'diagonal-stripes')).toHaveLength(
      MAX_LOUD_DECOR
    );
    expect(out).toContain('rule');
  });

  it('leaves quiet marks alone however many there are', () => {
    const quiet = ['rule', 'short-rule', 'dashed-rule', 'arc'];
    expect(limitDecor(quiet)).toEqual(quiet);
  });

  it('handles an absent list', () => {
    expect(limitDecor(undefined)).toEqual([]);
  });
});

describe('strengthForDepth', () => {
  it('grades treatment intensity by the plan intent', () => {
    expect(strengthForDepth('flat')).toBeLessThan(strengthForDepth('layered'));
    expect(strengthForDepth('layered')).toBeLessThan(strengthForDepth('deep'));
  });

  it('defaults to the middle for an unknown or absent intent', () => {
    expect(strengthForDepth(undefined)).toBe(strengthForDepth('layered'));
    expect(strengthForDepth('nonsense')).toBe(strengthForDepth('layered'));
  });
});

describe('applySlotRecipes — the new vocabulary', () => {
  it('bends a shape with a named warp, and only a shape', () => {
    const onShape = applySlotRecipes({ warp: 'arc-banner' }, box, ctx({ kind: 'shape' }));
    expect(onShape.warp).toEqual({ preset: 'arc', bend: 26 });
    // Warped text is the renderer's curved-text feature (`style.curve`), so a
    // warp on a text slot must not leak through this path.
    const onText = applySlotRecipes({ warp: 'arc-banner' }, box, ctx({ kind: 'text' }));
    expect(onText.warp).toBeUndefined();
  });

  it('degrades an unknown warp name to no change', () => {
    const patch = applySlotRecipes({ warp: 'nope' }, box, ctx({ kind: 'shape' }));
    expect(patch.warp).toBeUndefined();
  });

  it('frosts a glass-panel shape and refuses to frost text', () => {
    const onShape = applySlotRecipes({ effects: ['glass-panel'] }, box, ctx({ kind: 'shape' }));
    expect(onShape.backdropFilter?.blur).toBeGreaterThan(0);
    expect(onShape.fill).toBeTruthy();
    const onText = applySlotRecipes({ effects: ['glass-panel'] }, box, ctx({ kind: 'text' }));
    expect(onText.backdropFilter).toBeUndefined();
  });

  it('puts a gradient-headline ramp on text and a radial glow on shapes', () => {
    const headline = applySlotRecipes(
      { effects: ['gradient-headline'] },
      box,
      ctx({ kind: 'text' })
    );
    expect(headline.fillGradient?.type).toBe('linear');
    expect(headline.fillGradient?.stops).toHaveLength(2);

    const glow = applySlotRecipes({ effects: ['radial-glow'] }, box, ctx({ kind: 'shape' }));
    expect(glow.fillGradient?.type).toBe('radial');
    expect(glow.fillGradient?.focalX).toBeLessThan(0.5);
    // But never on an image — a text gradient on a photo is a broken element.
    const onImage = applySlotRecipes({ effects: ['radial-glow'] }, box, ctx({ kind: 'image' }));
    expect(onImage.fillGradient).toBeUndefined();
  });

  it('clamps planned star geometry into the schema range', () => {
    const patch = applySlotRecipes(
      { sides: 100, innerRatio: 0.01 },
      box,
      ctx({ kind: 'shape' })
    );
    expect(patch.sides).toBe(64);
    expect(patch.innerRatio).toBe(0.05);
  });
});
