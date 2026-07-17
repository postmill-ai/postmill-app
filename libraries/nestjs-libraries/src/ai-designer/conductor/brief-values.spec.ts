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
      skillId: 'meme',
      pendingReviseTarget: 'design-1',
      questionsAsked: ['q1'],
      referenceCues: ['cue'],
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
});
