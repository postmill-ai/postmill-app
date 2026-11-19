import { describe, it, expect } from 'vitest';
import {
  applyTextTransform,
  fitTextToBox,
  fitRichTextToBox,
  justifyLineWords,
  layoutRichText,
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

describe('paragraphStarts', () => {
  it('marks paragraph-first lines even with no spacing or indent set', () => {
    const fitted = fitTextToBox(
      { text: 'aaaa aaaa\nbb', width: 60, height: 500, fontSize: 20 },
      measure
    );
    // 'aaaa aaaa' wraps to two lines at 40px measure each, then 'bb'.
    expect(fitted.lines).toEqual(['aaaa', 'aaaa', 'bb']);
    expect(fitted.paragraphStarts).toEqual([true, false, true]);
  });
});

describe('opt-in auto-fit', () => {
  it('preserves the legacy height-only floor when autoFit is absent', () => {
    const fitted = fitTextToBox(
      { text: 'aaaa aaaa aaaa', width: 40, height: 24, fontSize: 20 },
      measure
    );
    expect(fitted.fontSize).toBe(12);
  });

  it('paints the authored size without shrinking when explicitly off', () => {
    const fitted = fitTextToBox(
      { text: 'aaaa aaaa aaaa', width: 40, height: 24, fontSize: 20, autoFit: false },
      measure
    );
    expect(fitted.fontSize).toBe(20);
    expect(fitted.lines).toHaveLength(3);
  });

  it('shrinks a long unbroken word to the box width without splitting it', () => {
    const fitted = fitTextToBox(
      {
        text: 'internationalization', width: 50, height: 100, fontSize: 20,
        autoFit: true, minFontSize: 1,
      },
      measure
    );
    expect(fitted.lines).toEqual(['internationalization']);
    expect(fitted.fontSize).toBeLessThanOrEqual(5);
  });

  it('fits wrapping in both dimensions and respects the minimum', () => {
    const box = {
      text: 'aaaa aaaa aaaa aaaa',
      width: 90,
      height: 40,
      fontSize: 20,
      autoFit: true,
      minFontSize: 14,
    };
    const fitted = fitTextToBox(box, measure);
    expect(fitted.fontSize).toBe(16);
    expect(fitted.lines.every((line) => measure(line, fitted.fontSize) <= box.width)).toBe(true);
    expect(fitted.lines.length * fitted.lineHeight).toBeLessThanOrEqual(box.height);

    const impossible = fitTextToBox({ ...box, height: 10, minFontSize: 18 }, measure);
    expect(impossible.fontSize).toBe(18);
    expect(impossible.lines.length * impossible.lineHeight).toBeGreaterThan(box.height);
  });

  it('uses the 8px default rather than the legacy 60% floor', () => {
    expect(
      fitTextToBox(
        {
          text: 'internationalization',
          width: 50,
          height: 100,
          fontSize: 20,
          autoFit: true,
        },
        measure
      ).fontSize
    ).toBe(8);
  });

  it.each([undefined, 12])(
    'never grows text smaller than the requested minimum (%s)',
    (minFontSize) => {
      expect(
        fitTextToBox(
          {
            text: 'tiny',
            width: 1,
            height: 1,
            fontSize: 4,
            autoFit: true,
            minFontSize,
          },
          measure
        ).fontSize
      ).toBe(4);
    }
  );
});

describe('rich text auto-fit', () => {
  const runs = [
    { text: 'social ', fontWeight: 400 },
    { text: 'media managers', fontWeight: 700, fontSize: 40 },
  ];

  it('lays out mixed runs with their own widths and line heights', () => {
    const layout = layoutRichText(
      runs,
      { width: 200, fontSize: 20, lineHeight: 1.2, align: 'left' },
      (text, run) => text.length * run.fontSize * 0.5
    );
    expect(layout.segments.map((seg) => seg.text)).toEqual(['social ', 'media ', 'managers']);
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[1].height).toBe(48);
  });

  it('scales every run proportionally without mutating authored runs', () => {
    const authored = runs.map((run) => ({ ...run }));
    const fitted = fitRichTextToBox(
      { text: '', width: 150, height: 60, fontSize: 20, autoFit: true },
      runs,
      (text, run) => text.length * run.fontSize * 0.5
    );
    expect(fitted.fits).toBe(true);
    expect(fitted.fontSize).toBeLessThan(20);
    expect(fitted.runs[1].fontSize).toBe(fitted.runs[0].fontSize * 2);
    expect(runs).toEqual(authored);
  });

  it('keeps authored rich-run sizes when auto-fit is explicitly off', () => {
    const fitted = fitRichTextToBox(
      { text: '', width: 30, height: 20, fontSize: 20, autoFit: false },
      [{ text: 'unbreakable', fontSize: 40 }],
      (text, run) => text.length * run.fontSize * 0.5
    );
    expect(fitted.fontSize).toBe(20);
    expect(fitted.runs[0].fontSize).toBe(40);
    expect(fitted.fits).toBe(false);
  });

  it('honours the minimum and paragraph alignment', () => {
    const fitted = fitRichTextToBox(
      {
        text: '',
        width: 30,
        height: 20,
        fontSize: 20,
        minFontSize: 18,
        autoFit: true,
        align: 'center',
      },
      [{ text: 'unbreakable' }],
      (text, run) => text.length * run.fontSize * 0.5
    );
    expect(fitted.fontSize).toBe(18);
    expect(fitted.fits).toBe(false);
    expect(fitted.segments[0].x).toBe((30 - fitted.segments[0].width) / 2);
  });

  it('never grows a small run to the fitting floor', () => {
    const fitted = fitRichTextToBox(
      {
        text: '',
        width: 30,
        height: 20,
        fontSize: 40,
        minFontSize: 30,
        autoFit: true,
      },
      [{ text: 'x', fontSize: 4 }, { text: 'unbreakable', fontSize: 40 }],
      (text, run) => text.length * run.fontSize * 0.5
    );

    expect(fitted.fontSize).toBe(30);
    expect(fitted.runs[0].fontSize).toBe(4);
  });

  it('leaves a justified paragraph last line at natural spacing', () => {
    const layout = layoutRichText(
      [{ text: 'aa bb cc' }],
      { width: 100, fontSize: 20, align: 'justify' },
      (text, run) => text.length * run.fontSize * 0.5
    );

    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0].endsParagraph).toBe(true);
    expect(layout.segments.map((segment) => segment.x)).toEqual([0, 30, 60]);
  });
});

describe('justifyLineWords', () => {
  it('distributes the slack evenly into the gaps BETWEEN words', () => {
    // 'aaaa bbbb cccc' at 0.5em glyphs: 14 chars * 10 = 140 natural, in a
    // 200px line — 60px of slack over two gaps = 30px each.
    const words = justifyLineWords('aaaa bbbb cccc', 200, 20, 0, measure)!;
    expect(words.map((w) => w.text)).toEqual(['aaaa', 'bbbb', 'cccc']);
    expect(words[0].x).toBe(0);
    // word (40) + space (10) + gap (30)
    expect(words[1].x).toBe(80);
    expect(words[2].x).toBe(160);
    // The last word ends flush with the target width.
    expect(words[2].x + 40).toBe(200);
  });

  it('returns null when there is no slack or fewer than two words', () => {
    expect(justifyLineWords('aaaa', 200, 20, 0, measure)).toBeNull();
    // 24 chars * 10px = 240 natural — wider than the line, so nothing to spread.
    expect(justifyLineWords('aaaa bbbb cccc dddd eeee', 200, 20, 0, measure)).toBeNull();
  });

  it('honours letterSpacing and scaleX in the measurement', () => {
    // letterSpacing 2: each char carries +2, so 'aaaa bbbb' measures
    // (4+1+4) chars * 10 + 9 * 2 = 108; slack 200 - 108 = 92 in one gap.
    const words = justifyLineWords('aaaa bbbb', 200, 20, 2, measure)!;
    expect(words[1].x).toBe(40 + 8 + 10 + 2 + 92);
    // scaleX 0.5: everything measures half, and the slack is against the
    // SCALED width — 200 - 45 = 155 in the single gap.
    const condensed = justifyLineWords('aaaa bbbb', 200, 20, 0, measure, 0.5)!;
    expect(condensed[1].x).toBe((40 + 10) * 0.5 + (200 - 45));
  });
});
