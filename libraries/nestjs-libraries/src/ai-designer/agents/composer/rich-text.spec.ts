import { describe, it, expect } from 'vitest';
import { emphasise, emphasisTokens } from './rich-text';

const style = { fontWeight: 900, fill: '#ff5a36' };

describe('emphasise', () => {
  it('sets the offer apart from the words around it', () => {
    const runs = emphasise('Half price this week', ['Half price'], style)!;
    expect(runs.map((r) => r.text)).toEqual(['Half price', ' this week']);
    expect(runs[0].fontWeight).toBe(900);
    expect(runs[1].fontWeight).toBeUndefined();
  });

  it('keeps the headline′s own casing, not the token′s', () => {
    // A preset with `headlineTransform: 'uppercase'` has already decided the
    // case; substituting the token would undo it mid-line.
    const runs = emphasise('HALF PRICE THIS WEEK', ['half price'], style)!;
    expect(runs[0].text).toBe('HALF PRICE');
  });

  it('emphasises every occurrence', () => {
    const runs = emphasise('Free coffee, free cake', ['free'], style)!;
    expect(runs.filter((r) => r.fontWeight).map((r) => r.text)).toEqual(['Free', 'free']);
  });

  it('prefers the more specific token when two overlap', () => {
    // "40% off" is the offer; "40%" alone is half of it.
    const runs = emphasise('Get 40% off today', ['40%', '40% off'], style)!;
    expect(runs.find((r) => r.fontWeight)!.text).toBe('40% off');
  });

  it('handles a token at the very start and the very end', () => {
    expect(emphasise('Free delivery', ['Free'], style)!.map((r) => r.text)).toEqual([
      'Free',
      ' delivery',
    ]);
    expect(emphasise('Delivery free', ['free'], style)!.map((r) => r.text)).toEqual([
      'Delivery ',
      'free',
    ]);
  });

  it('returns null when nothing matched, so the caller keeps a plain string', () => {
    // `_clampTextToFit` skips any element carrying `richText`, so a pointless
    // single-run one would silently opt the headline out of overflow correction.
    expect(emphasise('Nothing to see', ['40%'], style)).toBeNull();
  });

  it('returns null when EVERY run would be emphasised', () => {
    // The contrast is what carries the meaning; a headline entirely in the
    // accent has no emphasis at all.
    expect(emphasise('Free', ['Free'], style)).toBeNull();
  });

  it('returns null when there is no emphasis to apply', () => {
    expect(emphasise('Half price this week', ['Half price'], {})).toBeNull();
  });

  it('ignores empty and one-character tokens', () => {
    expect(emphasise('Half price', ['', ' ', 'a'], style)).toBeNull();
  });

  it('treats a token with regex characters as literal text', () => {
    // "$19.99" is full of metacharacters; unescaped it would match almost
    // anything, or throw.
    const runs = emphasise('Only $19.99 today', ['$19.99'], style)!;
    expect(runs.find((r) => r.fontWeight)!.text).toBe('$19.99');
  });

  it('handles empty copy', () => {
    expect(emphasise('', ['free'], style)).toBeNull();
    expect(emphasise('   ', ['free'], style)).toBeNull();
  });
});

describe('emphasisTokens', () => {
  it('finds the promotional figure a headline exists for', () => {
    expect(emphasisTokens('Get 40% off everything')).toEqual(['40% off']);
    expect(emphasisTokens('Now only £20')).toEqual(['£20']);
    // The token keeps the headline's own casing — it is matched FROM the
    // headline, so it can be handed straight back to `emphasise`.
    expect(emphasisTokens('Half price this week')).toEqual(['Half price']);
  });

  it('finds multi-buy offers', () => {
    expect(emphasisTokens('2 for 1 on all bags')).toEqual(['2 for 1']);
  });

  it('returns at most one, because two emphases are none', () => {
    expect(emphasisTokens('Free delivery and 40% off').length).toBe(1);
  });

  it('finds nothing in an ordinary headline', () => {
    // Emphasising an arbitrary word is decoration, not hierarchy.
    expect(emphasisTokens('Our new autumn collection')).toEqual([]);
  });

  it('prefers the longest match', () => {
    expect(emphasisTokens('Save 40% off now')[0]).toBe('40% off');
  });
});
