import { describe, it, expect } from 'vitest';
import { fitTextToBox, measureLineWidth, wrapTextLines } from './fit-text';
import { DesignerDocStrictSchema, DesignerDocLenientSchema } from './designer-doc.schema';

/**
 * `textScaleX` is Photoshop's Horizontal Scale, added because no font in the
 * catalog is narrow enough for some lockups and the document model has no
 * scaleX to fall back on.
 *
 * The semantics are decided in ONE place — `measureLineWidth` — so the canvas,
 * the raster export and the server renderer cannot disagree about whether
 * condensing also condenses the tracking. It does.
 */

/** Deterministic: every glyph is half an em wide. */
const measure = (text: string, size: number) => text.length * size * 0.5;

const doc = (element: Record<string, unknown>) => ({
  version: 4,
  mode: 'image',
  outputs: [
    {
      id: 'out-1',
      formatId: 'square',
      name: 'Square',
      width: 100,
      height: 100,
      background: '#ffffff',
      children: [
        {
          id: 'a',
          type: 'text',
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          text: 'Hello',
          ...element,
        },
      ],
    },
  ],
});

describe('measureLineWidth with a horizontal scale', () => {
  it('condenses the line', () => {
    expect(measureLineWidth('abcd', 10, 0, measure, 0.5)).toBe(
      measureLineWidth('abcd', 10, 0, measure) * 0.5
    );
  });

  it('condenses the tracking along with the glyphs', () => {
    // The alternative — tracking in unscaled px — would make condensed text
    // look loosely spaced, and would put the two renderers at risk of
    // disagreeing about which space the spacing lives in.
    const tracked = measureLineWidth('abcd', 10, 4, measure);
    expect(measureLineWidth('abcd', 10, 4, measure, 0.5)).toBe(tracked * 0.5);
  });

  it('defaults to unscaled', () => {
    expect(measureLineWidth('abcd', 10, 2, measure, 1)).toBe(
      measureLineWidth('abcd', 10, 2, measure)
    );
  });
});

describe('wrapping condensed text', () => {
  it('fits more per line, because the glyphs are narrower', () => {
    const text = 'aaaa bbbb cccc';
    const plain = wrapTextLines(text, 40, 10, 0, measure);
    const condensed = wrapTextLines(text, 40, 10, 0, measure, 0.5);
    expect(condensed.length).toBeLessThan(plain.length);
  });

  it('shrink-to-fit accounts for the scale', () => {
    // Same box, same authored size: unscaled has to shrink, condensed doesn't.
    const box = { text: 'aaaa bbbb cccc dddd', width: 40, height: 24, fontSize: 10 };
    const plain = fitTextToBox(box, measure);
    const condensed = fitTextToBox({ ...box, scaleX: 0.5 }, measure);
    expect(condensed.fontSize).toBeGreaterThan(plain.fontSize);
  });
});

describe('textScaleX on the document schema', () => {
  it('round-trips through the strict parser', () => {
    const parsed = DesignerDocStrictSchema.parse(doc({ textScaleX: 0.6 }));
    expect(parsed.outputs[0].children[0].textScaleX).toBe(0.6);
  });

  it('round-trips through the lenient parser', () => {
    const parsed = DesignerDocLenientSchema.parse(doc({ textScaleX: 0.6 }));
    expect(parsed.outputs[0].children[0].textScaleX).toBe(0.6);
  });

  it('rejects a scale outside the usable range in strict mode', () => {
    expect(() => DesignerDocStrictSchema.parse(doc({ textScaleX: 0 }))).toThrow();
    expect(() => DesignerDocStrictSchema.parse(doc({ textScaleX: 99 }))).toThrow();
  });

  it('is optional — an untouched document never carries it', () => {
    const parsed = DesignerDocStrictSchema.parse(doc({}));
    expect(parsed.outputs[0].children[0].textScaleX).toBeUndefined();
  });
});
