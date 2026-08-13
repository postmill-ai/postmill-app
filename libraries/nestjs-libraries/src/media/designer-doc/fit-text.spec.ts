import { describe, it, expect } from 'vitest';
import {
  applyTextTransform,
  fitTextToBox,
  wrapTextLines,
  type MeasureText,
} from './fit-text';

/**
 * The shared text fitter had no spec of its own — it was only ever exercised
 * through the renderers, which is why the case transform had to land HERE
 * rather than in either of them: uppercasing changes how wide every word is, so
 * a transform applied at paint time wraps at the wrong words.
 */

/** Fixed-width glyphs, so every measurement in here is exact. */
const measure: MeasureText = (text, size) => text.length * size * 0.5;

describe('applyTextTransform', () => {
  it('leaves text alone by default', () => {
    expect(applyTextTransform('Hello there', undefined)).toBe('Hello there');
    expect(applyTextTransform('Hello there', 'none')).toBe('Hello there');
  });

  it('upper- and lower-cases', () => {
    expect(applyTextTransform('Hello', 'uppercase')).toBe('HELLO');
    expect(applyTextTransform('Hello', 'lowercase')).toBe('hello');
  });

  it('capitalizes first letters only, so an intentional iPhone survives', () => {
    expect(applyTextTransform('the new iPhone', 'capitalize')).toBe('The New IPhone');
    // (The `I` is unavoidable — only the first letter is touched, and the rest
    // of the word is left exactly as typed.)
    expect(applyTextTransform('all caps HERE', 'capitalize')).toBe('All Caps HERE');
  });
});

describe('fitTextToBox with a case transform', () => {
  it('wraps the TRANSFORMED text, which is the whole reason it lives here', () => {
    const box = {
      text: 'iiii iiii',
      width: 60,
      height: 500,
      fontSize: 20,
    };
    // Untransformed: 'iiii iiii' is 9 chars * 10px = 90 > 60, so it breaks once.
    const plain = fitTextToBox(box, measure);
    const upper = fitTextToBox({ ...box, textTransform: 'uppercase' }, measure);
    expect(plain.lines).toEqual(['iiii', 'iiii']);
    // The transform is applied before measuring, so the LINES carry it too —
    // a renderer that uppercased at paint time would draw different content
    // from what it measured.
    expect(upper.lines).toEqual(['IIII', 'IIII']);
  });
});

describe('paragraph spacing and first-line indent', () => {
  const base = {
    text: 'aa\nbb\ncc',
    width: 200,
    height: 500,
    fontSize: 20,
  };

  it('is all zeroes when unset, so nothing changes for existing documents', () => {
    const fitted = fitTextToBox(base, measure);
    expect(fitted.lines).toEqual(['aa', 'bb', 'cc']);
    expect(fitted.lineGaps).toEqual([0, 0, 0]);
    expect(fitted.lineIndents).toEqual([0, 0, 0]);
  });

  it('spaces every paragraph but the first', () => {
    const fitted = fitTextToBox({ ...base, paragraphSpacing: 12 }, measure);
    expect(fitted.lineGaps).toEqual([0, 12, 12]);
  });

  it('indents the first line of each paragraph only', () => {
    const fitted = fitTextToBox(
      { ...base, text: 'aaaa aaaa aaaa\nbb', width: 60, firstLineIndent: 10 },
      measure
    );
    // Three wrapped lines from the first paragraph, then the second.
    expect(fitted.lineIndents[0]).toBe(10);
    expect(fitted.lineIndents[1]).toBe(0);
    expect(fitted.lineIndents[fitted.lineIndents.length - 1]).toBe(10);
  });

  it('counts the gaps when deciding whether to shrink', () => {
    // Three lines at 20px * 1.2 = 72px, which fits 80px — until 30px of
    // paragraph spacing pushes the block to 132px.
    const tight = { ...base, height: 80 };
    expect(fitTextToBox(tight, measure).fontSize).toBe(20);
    expect(fitTextToBox({ ...tight, paragraphSpacing: 30 }, measure).fontSize).toBeLessThan(20);
  });

  it('narrows the wrap box by the indent', () => {
    const wide = wrapTextLines('aaaa aaaa', 60, 20, 0, measure);
    const indented = fitTextToBox(
      { text: 'aaaa aaaa', width: 60, height: 500, fontSize: 20, firstLineIndent: 20 },
      measure
    );
    expect(wide).toEqual(['aaaa', 'aaaa']);
    // 60 - 20 = 40px of measure: 'aaaa' is exactly 40, so it still fits alone.
    expect(indented.lines).toEqual(['aaaa', 'aaaa']);
  });
});
