import { describe, expect, it } from 'vitest';
import { seedChildren } from './seed-copy';
import type { DesignerElement } from './designer-doc.schema';

describe('seedChildren rich-text reflow', () => {
  it('scales explicit run sizes without mutating the source children', () => {
    const source: DesignerElement = {
      id: 'source-rich-text',
      originId: 'rich-text-origin',
      type: 'text',
      x: 100,
      y: 100,
      width: 600,
      height: 100,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      text: 'Big rich headline',
      fontSize: 64,
      fontFamily: 'Inter',
      richText: [
        { text: 'Big ', fontSize: 64, fontWeight: 700, fill: '#112233' },
        { text: 'rich ', fontSize: 32, fontStyle: 'italic' },
        { text: 'headline', fontWeight: 500 },
      ],
    };
    const before = structuredClone(source);

    const [copy] = seedChildren(
      [source],
      { width: 1080, height: 1080 },
      { width: 600, height: 400, formatId: 'custom' },
      (element) => element.originId
    );

    expect(copy.id).not.toBe(source.id);
    expect(copy.originId).toBe(source.originId);
    expect(copy.fontSize).toBe(29);
    expect(copy.richText).toEqual([
      { text: 'Big ', fontSize: 29, fontWeight: 700, fill: '#112233' },
      { text: 'rich ', fontSize: 15, fontStyle: 'italic' },
      { text: 'headline', fontWeight: 500 },
    ]);
    expect(copy.richText?.[2]).not.toHaveProperty('fontSize');
    for (const [index, run] of copy.richText!.entries()) {
      expect(run).not.toBe(source.richText![index]);
    }
    expect(source).toEqual(before);
  });
});
