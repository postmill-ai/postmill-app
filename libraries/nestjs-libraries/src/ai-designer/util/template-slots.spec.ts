import { describe, it, expect } from 'vitest';
import { markTemplateSlots, slotLabel } from './template-slots';
import type { DesignerElement } from '../../media/designer-doc/designer-doc.schema';
import type { DesignSlot } from '../ai-designer.types';

const el = (over: Partial<DesignerElement> & { id: string }): DesignerElement =>
  ({
    type: 'text',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    ...over,
  }) as DesignerElement;

const slot = (id: string, kind: DesignSlot['kind'], role = id): DesignSlot => ({
  id,
  role,
  kind,
});

describe('slotLabel', () => {
  it('turns an id into a readable field name', () => {
    expect(slotLabel(slot('bottom-caption', 'text'))).toBe('Bottom caption');
  });

  it('prefers the role, which is the more human of the two', () => {
    expect(slotLabel({ id: 's1', role: 'headline', kind: 'text' })).toBe('Headline');
  });

  it('never produces an empty field name', () => {
    expect(slotLabel({ id: '', role: '', kind: 'text' })).toBe('Field');
  });
});

describe('markTemplateSlots', () => {
  it('marks copy and imagery as fillable fields', () => {
    const out = markTemplateSlots(
      [
        el({ id: 'a', originId: 'headline', text: 'Half price' }),
        el({ id: 'b', originId: 'hero', type: 'image', src: 'x.jpg' }),
      ],
      [slot('headline', 'text'), slot('hero', 'image')]
    );
    expect(out[0].slot).toEqual({ name: 'Headline', kind: 'text', order: 0 });
    expect(out[1].slot).toEqual({ name: 'Hero', kind: 'image', order: 1 });
  });

  it('leaves decoration out of the panel', () => {
    // The value of a fill panel is that everything in it is worth editing;
    // offering to change the divider is noise.
    const out = markTemplateSlots(
      [el({ id: 'a', originId: 'rule', type: 'shape' })],
      [slot('rule', 'accent-shape')]
    );
    expect(out[0].slot).toBeUndefined();
  });

  it('skips a text element with no copy', () => {
    // An empty box in the fill panel is worse than no field at all.
    const out = markTemplateSlots(
      [el({ id: 'a', originId: 'subhead', text: '   ' })],
      [slot('subhead', 'text')]
    );
    expect(out[0].slot).toBeUndefined();
  });

  it('still offers an image slot the composer could not fill', () => {
    // That is precisely the field a user re-running the template wants.
    const out = markTemplateSlots(
      [el({ id: 'a', originId: 'hero', type: 'image' })],
      [slot('hero', 'image')]
    );
    expect(out[0].slot?.kind).toBe('image');
  });

  it('orders fields by the plan, not by z-order', () => {
    // The layout may place the CTA above the headline; the panel should still
    // read headline, subhead, CTA.
    const out = markTemplateSlots(
      [
        el({ id: 'c', originId: 'cta', text: 'Buy' }),
        el({ id: 'a', originId: 'headline', text: 'Half price' }),
      ],
      [slot('headline', 'text'), slot('cta', 'cta-button')]
    );
    expect(out.find((e) => e.id === 'a')!.slot!.order).toBeLessThan(
      out.find((e) => e.id === 'c')!.slot!.order
    );
  });

  it('never overwrites a slot that is already declared', () => {
    const existing = el({ id: 'a', originId: 'headline', text: 'x', slot: { name: 'Mine', kind: 'text' } });
    const out = markTemplateSlots([existing], [slot('headline', 'text')]);
    expect(out[0].slot!.name).toBe('Mine');
  });

  it('returns the same array when nothing is markable', () => {
    // Callers compare by identity to decide whether a re-render is needed.
    const input = [el({ id: 'a' })];
    expect(markTemplateSlots(input, [slot('headline', 'text')])).toBe(input);
    expect(markTemplateSlots(input, [])).toBe(input);
  });

  it('matches on originId, the key every other pass uses', () => {
    // A slot that can be re-filled here is exactly one the copywriter and the
    // critic can also address, because they all key off the same id.
    const out = markTemplateSlots(
      [el({ id: 'generated-uuid', originId: 'headline', text: 'x' })],
      [slot('headline', 'text')]
    );
    expect(out[0].slot).toBeDefined();
  });
});
