import { describe, expect, it } from 'vitest';
import type { DesignPlan } from '../../ai-designer.types';
import {
  briefCorpus,
  findUngroundedClaims,
  lintCta,
  stripUngroundedClaims,
} from './copy-grounding';

const planWith = (texts: Record<string, string>): DesignPlan =>
  ({
    variantId: 'v1',
    skill: 'sale-discount',
    concept: 'test',
    slots: Object.keys(texts).map((id) => ({
      id,
      role: id,
      kind: id === 'cta' ? 'cta-button' : id === 'badge' ? 'badge' : 'text',
    })),
    texts,
    assetNeeds: [],
  }) as unknown as DesignPlan;

const bogoCorpus = briefCorpus({
  intent: 'create a post for my pizza business. we are having a sale: buy 1 get 1 free',
  tone: 'hungry',
  audience: 'humans',
});

describe('findUngroundedClaims', () => {
  it('flags the fabricated urgency and jargon the pizza run shipped', () => {
    const plan = planWith({
      headline: 'B1G1 FREE',
      badge: 'TONIGHT ONLY',
      legal: 'ENDS TONIGHT. SELECT PIZZAS ONLY. CONDITIONS APPLY.',
    });
    const phrases = findUngroundedClaims(plan, bogoCorpus).map((c) =>
      c.phrase.toUpperCase()
    );
    expect(phrases).toContain('B1G1');
    expect(phrases).toContain('TONIGHT ONLY');
    expect(phrases).toContain('ENDS TONIGHT');
    expect(phrases).toContain('SELECT PIZZAS ONLY');
  });

  it('flags LIMITED TIME when the brief states no deadline', () => {
    const plan = planWith({ badge: 'LIMITED TIME' });
    expect(findUngroundedClaims(plan, bogoCorpus)).toHaveLength(1);
  });

  it('keeps claims the brief actually states', () => {
    const corpus = briefCorpus({
      intent: 'flash sale tonight only, buy 1 get 1 free pizza',
    });
    const plan = planWith({ badge: 'TONIGHT ONLY' });
    expect(findUngroundedClaims(plan, corpus)).toHaveLength(0);
  });

  it('grounds "TONIGHT ONLY" on a brief that says just "tonight"', () => {
    const corpus = briefCorpus({ intent: 'promo for our show tonight' });
    const plan = planWith({ badge: 'TONIGHT ONLY' });
    expect(findUngroundedClaims(plan, corpus)).toHaveLength(0);
  });

  it('grounds claims stated in reference cues (clone runs repeat the reference)', () => {
    const corpus = briefCorpus({
      intent: 'recreate this poster',
      referenceCues: ['badge top-left reads "TONIGHT ONLY" in pink'],
    });
    const plan = planWith({ badge: 'TONIGHT ONLY' });
    expect(findUngroundedClaims(plan, corpus)).toHaveLength(0);
  });

  it('flags BOGO jargon the user never typed, keeps it when they did', () => {
    const plan = planWith({ headline: 'BOGO WEEK' });
    expect(findUngroundedClaims(plan, bogoCorpus).length).toBeGreaterThan(0);
    const saidIt = briefCorpus({ intent: 'we run a bogo deal on pizzas' });
    expect(findUngroundedClaims(plan, saidIt)).toHaveLength(0);
  });

  it('does not flag plain copy', () => {
    const plan = planWith({
      headline: 'BUY 1 GET 1 FREE',
      subhead: 'On every pizza',
      cta: 'Order now',
    });
    expect(findUngroundedClaims(plan, bogoCorpus)).toHaveLength(0);
  });
});

describe('stripUngroundedClaims', () => {
  it('cuts the phrase and keeps the rest of the line readable', () => {
    const plan = planWith({
      legal: 'ENDS TONIGHT. SELECT PIZZAS ONLY. CONDITIONS APPLY.',
    });
    const claims = findUngroundedClaims(plan, bogoCorpus);
    stripUngroundedClaims(plan, claims);
    expect(plan.texts!.legal).toBe('CONDITIONS APPLY.');
  });

  it('drops the slot whole when nothing meaningful remains', () => {
    const plan = planWith({ badge: 'TONIGHT ONLY', headline: 'PIZZA SALE' });
    const claims = findUngroundedClaims(plan, bogoCorpus);
    stripUngroundedClaims(plan, claims);
    expect(plan.texts!.badge).toBeUndefined();
    expect(plan.slots!.some((s) => s.id === 'badge')).toBe(false);
    expect(plan.texts!.headline).toBe('PIZZA SALE');
  });

  it('strips jargon inside a longer headline', () => {
    const plan = planWith({ headline: 'B1G1 FREE PIZZA' });
    const claims = findUngroundedClaims(plan, bogoCorpus);
    stripUngroundedClaims(plan, claims);
    expect(plan.texts!.headline).toBe('FREE PIZZA');
  });
});

describe('contact facts', () => {
  it('flags invented phone numbers — vanity and numeric — the brief never gave', () => {
    // Live: "(555) 123-4567" and "1-800-VAN-SUPPLY" shipped for a brief
    // that named no number at all.
    for (const phone of ['(555) 123-4567', '555-123-4567', '1-800-VAN-SUPPLY']) {
      const plan = planWith({ subhead: `CALL ${phone}` });
      const claims = findUngroundedClaims(plan, bogoCorpus);
      expect(claims.length, phone).toBeGreaterThan(0);
      stripUngroundedClaims(plan, claims);
      expect(plan.texts!.subhead ?? '', phone).not.toContain(phone);
    }
  });

  it('keeps a phone number the brief actually contains', () => {
    const corpus = briefCorpus({
      intent: 'pool cleaning posts, call us at (555) 123-4567',
    });
    const plan = planWith({ subhead: 'CALL (555) 123-4567' });
    expect(findUngroundedClaims(plan, corpus)).toHaveLength(0);
  });
});

describe('placeholder copy', () => {
  it('flags placeholders regardless of the brief (never groundable)', () => {
    const plan = planWith({
      subhead: '(PHONE NUMBER NEEDED)',
      body: 'Serving Anytown, USA',
    });
    const claims = findUngroundedClaims(plan, bogoCorpus);
    expect(claims.some((c) => /PHONE NUMBER NEEDED/i.test(c.phrase))).toBe(true);
    // Stripping empties the slot → the slot dies whole.
    stripUngroundedClaims(plan, claims);
    expect(plan.texts!.subhead).toBeUndefined();
    expect(plan.texts!.body).toBe('Serving Anytown, USA');
  });

  it('does not flag real copy that happens to contain "needed"', () => {
    const plan = planWith({ subhead: 'No appointment needed' });
    expect(findUngroundedClaims(plan, bogoCorpus)).toHaveLength(0);
  });
});

describe('lintCta', () => {
  it('accepts real commands', () => {
    expect(lintCta('Order now')).toBe(true);
    expect(lintCta('Shop the sale')).toBe(true);
    expect(lintCta('Get yours')).toBe(true);
    expect(lintCta('Learn more')).toBe(true);
  });

  it('rejects the "Shop sale" fragment family', () => {
    expect(lintCta('Shop sale')).toBe(false);
    expect(lintCta('Buy deal')).toBe(false);
    expect(lintCta('Get offer')).toBe(false);
  });

  it('rejects non-verb-first labels', () => {
    expect(lintCta('Sale now')).toBe(false);
    expect(lintCta('Free pizza')).toBe(false);
    expect(lintCta('')).toBe(false);
  });
});
