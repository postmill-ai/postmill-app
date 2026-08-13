import { describe, expect, it } from 'vitest';
import { applyReferenceGeometry } from './apply-reference-geometry';
import type { DesignPlan, ReferenceLayout } from '../ai-designer.types';

const makeClonePlan = (over: Partial<DesignPlan> = {}): DesignPlan =>
  ({
    variantId: 'v1',
    skill: 'reference-clone',
    concept: 'pizza poster',
    slots: [
      { id: 'kicker', role: 'accent', kind: 'text' },
      { id: 'headline', role: 'headline', kind: 'text' },
      { id: 'subhead', role: 'benefit', kind: 'text' },
      { id: 'badge', role: 'price-badge', kind: 'badge' },
      { id: 'legal', role: 'legal', kind: 'text' },
      { id: 'image', role: 'product-image', kind: 'image' },
    ],
    assetNeeds: [],
    palette: [],
    typeScale: {},
    background: { kind: 'image' },
    texts: {
      kicker: 'Italian',
      headline: 'PIZZA',
      subhead: 'Traditional Pizza',
      badge: '1893',
      legal: 'www.yourpage.com',
    },
    ...over,
  } as unknown as DesignPlan);

const LAYOUT: ReferenceLayout = {
  lines: [
    { text: 'Italian', yBand: [0.05, 0.08], xAnchor: 'left' },
    {
      text: 'PIZZA',
      yBand: [0.08, 0.2],
      xAnchor: 'left',
      heightRatio: 0.11,
      fontClass: 'condensed slab serif',
      case: 'caps',
    },
    { text: 'Traditional pizza', yBand: [0.22, 0.26], xAnchor: 'left' },
    { text: 'WWW.YOURPAGE.COM', yBand: [0.93, 0.95], xAnchor: 'center' },
  ],
  badge: { yBand: [0.6, 0.66], xAnchor: 'left', shape: 'ribbon' },
};

describe('applyReferenceGeometry', () => {
  it('stamps measured bands onto text-matched slots of clone plans', () => {
    const [plan] = applyReferenceGeometry([makeClonePlan()], LAYOUT);

    const slot = (id: string) => plan.slots.find((s) => s.id === id) as any;
    expect(slot('kicker').geometry).toEqual({
      yBand: [0.05, 0.08],
      xAnchor: 'left',
    });
    expect(slot('headline').geometry).toEqual({
      yBand: [0.08, 0.2],
      xAnchor: 'left',
      heightRatio: 0.11,
    });
    // Case-insensitive text matching (the reference reports the painted case).
    expect(slot('subhead').geometry?.yBand).toEqual([0.22, 0.26]);
    expect(slot('legal').geometry?.yBand).toEqual([0.93, 0.95]);
    // The badge matches structurally, from layout.badge.
    expect(slot('badge').geometry).toEqual({
      yBand: [0.6, 0.66],
      xAnchor: 'left',
    });
    // Imagery is never stamped.
    expect(slot('image').geometry).toBeUndefined();
  });

  it('falls back to size rank when the plan has no matching texts', () => {
    const plan = makeClonePlan({ texts: undefined });
    const layout: ReferenceLayout = {
      lines: [
        { text: 'small line', yBand: [0.3, 0.33], heightRatio: 0.02 },
        { text: 'BIG LINE', yBand: [0.1, 0.25], heightRatio: 0.12 },
      ],
    };

    const [stamped] = applyReferenceGeometry([plan], layout);

    // The LARGEST unmatched line pairs with the loudest slot (the headline) —
    // the clone skill's "hierarchy comes from size" rule.
    const headline = stamped.slots.find((s) => s.id === 'headline') as any;
    expect(headline.geometry?.heightRatio).toBe(0.12);
  });

  it('nudges overlapping bands apart so the overlap guard is not handed a pre-collided stack', () => {
    const plan = makeClonePlan();
    const layout: ReferenceLayout = {
      lines: [
        { text: 'Italian', yBand: [0.05, 0.12] },
        { text: 'PIZZA', yBand: [0.1, 0.2] }, // overlaps the kicker's band
      ],
    };

    const [stamped] = applyReferenceGeometry([plan], layout);

    const kicker = (stamped.slots.find((s) => s.id === 'kicker') as any).geometry;
    const headline = (stamped.slots.find((s) => s.id === 'headline') as any)
      .geometry;
    expect(headline.yBand[0]).toBeGreaterThanOrEqual(kicker.yBand[1]);
    // Height preserved through the nudge.
    expect(headline.yBand[1] - headline.yBand[0]).toBeCloseTo(0.1, 5);
  });

  it('leaves non-clone plans untouched', () => {
    const plan = makeClonePlan({ skill: 'advertisement' });
    const [result] = applyReferenceGeometry([plan], LAYOUT);
    expect(result).toBe(plan);
    expect(result.slots.every((s: any) => s.geometry === undefined)).toBe(true);
  });

  it('accepts planner-improvised clone-skill suffixes', () => {
    const plan = makeClonePlan({ skill: 'reference-clone-poster' });
    const [result] = applyReferenceGeometry([plan], LAYOUT);
    expect(
      (result.slots.find((s) => s.id === 'headline') as any).geometry
    ).toBeDefined();
  });

  it('is a no-op without a layout', () => {
    const plans = [makeClonePlan()];
    expect(applyReferenceGeometry(plans, undefined)).toBe(plans);
  });
});
