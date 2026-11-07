import { describe, expect, it } from 'vitest';
import { applyBulkAssignments, applyBulkRow, collectBulkAssignmentTargets, collectBulkVariables } from './bulk-variables';

const element = (id: string, extra: Record<string, unknown>) => ({
  id,
  type: 'text',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  ...extra,
});

const makeDoc = (): any => ({
  version: 11,
  mode: 'image',
  outputs: [
    {
      id: 'out-1',
      formatId: 'square',
      name: 'Square',
      width: 1080,
      height: 1080,
      children: [
        element('text-1', {
          text: 'Hello {{name}}',
          richText: [{ text: 'Welcome {{name}}', fontWeight: 700 }],
        }),
        element('image-1', { type: 'image', src: '{{hero}}' }),
        element('shape-1', {
          type: 'shape',
          shape: 'rect',
          fill: '#000000',
          slot: { name: 'brandColor', kind: 'color' },
        }),
      ],
      pages: [
        {
          id: 'page-2',
          children: [element('text-2', { text: 'Second page for {{name}}' })],
        },
      ],
    },
  ],
  symbols: [
    {
      id: 'symbol-1',
      name: 'Footer',
      width: 100,
      height: 100,
      children: [element('symbol-text', { text: '{{footer}}' })],
    },
  ],
});

describe('Bulk Create variables', () => {
  it('collects mustache and slot variables across outputs, pages and symbols', () => {
    expect(collectBulkVariables(makeDoc())).toEqual([
      { name: 'brandColor', kind: 'color' },
      { name: 'footer', kind: 'text' },
      { name: 'hero', kind: 'image' },
      { name: 'name', kind: 'text' },
    ]);
  });

  it('applies one row without mutating the template', () => {
    const template = makeDoc();
    template.outputs[0].children.push(
      element('slotted', { text: 'Old', slot: { name: 'headline', kind: 'text' } })
    );
    template.outputs[0].children[1].symbolOverrides = {
      'symbol-text': { text: 'Override {{footer}}', src: '{{hero}}' },
    };
    const row = {
      name: 'Ada',
      hero: 'https://cdn.example.test/ada.png',
      brandColor: '#ff00ff',
      footer: 'Thanks',
      headline: 'New headline',
    };

    const result = applyBulkRow(template, row);

    expect(template.outputs[0].children[0].text).toBe('Hello {{name}}');
    expect(result.outputs[0].children[0].text).toBe('Hello Ada');
    expect(result.outputs[0].children[0].richText[0].text).toBe('Welcome Ada');
    expect(result.outputs[0].children[1].src).toBe(row.hero);
    expect(result.outputs[0].children[1].symbolOverrides['symbol-text']).toEqual({
      text: 'Override Thanks',
      src: row.hero,
    });
    expect(result.outputs[0].children[2].fill).toBe('#ff00ff');
    expect(result.outputs[0].children[3].text).toBe('New headline');
    expect(result.outputs[0].pages[0].children[0].text).toBe('Second page for Ada');
    expect(result.symbols[0].children[0].text).toBe('Thanks');
  });

  it('leaves unknown variables intact and supports explicit empty values', () => {
    const result = applyBulkRow(makeDoc(), { name: '' });
    expect(result.outputs[0].children[0].text).toBe('Hello ');
    expect(result.outputs[0].children[1].src).toBe('{{hero}}');
  });

  it('assigns text, image and color columns across outputs and extra pages without mutating the design', () => {
    const template = makeDoc();
    template.outputs[0].children = [
      element('plain-text', { text: 'Headline' }),
      element('plain-image', { type: 'image', src: 'https://cdn.example.test/original.png' }),
      element('plain-shape', { type: 'shape', shape: 'rect', fill: '#000000' }),
    ];
    template.outputs[0].pages[0].children = [element('page-text', { text: 'Page copy' })];
    const targets = collectBulkAssignmentTargets(template);
    const targetId = (elementId: string, kind: string) =>
      targets.find((target) => target.elementId === elementId && target.kind === kind)!.id;

    const result = applyBulkAssignments(template, {
      [targetId('plain-text', 'text')]: 'headline',
      [targetId('page-text', 'text')]: 'headline',
      [targetId('plain-image', 'image')]: 'hero',
      [targetId('plain-shape', 'color')]: 'accent',
    });

    expect(result.outputs[0].children.map((child: any) => child.slot)).toEqual([
      { name: 'headline', kind: 'text' },
      { name: 'hero', kind: 'image' },
      { name: 'accent', kind: 'color' },
    ]);
    expect(result.outputs[0].pages[0].children[0].slot).toEqual({ name: 'headline', kind: 'text' });
    expect(template.outputs[0].children[0].slot).toBeUndefined();
    expect(collectBulkVariables(result)).toEqual([
      { name: 'accent', kind: 'color' },
      { name: 'footer', kind: 'text' },
      { name: 'headline', kind: 'text' },
      { name: 'hero', kind: 'image' },
    ]);
  });

  it('preserves existing variables and rejects a column already used by an incompatible kind', () => {
    const template = makeDoc();
    template.outputs[0].children.push(element('plain-text', { text: 'Headline' }));
    const target = collectBulkAssignmentTargets(template).find((item) => item.elementId === 'plain-text' && item.kind === 'text')!;

    expect(() => applyBulkAssignments(template, { [target.id]: 'hero' })).toThrow(
      'Column "hero" is already assigned to image data.'
    );
    expect(template.outputs[0].children[0].text).toBe('Hello {{name}}');
    expect(template.outputs[0].children[2].slot).toEqual({ name: 'brandColor', kind: 'color' });
  });

  it('assigns independent text and color variables to a plain text element', () => {
    const template = makeDoc();
    template.outputs[0].children = [element('plain-text', { text: 'Headline', fill: '#000000' })];
    const targets = collectBulkAssignmentTargets(template);
    const textTarget = targets.find((target) => target.elementId === 'plain-text' && target.kind === 'text')!;
    const colorTarget = targets.find((target) => target.elementId === 'plain-text' && target.kind === 'color')!;

    const assigned = applyBulkAssignments(template, {
      [textTarget.id]: 'headline',
      [colorTarget.id]: 'accent',
    });
    const text = assigned.outputs[0].children[0];
    expect(text.slot).toEqual({ name: 'headline', kind: 'text' });
    expect(text.fill).toBe('{{accent}}');
    expect(collectBulkVariables(assigned)).toEqual(expect.arrayContaining([
      { name: 'headline', kind: 'text' },
      { name: 'accent', kind: 'color' },
    ]));

    const row = applyBulkRow(assigned, { headline: 'Winter Sale', accent: '#ff0000' });
    expect(row.outputs[0].children[0].text).toBe('Winter Sale');
    expect(row.outputs[0].children[0].fill).toBe('#ff0000');
  });

  it('rejects incompatible kinds assigned to the same column in one apply', () => {
    const template = makeDoc();
    template.outputs[0].children = [
      element('plain-text', { text: 'Headline' }),
      element('plain-image', { type: 'image', src: 'https://cdn.example.test/original.png' }),
    ];
    const targets = collectBulkAssignmentTargets(template);
    const textTarget = targets.find((target) => target.kind === 'text')!;
    const imageTarget = targets.find((target) => target.kind === 'image')!;

    expect(() => applyBulkAssignments(template, {
      [textTarget.id]: 'shared',
      [imageTarget.id]: 'shared',
    })).toThrow('Column "shared" cannot be assigned to both text and image data.');
    expect(template.outputs[0].children.every((child: any) => !child.slot)).toBe(true);
  });
});
