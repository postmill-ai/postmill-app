import { describe, it, expect } from 'vitest';
import {
  resolveSelectableId,
  resolveTextEditTarget,
  symbolTextCommit,
  symbolFillCommit,
  refitSymbolToText,
} from './symbol-edit';
import type { DesignerElement, DesignerOutput } from './designer.store';
import type { SymbolDefinition } from '@postmill-ai/nestjs-libraries/media/designer-doc/symbols';

const definition: SymbolDefinition = {
  id: 'lockup-cta',
  name: 'CTA lockup',
  width: 200,
  height: 60,
  children: [
    {
      id: 'plate',
      type: 'shape',
      x: 0,
      y: 0,
      width: 200,
      height: 60,
    } as unknown as DesignerElement,
    {
      id: 'label',
      type: 'text',
      x: 10,
      y: 15,
      width: 180,
      height: 30,
      text: 'Shop now',
      fontSize: 20,
    } as unknown as DesignerElement,
  ],
};

const instance = {
  id: 'cta-1',
  type: 'symbol',
  symbolId: 'lockup-cta',
  x: 100,
  y: 400,
  width: 200,
  height: 60,
} as unknown as DesignerElement;

const plainText = {
  id: 'headline',
  type: 'text',
  x: 0,
  y: 0,
  width: 300,
  height: 50,
  text: 'Hello',
} as unknown as DesignerElement;

const output = { children: [instance, plainText] } as unknown as Pick<
  DesignerOutput,
  'children'
>;

describe('resolveSelectableId', () => {
  it('passes through real element ids', () => {
    expect(resolveSelectableId(output, 'headline')).toBe('headline');
    expect(resolveSelectableId(output, 'cta-1')).toBe('cta-1');
  });

  it('maps an expanded symbol child id to its instance', () => {
    expect(resolveSelectableId(output, 'cta-1::label')).toBe('cta-1');
  });

  it('leaves unknown ids untouched', () => {
    expect(resolveSelectableId(output, 'ghost::label')).toBe('ghost::label');
  });
});

describe('resolveTextEditTarget', () => {
  it('passes through a plain text element', () => {
    const target = resolveTextEditTarget(output, [definition], 'headline');
    expect(target?.element.id).toBe('headline');
    expect(target?.instanceId).toBeUndefined();
  });

  it('rejects non-text elements', () => {
    expect(resolveTextEditTarget(output, [definition], 'cta-1')).toBeNull();
  });

  it('resolves a symbol text child to an expanded, unlocked pseudo element', () => {
    const target = resolveTextEditTarget(output, [definition], 'cta-1::label');
    expect(target?.instanceId).toBe('cta-1');
    expect(target?.childId).toBe('label');
    expect(target?.element.text).toBe('Shop now');
    expect(target?.element.x).toBe(110); // instance.x + child.x
    expect(target?.element.y).toBe(415);
    expect(target?.element.locked).toBe(false);
  });

  it('drops stale definition richText when an override text is in force', () => {
    const styledDef: SymbolDefinition = {
      ...definition,
      children: [
        definition.children[0],
        {
          ...(definition.children[1] as any),
          richText: [{ text: 'Shop', fontWeight: 700 }, { text: ' now' }],
        },
      ],
    };
    const overridden = {
      ...instance,
      symbolOverrides: { label: { text: 'Buy today' } },
    } as unknown as DesignerElement;
    const out = { children: [overridden] } as unknown as Pick<
      DesignerOutput,
      'children'
    >;
    const target = resolveTextEditTarget(out, [styledDef], 'cta-1::label');
    expect(target?.element.text).toBe('Buy today');
    expect(target?.element.richText).toBeUndefined();
  });

  it('rejects a non-text symbol child (the plate)', () => {
    expect(
      resolveTextEditTarget(output, [definition], 'cta-1::plate')
    ).toBeNull();
  });
});

describe('symbolTextCommit', () => {
  it('writes the label text into symbolOverrides, preserving other overrides', () => {
    const inst = {
      ...instance,
      symbolOverrides: { plate: { fill: '#ff0000' }, label: { text: 'Old' } },
    } as unknown as DesignerElement;
    expect(symbolTextCommit(inst, 'label', 'New text')).toEqual({
      symbolOverrides: {
        plate: { fill: '#ff0000' },
        label: { text: 'New text' },
      },
    });
  });

  it('carries fill when the editor changed it', () => {
    expect(symbolTextCommit(instance, 'label', 'New text', '#00ff00')).toEqual({
      symbolOverrides: { label: { text: 'New text', fill: '#00ff00' } },
    });
  });

  it('leaves an existing fill override alone when only the text changed', () => {
    const inst = {
      ...instance,
      symbolOverrides: { label: { fill: '#123456' } },
    } as unknown as DesignerElement;
    expect(symbolTextCommit(inst, 'label', 'New text')).toEqual({
      symbolOverrides: { label: { fill: '#123456', text: 'New text' } },
    });
  });
});

describe('symbolFillCommit', () => {
  it('writes the label fill without pinning the current text as an override', () => {
    expect(symbolFillCommit(instance, 'label', '#ff0000')).toEqual({
      symbolOverrides: { label: { fill: '#ff0000' } },
    });
  });

  it('preserves other overrides on the instance and the child', () => {
    const inst = {
      ...instance,
      symbolOverrides: { plate: { fill: '#0000ff' }, label: { text: 'Old' } },
    } as unknown as DesignerElement;
    expect(symbolFillCommit(inst, 'label', '#ff0000')).toEqual({
      symbolOverrides: {
        plate: { fill: '#0000ff' },
        label: { text: 'Old', fill: '#ff0000' },
      },
    });
  });
});

describe('refitSymbolToText', () => {
  // 10px per glyph at the label's 20px — close enough to a real measure.
  const measure = (line: string, fontSize: number) => line.length * (fontSize / 2);

  it('returns null when the committed copy already fits the pill', () => {
    expect(
      refitSymbolToText(instance, definition, 'label', 'Shop now', measure)
    ).toBeNull();
  });

  it('grows the instance to fit a longer label, centred on the old box', () => {
    const copy = 'Get 20% off today only';
    const patch = refitSymbolToText(instance, definition, 'label', copy, measure);
    expect(patch).not.toBeNull();
    expect(patch!.width).toBeGreaterThan(instance.width);
    // Grown about the centre, not drifted right.
    expect(patch!.x).toBe(
      Math.round(instance.x - (patch!.width! - instance.width) / 2)
    );
    // The new box actually fits: the expanded label box (child.width × the new
    // scale) covers the measured copy plus slack, at the authored font size.
    const expandedLabelWidth = 180 * (patch!.width! / 200);
    expect(expandedLabelWidth).toBeGreaterThanOrEqual(measure(copy, 20) + 16);
  });

  it('never shrinks the instance when the copy gets shorter', () => {
    const wide = { ...instance, width: 400 } as unknown as DesignerElement;
    expect(
      refitSymbolToText(wide, definition, 'label', 'Sale', measure)
    ).toBeNull();
  });

  it('returns null without a measurement primitive', () => {
    expect(
      refitSymbolToText(instance, definition, 'label', 'Get 20% off today only', undefined)
    ).toBeNull();
  });
});
