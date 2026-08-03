import { describe, it, expect } from 'vitest';
import {
  expandSymbolInstance,
  expandSymbols,
  fillSlot,
  sanitiseOverrides,
  templateFields,
  type SymbolDefinition,
} from './symbols';
import type { DesignerElement } from './designer-doc.schema';

/**
 * Symbols and template slots.
 *
 * The load-bearing rule is that an instance overrides CONTENT and never
 * structure. Everything else follows from it — including why the expanded
 * children are locked and why their ids are namespaced.
 */

const el = (over: Partial<DesignerElement>): DesignerElement =>
  ({
    id: 'x',
    type: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    ...over,
  }) as DesignerElement;

const definition: SymbolDefinition = {
  id: 'sym-1',
  name: 'Logo lockup',
  width: 100,
  height: 100,
  children: [
    el({ id: 'bg', x: 0, y: 0, width: 100, height: 100, fill: '#000000' }),
    el({ id: 'label', type: 'text', x: 10, y: 20, width: 80, height: 30, text: 'Brand', fontSize: 20 }),
  ],
};

const instance = el({
  id: 'inst-1',
  type: 'symbol',
  symbolId: 'sym-1',
  x: 200,
  y: 300,
  width: 100,
  height: 100,
});

describe('sanitiseOverrides', () => {
  it('keeps the content keys', () => {
    expect(sanitiseOverrides({ a: { text: 'hi', fill: '#fff' } })).toEqual({
      a: { text: 'hi', fill: '#fff' },
    });
  });

  it('drops anything structural', () => {
    // An instance that could move a child would be a copy, not an instance.
    expect(
      sanitiseOverrides({ a: { text: 'hi', x: 50, width: 10 } as never })
    ).toEqual({ a: { text: 'hi' } });
  });

  it('drops an entry left with nothing', () => {
    expect(sanitiseOverrides({ a: { rotation: 90 } as never })).toEqual({});
  });

  it('ignores non-string values', () => {
    expect(sanitiseOverrides({ a: { text: 42 } as never })).toEqual({});
  });
});

describe('expandSymbolInstance', () => {
  it('places the children at the instance’s position', () => {
    const out = expandSymbolInstance(instance, definition);
    expect(out[0].x).toBe(200);
    expect(out[1].x).toBe(210);
    expect(out[1].y).toBe(320);
  });

  it('namespaces ids, so two instances never collide', () => {
    const out = expandSymbolInstance(instance, definition);
    expect(out.map((e) => e.id)).toEqual(['inst-1::bg', 'inst-1::label']);

    const second = expandSymbolInstance({ ...instance, id: 'inst-2' }, definition);
    expect(second[0].id).not.toBe(out[0].id);
  });

  it('scales the children when the instance is resized', () => {
    const out = expandSymbolInstance({ ...instance, width: 200, height: 200 }, definition);
    expect(out[0].width).toBe(200);
    expect(out[1].x).toBe(220);
    expect(out[1].fontSize).toBe(40);
  });

  it('applies a content override', () => {
    const out = expandSymbolInstance(
      { ...instance, symbolOverrides: { label: { text: 'Other' } } },
      definition
    );
    expect(out[1].text).toBe('Other');
  });

  it('refuses a structural override even if one is stored', () => {
    const out = expandSymbolInstance(
      { ...instance, symbolOverrides: { label: { x: 999 } as never } },
      definition
    );
    expect(out[1].x).toBe(210);
  });

  it('locks the expanded children — the instance is what you edit', () => {
    expect(expandSymbolInstance(instance, definition).every((e) => e.locked)).toBe(true);
  });

  it('multiplies opacity and inherits hidden from the instance', () => {
    const out = expandSymbolInstance({ ...instance, opacity: 0.5, hidden: true }, definition);
    expect(out[0].opacity).toBe(0.5);
    expect(out.every((e) => e.hidden)).toBe(true);
  });
});

describe('expandSymbols', () => {
  it('replaces instances and leaves everything else alone', () => {
    const out = expandSymbols([el({ id: 'plain' }), instance], [definition]);
    expect(out.map((e) => e.id)).toEqual(['plain', 'inst-1::bg', 'inst-1::label']);
  });

  it('drops an instance whose definition has gone', () => {
    // Better a missing element than an empty box where a logo should be.
    expect(expandSymbols([instance], [])).toEqual([]);
    expect(expandSymbols([instance], undefined)).toEqual([]);
  });

  it('updates every instance when the definition changes', () => {
    const edited = {
      ...definition,
      children: [definition.children[0], { ...definition.children[1], text: 'Renamed' }],
    };
    const out = expandSymbols(
      [instance, { ...instance, id: 'inst-2', x: 0 }],
      [edited]
    );
    expect(out.filter((e) => e.type === 'text').every((e) => e.text === 'Renamed')).toBe(true);
  });

  it('is a no-op for a document with no symbols at all', () => {
    const plain = [el({ id: 'a' }), el({ id: 'b' })];
    expect(expandSymbols(plain, undefined)).toEqual(plain);
  });
});

describe('templateFields', () => {
  const children = [
    el({ id: 'headline', type: 'text', text: 'Hello', slot: { name: 'Headline', kind: 'text', order: 1 } }),
    el({ id: 'photo', type: 'image', src: 'https://x/a.png', slot: { name: 'Photo', kind: 'image', order: 0 } }),
    el({ id: 'plain' }),
  ];

  it('lists only the marked elements, in the author’s order', () => {
    expect(templateFields(children).map((f) => f.slot.name)).toEqual(['Photo', 'Headline']);
  });

  it('seeds each field with the element’s current content', () => {
    const fields = templateFields(children);
    expect(fields.find((f) => f.elementId === 'headline')!.value).toBe('Hello');
    expect(fields.find((f) => f.elementId === 'photo')!.value).toBe('https://x/a.png');
  });

  it('skips a slot whose kind cannot fill its element', () => {
    // A text slot on an image is an authoring mistake; an input that writes
    // nowhere is worse than no input.
    const wrong = [el({ id: 'img', type: 'image', slot: { name: 'Nope', kind: 'text' } })];
    expect(templateFields(wrong)).toEqual([]);
  });

  it('keeps unordered slots in document order, after the ordered ones', () => {
    const mixed = [
      el({ id: 'a', type: 'text', slot: { name: 'A', kind: 'text' } }),
      el({ id: 'b', type: 'text', slot: { name: 'B', kind: 'text', order: 0 } }),
      el({ id: 'c', type: 'text', slot: { name: 'C', kind: 'text' } }),
    ];
    expect(templateFields(mixed).map((f) => f.slot.name)).toEqual(['B', 'A', 'C']);
  });

  it('ignores a slot with no name', () => {
    expect(templateFields([el({ type: 'text', slot: { name: '', kind: 'text' } })])).toEqual([]);
  });
});

describe('fillSlot', () => {
  it('writes to the right property per kind', () => {
    expect(fillSlot('text', 'hi')).toEqual({ text: 'hi' });
    expect(fillSlot('image', 'https://x/a.png')).toEqual({ src: 'https://x/a.png' });
    expect(fillSlot('color', '#ff0000')).toEqual({ fill: '#ff0000' });
  });
});
