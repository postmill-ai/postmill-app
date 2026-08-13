import { describe, expect, it } from 'vitest';
import { matchSlotTexts, normalizeSlotText } from './slot-keys';

const SLOTS = [
  { id: 'headline', role: 'headline' },
  { id: 'cta', role: 'cta' },
  { id: 'badge', role: 'badge' },
];

describe('matchSlotTexts', () => {
  it('matches exact slot ids first', () => {
    const out = matchSlotTexts(
      { headline: 'Exact', HEADLINE: 'Case Variant' },
      [{ id: 'headline', role: 'headline' }]
    );
    expect(out).toEqual({ headline: 'Exact' });
  });

  it('falls back to case-insensitive id matching', () => {
    const out = matchSlotTexts({ Headline: 'Big Sale' }, [
      { id: 'headline', role: 'headline' },
    ]);
    expect(out).toEqual({ headline: 'Big Sale' });
  });

  it('falls back to role matching when the id does not match', () => {
    const out = matchSlotTexts(
      { 'primary-headline': 'Role Keyed', cta: 'Shop now' },
      [{ id: 'headline-1', role: 'headline' }, { id: 'cta', role: 'cta' }]
    );
    expect(out).toEqual({ 'headline-1': 'Role Keyed', cta: 'Shop now' });
  });

  it('prefers exact over role matches across slots', () => {
    const out = matchSlotTexts(
      { headline: 'By Id', badge: 'BADGE COPY' },
      SLOTS
    );
    expect(out.headline).toBe('By Id');
    expect(out.badge).toBe('BADGE COPY');
    expect(out.cta).toBeUndefined();
  });

  it('skips empty and non-string values', () => {
    const out = matchSlotTexts(
      { headline: '   ', cta: 42 as unknown as string },
      [{ id: 'headline', role: 'headline' }, { id: 'cta', role: 'cta' }]
    );
    expect(out).toEqual({});
  });
});

describe('normalizeSlotText', () => {
  it('replaces the machine " | " separator with a render-safe bullet', () => {
    expect(normalizeSlotText('Join now | 30% off | BEAN30')).toBe(
      'Join now • 30% off • BEAN30'
    );
  });

  it('normalizes pipes regardless of surrounding whitespace', () => {
    expect(normalizeSlotText('Join now|BEAN30')).toBe('Join now • BEAN30');
    expect(normalizeSlotText('Join now   |   BEAN30')).toBe(
      'Join now • BEAN30'
    );
  });

  it('is idempotent', () => {
    const once = normalizeSlotText('Join now | BEAN30');
    expect(normalizeSlotText(once)).toBe(once);
  });

  it('is a no-op for pipe-free text', () => {
    expect(normalizeSlotText('COFFEE, PERFECTED')).toBe('COFFEE, PERFECTED');
    expect(normalizeSlotText('Save 30% • today')).toBe('Save 30% • today');
  });
});
