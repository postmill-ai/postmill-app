import { describe, it, expect, vi } from 'vitest';
import { buildTextElementPatch, growBoxFor } from './text-format-panel';
import type { DesignerElement, TextRun } from '../designer.store';
import type { MeasureText } from '@postmill-ai/nestjs-libraries/media/designer-doc/fit-text';

vi.mock('../fonts', () => ({
  DESIGNER_FONTS: [],
  ensureFontLoaded: () => Promise.resolve(),
}));

// The no-measure branch only exists where no canvas backend does, and this
// jsdom build HAS one — so the module's own measure has to be mocked away to
// see it.
vi.mock('../measure-text', () => ({
  fittedFontSize: (el: { fontSize?: number }) => el.fontSize ?? 16,
  measureForElement: () => undefined,
}));

/** Fixed-width glyphs (0.5em), so every measurement below is exact. */
const measure: MeasureText = (text, size) => text.length * size * 0.5;

const baseText = (over: Partial<DesignerElement> = {}): DesignerElement =>
  ({
    id: 't1',
    type: 'text',
    x: 0,
    y: 0,
    width: 100,
    height: 24,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: 'hello world',
    fontSize: 16,
    fontFamily: 'Inter',
    fill: '#000000',
    ...over,
  } as DesignerElement);

describe('growBoxFor', () => {
  it('wraps at the REQUESTED size, not the current one', () => {
    // At the current 16px, 'hello world' measures 88px — one line. At the
    // requested 40px it measures 220px and wraps to two: the box has to grow
    // for the two-line wrap or the fitter shrinks the font right back.
    const patch = growBoxFor(baseText(), 40, measure);
    expect(patch.height).toBe(Math.ceil(2 * 1.2 * 40));
  });

  it('never shrinks the box', () => {
    const patch = growBoxFor(baseText({ height: 200 }), 16, measure);
    expect(patch.height).toBeUndefined();
    expect(patch.width).toBeUndefined();
  });

  it('grows the width when a single unwrapped word overflows', () => {
    // One 20-char word at 40px: 400px wide, and a word is never split, so
    // height alone could never make the size honest.
    const patch = growBoxFor(
      baseText({ text: 'supercalifragilistic' }),
      40,
      measure
    );
    expect(patch.width).toBe(400);
    expect(patch.height).toBe(Math.ceil(1.2 * 40));
  });

  it('counts paragraph spacing in the required height', () => {
    const patch = growBoxFor(
      baseText({ text: 'aa\nbb', paragraphSpacing: 10 }),
      20,
      measure
    );
    expect(patch.height).toBe(Math.ceil(2 * 1.2 * 20) + 10);
  });

  it('leaves rich, curved and on-path text alone — they render the authored size', () => {
    expect(
      growBoxFor(
        baseText({ richText: [{ text: 'hello world' } as TextRun] }),
        40,
        measure
      )
    ).toEqual({});
    expect(growBoxFor(baseText({ curve: 30 }), 40, measure)).toEqual({});
    expect(growBoxFor(baseText({ textPath: 'M 0,0 L 10,10' }), 40, measure)).toEqual(
      {}
    );
  });

  it('returns nothing for non-text elements or without a measure', () => {
    expect(growBoxFor(null, 40, measure)).toEqual({});
    expect(
      growBoxFor({ ...baseText(), type: 'shape' } as DesignerElement, 40, measure)
    ).toEqual({});
    // jsdom has no canvas backend, so the panel's own measure is unavailable —
    // the box is left exactly as authored rather than grown on a guess.
    expect(growBoxFor(baseText(), 40)).toEqual({});
  });
});

describe('buildTextElementPatch', () => {
  const richEl = () =>
    baseText({
      richText: [{ text: 'hello' } as TextRun],
    });

  it('writes run styles to the element too when the change covers the whole text', () => {
    const patch = buildTextElementPatch(richEl(), { fontFamily: 'Georgia' }, null);
    // The picker label, run fallbacks, newly typed chars and curved text all
    // read the ELEMENT-level style — writing only the runs left it at 'Inter'.
    expect(patch.fontFamily).toBe('Georgia');
    expect(patch.richText).toEqual([{ text: 'hello', fontFamily: 'Georgia' }]);
  });

  it('keeps a genuine sub-selection run-level only', () => {
    const patch = buildTextElementPatch(
      richEl(),
      { fontFamily: 'Georgia' },
      { start: 0, end: 2 }
    );
    expect(patch.fontFamily).toBeUndefined();
    expect(patch.richText).toEqual([
      { text: 'he', fontFamily: 'Georgia' },
      { text: 'llo' },
    ]);
  });

  it('applies run styles straight to the element when it has no runs', () => {
    const patch = buildTextElementPatch(
      baseText(),
      { fontFamily: 'Georgia', fontWeight: 700 },
      null
    );
    expect(patch.fontFamily).toBe('Georgia');
    expect(patch.fontWeight).toBe(700);
    expect(patch.richText).toBeUndefined();
  });

  it('passes element-level keys through alongside the run split', () => {
    const patch = buildTextElementPatch(
      richEl(),
      { fontSize: 30, align: 'center' },
      null
    );
    expect(patch.align).toBe('center');
    expect(patch.fontSize).toBe(30);
    expect(patch.richText?.[0].fontSize).toBe(30);
  });

  it('touches nothing when the update has no run-style keys', () => {
    const patch = buildTextElementPatch(richEl(), { lineHeight: 1.5 }, null);
    expect(patch).toEqual({ lineHeight: 1.5 });
  });
});
