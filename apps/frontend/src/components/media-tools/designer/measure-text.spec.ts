import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DesignerElement } from './designer.store';
import {
  defaultTextBox,
  fitDesignerRichText,
  fitDesignerText,
  fittedFontSize,
} from './measure-text';

const context = {
  font: '',
  measureText: (text: string) => ({
    width: text.length * Number(/([\d.]+)px/.exec(context.font)?.[1] ?? 16) * 0.5,
  }),
};

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => context as unknown as CanvasRenderingContext2D
  );
});

afterAll(() => {
  vi.restoreAllMocks();
});

const textElement = (overrides: Partial<DesignerElement> = {}): DesignerElement =>
  ({
    id: 'text',
    type: 'text',
    x: 0,
    y: 0,
    width: 50,
    height: 100,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: 'internationalization',
    fontSize: 20,
    fontFamily: 'Inter',
    fill: '#000000',
    ...overrides,
  } as DesignerElement);

describe('canvas text measurement', () => {
  it('uses auto-fit and its minimum for flat text', () => {
    const legacy = fitDesignerText(textElement());
    const fitted = fitDesignerText(
      textElement({ autoFit: true, autoFitMinFontSize: 6 })
    );

    expect(legacy?.fontSize).toBe(20);
    expect(fitted?.fontSize).toBe(6);
    expect(fitted?.lines).toEqual(['internationalization']);
  });

  it('uses bounded rich layout for the painted font size', () => {
    const element = textElement({
      text: '',
      width: 80,
      richText: [
        { text: 'social ', fontWeight: 400 },
        { text: 'internationalization', fontWeight: 700, fontSize: 40 },
      ],
      autoFit: true,
      autoFitMinFontSize: 1,
    });
    const fitted = fitDesignerRichText(element);

    expect(fitted).not.toBeNull();
    expect(fitted?.fontSize).toBeLessThan(20);
    expect(fitted?.runs[1].fontWeight).toBe(700);
    expect(fittedFontSize(element)).toBe(fitted?.fontSize);
  });

  it('scales new-text padding independently of glyph measurement', () => {
    const spec = { text: 'Text', fontSize: 20 };

    expect(defaultTextBox(spec)).toEqual({ width: 56, height: 24 });
    expect(defaultTextBox({ ...spec, paddingScale: 2 })).toEqual({
      width: 72,
      height: 24,
    });
  });
});
