import { describe, expect, it } from 'vitest';
import { createCanvas } from 'canvas';
import { applyTextReveal } from './text-reveal';
import { drawVideoText, layoutVideoText } from './video-text-layout';

const tenPx = (text: string) => [...text].length * 10;

describe('layoutVideoText', () => {
  it('wraps at word boundaries like Konva', () => {
    expect(layoutVideoText('one two three', 65, 100, 10, tenPx)).toEqual([
      { text: 'one', width: 30, lastInParagraph: false },
      { text: 'two', width: 30, lastInParagraph: false },
      { text: 'three', width: 50, lastInParagraph: true },
    ]);
  });

  it('splits long tokens and clips overflow lines to the box', () => {
    expect(layoutVideoText('abcdefgh', 40, 15, 10, tenPx)).toEqual([
      { text: 'abcd', width: 40, lastInParagraph: true },
    ]);
  });

  it('preserves explicit empty paragraphs', () => {
    expect(layoutVideoText('a\n\nb', 100, 30, 10, tenPx).map((line) => line.text)).toEqual([
      'a',
      '',
      'b',
    ]);
  });
});

describe('drawVideoText', () => {
  it('aligns left, center and right against measured line widths', () => {
    for (const [align, expectedX] of [['left', 0], ['center', 15], ['right', 30]] as const) {
      const calls: { text: string; x: number; y: number }[] = [];
      const ctx = {
        font: '',
        fillStyle: '',
        textBaseline: '',
        textAlign: '',
        measureText: (text: string) => ({ width: tenPx(text) }),
        fillText: (text: string, x: number, y: number) => calls.push({ text, x, y }),
      };
      drawVideoText(ctx, { text: 'ab', width: 50, height: 10, fontSize: 10, align });
      expect(calls).toEqual([{ text: 'ab', x: expectedX, y: 5 }]);
    }
  });

  it('justifies non-final lines with word offsets, leaving paragraph-final lines alone', () => {
    const calls: { text: string; x: number; y: number }[] = [];
    const ctx = {
      font: '',
      fillStyle: '',
      textBaseline: '',
      textAlign: '',
      measureText: (text: string) => ({ width: tenPx(text) }),
      fillText: (text: string, x: number, y: number) => calls.push({ text, x, y }),
    };
    drawVideoText(ctx, {
      text: 'a b c\nx y',
      width: 40,
      height: 30,
      fontSize: 10,
      align: 'justify',
    });
    expect(calls).toEqual([
      { text: 'a', x: 0, y: 5 },
      { text: ' ', x: 20, y: 5 },
      { text: 'b', x: 30, y: 5 },
      { text: 'c', x: 0, y: 15 },
      { text: 'x y', x: 0, y: 25 },
    ]);
  });

  it('lays out the revealed prefix independently at each typewriter frame', () => {
    const text = 'ab cd';
    const revealed = applyTextReveal(text, { mode: 'chars', durationMs: 1000 }, 500, 1000);
    expect(revealed).toBe('ab ');
    expect(layoutVideoText(revealed, 45, 20, 10, tenPx).map((line) => line.text)).toEqual(['ab ']);
  });

  it.each([1, 2])('paints multiline and long-token text without export clipping at %sx', (scale) => {
    const canvas = createCanvas(120 * scale, 50 * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 120, 50);
    drawVideoText(ctx as never, {
      text: 'First line\nABCDEFGHIJKL',
      width: 120,
      height: 50,
      fontSize: 20,
      fontFamily: 'Custom Test Sans',
      fontWeight: 700,
      fill: '#000000',
      align: 'left',
    });

    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let darkPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < 100 && pixels[i + 3] > 0) darkPixels++;
    }
    expect(darkPixels).toBeGreaterThan(50 * scale * scale);
  });
});
