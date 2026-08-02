import { describe, expect, it } from 'vitest';
import {
  FORM_CONTROL_KEYS,
  MAX_BRIEF_BYTES,
  MAX_QUESTIONS_ASKED,
  RESERVED_BRIEF_KEYS,
  mergeBriefValues,
  sanitizeBriefValues,
} from './brief-values';

describe('sanitizeBriefValues', () => {
  it('passes ordinary intake fields through untouched', () => {
    const values = {
      intent: 'a summer promo',
      audience: 'young professionals',
      tone: 'playful',
    };
    expect(sanitizeBriefValues(values)).toEqual(values);
  });

  it('strips every server-owned brief key', () => {
    const values: Record<string, unknown> = {
      intent: 'keep me',
      lastPlans: [{ variantId: 'x' }],
      lastDeliveredDesignIds: ['design-1'],
      skillId: 'meme',
      pendingReviseTarget: 'design-1',
      questionsAsked: ['q1'],
      referenceCues: ['cue'],
      recapShown: true,
    };
    const result = sanitizeBriefValues(values);
    expect(result).toEqual({ intent: 'keep me' });
    for (const key of RESERVED_BRIEF_KEYS) {
      expect(result).not.toHaveProperty(key);
    }
  });

  it('strips delivery-form control values', () => {
    const values: Record<string, unknown> = {
      intent: 'keep me',
      action: 'accept',
      variantId: 'variant-1',
      dontSaveTemplate: ['yes'],
      instruction: 'make the headline bigger',
    };
    const result = sanitizeBriefValues(values);
    expect(result).toEqual({ intent: 'keep me' });
    for (const key of FORM_CONTROL_KEYS) {
      expect(result).not.toHaveProperty(key);
    }
  });

  it('returns an empty object for empty input', () => {
    expect(sanitizeBriefValues({})).toEqual({});
  });
});

describe('mergeBriefValues', () => {
  it('merges values, keeps existing intent, and appends the replyTo', () => {
    const merged = mergeBriefValues(
      { intent: 'a meme', questionsAsked: ['q1'] },
      { audience: 'devs', tone: 'funny' },
      'q2'
    );
    expect(merged).toEqual({
      intent: 'a meme',
      audience: 'devs',
      tone: 'funny',
      questionsAsked: ['q1', 'q2'],
    });
  });

  it('takes intent from the values when the brief has none', () => {
    const merged = mergeBriefValues({ intent: '' }, { intent: 'a promo' }, 'q1');
    expect(merged.intent).toBe('a promo');
  });

  it('appends every entry of an array replyTo (form field names)', () => {
    const merged = mergeBriefValues(
      { intent: '', questionsAsked: ['audience'] },
      { intent: 'a summer sale', audience: 'followers' },
      ['intent', 'audience']
    );
    expect(merged.questionsAsked).toEqual(['audience', 'intent', 'audience']);
  });

  it('merges without touching questionsAsked when no replyTo is given', () => {
    const merged = mergeBriefValues(
      { intent: 'a meme', questionsAsked: ['q1'] },
      { tone: 'funny' }
    );
    expect(merged).toEqual({
      intent: 'a meme',
      tone: 'funny',
      questionsAsked: ['q1'],
    });
  });

  it('caps questionsAsked at MAX_QUESTIONS_ASKED', () => {
    const existing = {
      intent: 'x',
      questionsAsked: Array.from({ length: MAX_QUESTIONS_ASKED }, (_, i) => `q${i}`),
    };
    const merged = mergeBriefValues(existing, {}, 'q-new');
    expect(merged.questionsAsked).toHaveLength(MAX_QUESTIONS_ASKED);
    expect(merged.questionsAsked?.[MAX_QUESTIONS_ASKED - 1]).toBe('q-new');
    expect(merged.questionsAsked?.[0]).toBe('q1');
  });

  it('rejects a merge that would push the serialized brief past the cap', () => {
    const existing = { intent: 'keep me', audience: 'devs' };
    const merged = mergeBriefValues(
      existing,
      { blob: 'x'.repeat(MAX_BRIEF_BYTES) },
      'q1'
    );
    expect(merged).toEqual({
      intent: 'keep me',
      audience: 'devs',
      questionsAsked: ['q1'],
    });
    expect(merged).not.toHaveProperty('blob');
  });

  it('accepts a merge under the cap unchanged', () => {
    const merged = mergeBriefValues(
      { intent: 'x' },
      { note: 'y'.repeat(1024) },
      'q1'
    );
    expect(merged.note).toBe('y'.repeat(1024));
  });

  it('normalizes spoken-style URLs in merged values', () => {
    const merged = mergeBriefValues(
      { intent: '' },
      { intent: 'a launch post for glowlab dot shop' },
      'intent'
    );
    expect(merged.intent).toBe('a launch post for glowlab.shop');
  });

  it('normalizes spoken URLs in carried-over brief fields too', () => {
    const merged = mergeBriefValues(
      { intent: 'check neonkickz dot co for the drop' },
      { tone: 'hype' }
    );
    expect(merged.intent).toBe('check neonkickz.co for the drop');
  });

  it('handles "dotcom" and is idempotent on dotted domains', () => {
    const merged = mergeBriefValues(
      { intent: '' },
      { intent: 'promo for glowlab dotcom and neonkickz.co' },
      'intent'
    );
    expect(merged.intent).toBe('promo for glowlab.com and neonkickz.co');
  });

  it('leaves non-TLD "dot" usages untouched', () => {
    const merged = mergeBriefValues(
      { intent: '' },
      { intent: 'a polka dot dress, the dot product, built on dot matrix' },
      'intent'
    );
    expect(merged.intent).toBe(
      'a polka dot dress, the dot product, built on dot matrix'
    );
  });

  it('extracts single-, double-, and curly-quoted intent spans into fixedCopy', () => {
    const merged = mergeBriefValues(
      { intent: '' },
      {
        intent:
          'a coffee ad with "Join now" and “Brew Better” and the tagline \'COFFEE, PERFECTED\'',
      },
      'intent'
    );
    expect(merged.fixedCopy).toBe(
      'Join now | Brew Better | COFFEE, PERFECTED'
    );
  });

  it('dedupes quoted spans the existing fixedCopy already carries', () => {
    const merged = mergeBriefValues(
      { intent: '', fixedCopy: 'use code BEAN30' },
      { intent: 'a promo with "BEAN30" and "Free shipping" and "BEAN30" again' },
      'intent'
    );
    // BEAN30 is contained in the existing fixedCopy (and quoted twice) —
    // only the genuinely new span is appended, once.
    expect(merged.fixedCopy).toBe('use code BEAN30 | Free shipping');
  });

  it('never extracts apostrophe usage as a quoted span', () => {
    const merged = mergeBriefValues(
      { intent: '' },
      { intent: "don't miss it, it's tonight and that's final" },
      'intent'
    );
    expect(merged.fixedCopy).toBeUndefined();
  });

  it('extracts quoted spans after spoken-URL normalization', () => {
    const merged = mergeBriefValues(
      { intent: '' },
      { intent: "launch post — visit 'northbean dot shop' tonight" },
      'intent'
    );
    expect(merged.intent).toBe("launch post — visit 'northbean.shop' tonight");
    expect(merged.fixedCopy).toBe('northbean.shop');
  });

  // ── Quoted spans from a LATER turn (the raw-message source) ──

  it('extracts quoted spans from a later turn\'s raw message', () => {
    // Turn 1 set the intent; turn 2 answers a question and adds the fine print
    // and a badge. Scanning the (pinned) intent alone re-reads turn 1 forever,
    // so neither string ever reached the brief.
    const merged = mergeBriefValues(
      { intent: 'a September reopening announcement' },
      { audience: 'local customers' },
      'audience',
      'our regulars — put \'Times shown in local time; terms apply\' at the bottom and a badge saying "From Sep 1"'
    );
    // Unit ORDER follows the quote-kind scan order (double before single), the
    // pre-existing extractor behaviour — what matters is that both survived.
    expect(merged.fixedCopy).toBe(
      'From Sep 1 | Times shown in local time; terms apply'
    );
  });

  it('keeps the intent pinned when a raw message is supplied', () => {
    const merged = mergeBriefValues(
      { intent: 'a September reopening announcement' },
      { tone: 'warm' },
      'tone',
      'yes, looks good — and add "Open from 8am"'
    );
    // The raw text is a quoted-span SOURCE only. Round 5 pinned the intent on
    // purpose: a "yes" turn must never become the brief.
    expect(merged.intent).toBe('a September reopening announcement');
    expect(merged.fixedCopy).toBe('Open from 8am');
  });

  it('never lets an unquoted greeting become the brief or the copy', () => {
    const merged = mergeBriefValues(
      { intent: 'a September reopening announcement' },
      {},
      undefined,
      'hi there, thanks!'
    );
    expect(merged.intent).toBe('a September reopening announcement');
    expect(merged.fixedCopy).toBeUndefined();
  });

  it('normalizes spoken URLs inside a raw-message span', () => {
    const merged = mergeBriefValues(
      { intent: 'a launch post' },
      {},
      undefined,
      'also say "visit northbean dot shop"'
    );
    expect(merged.fixedCopy).toBe('visit northbean.shop');
  });

  it('does not re-append an intent span the fixedCopy already carries', () => {
    const merged = mergeBriefValues(
      { intent: 'a promo that says "Join now"', fixedCopy: 'Join now' },
      {},
      undefined,
      'and add "BEAN30"'
    );
    expect(merged.fixedCopy).toBe('Join now | BEAN30');
  });
});
