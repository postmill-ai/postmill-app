import {
  axisForAnchor,
  buildResizePatch,
  MIN_ELEMENT_SIZE,
} from './transform-resize';
import { fitTextToBox } from '@postmill-ai/nestjs-libraries/media/designer-doc/fit-text';
import type { DesignerElement } from './designer.store';

const textEl = (over: Partial<DesignerElement> = {}) =>
  ({ type: 'text', fontSize: 40, ...over }) as DesignerElement;

const node = (over: Partial<Parameters<typeof buildResizePatch>[1]> = {}) => ({
  x: 10,
  y: 20,
  width: 200,
  height: 100,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  ...over,
});

describe('axisForAnchor', () => {
  it('treats corners and the rotater as both-axis', () => {
    for (const a of ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'rotater', null]) {
      expect(axisForAnchor(a)).toBe('both');
    }
  });

  it('treats left/right handles as width-only and top/bottom as height-only', () => {
    expect(axisForAnchor('middle-left')).toBe('x');
    expect(axisForAnchor('middle-right')).toBe('x');
    expect(axisForAnchor('top-center')).toBe('y');
    expect(axisForAnchor('bottom-center')).toBe('y');
  });
});

describe('buildResizePatch', () => {
  it('bakes scale into absolute width/height', () => {
    const patch = buildResizePatch(
      { type: 'shape' } as DesignerElement,
      node({ scaleX: 2, scaleY: 1.5 }),
      'bottom-right'
    );
    expect(patch.width).toBe(400);
    expect(patch.height).toBe(150);
    // The document model has no scaleX/scaleY, so nothing may leak through.
    expect(patch).not.toHaveProperty('scaleX');
  });

  it('floors the box so an element cannot be scaled to nothing', () => {
    const patch = buildResizePatch(
      { type: 'shape' } as DesignerElement,
      node({ scaleX: 0.001, scaleY: 0.001 }),
      'top-left'
    );
    expect(patch.width).toBe(MIN_ELEMENT_SIZE);
    expect(patch.height).toBe(MIN_ELEMENT_SIZE);
  });

  it('scales fontSize with the box when text is dragged by a corner', () => {
    const patch = buildResizePatch(
      textEl(),
      node({ scaleX: 2, scaleY: 2 }),
      'bottom-right'
    );
    expect(patch.width).toBe(400);
    expect(patch.fontSize).toBe(80);
  });

  it('leaves fontSize alone when text is dragged by a side handle', () => {
    // Dragging a side re-wraps the text at the same size — the box is a
    // wrapping frame there, not a zoom control.
    const patch = buildResizePatch(
      textEl(),
      node({ scaleX: 2, scaleY: 1 }),
      'middle-right'
    );
    expect(patch.width).toBe(400);
    expect(patch.fontSize).toBeUndefined();
  });

  it('leaves fontSize alone for top/bottom handles', () => {
    const patch = buildResizePatch(
      textEl(),
      node({ scaleX: 1, scaleY: 2 }),
      'bottom-center'
    );
    expect(patch.height).toBe(200);
    expect(patch.fontSize).toBeUndefined();
  });

  it('does not touch fontSize for non-text elements', () => {
    const patch = buildResizePatch(
      { type: 'image', fontSize: 40 } as DesignerElement,
      node({ scaleX: 2, scaleY: 2 }),
      'bottom-right'
    );
    expect(patch.fontSize).toBeUndefined();
  });

  it('skips rich and curved text, which lay out through other paths', () => {
    const rich = buildResizePatch(
      textEl({ richText: [{ text: 'a' }] as any }),
      node({ scaleX: 2, scaleY: 2 }),
      'bottom-right'
    );
    expect(rich.fontSize).toBeUndefined();

    const curved = buildResizePatch(
      textEl({ curve: 30 }),
      node({ scaleX: 2, scaleY: 2 }),
      'bottom-right'
    );
    expect(curved.fontSize).toBeUndefined();
  });

  it('emits no fontSize for a pure move (scale 1)', () => {
    const patch = buildResizePatch(textEl(), node(), 'bottom-right');
    expect(patch.fontSize).toBeUndefined();
    expect(patch.width).toBe(200);
  });

  it('keeps fontSize within schema bounds when scaled to extremes', () => {
    const huge = buildResizePatch(
      textEl({ fontSize: 1000 }),
      node({ scaleX: 100, scaleY: 100 }),
      'top-left'
    );
    expect(huge.fontSize).toBeLessThanOrEqual(2000);

    const tiny = buildResizePatch(
      textEl({ fontSize: 10 }),
      node({ scaleX: 0.01, scaleY: 0.01 }),
      'top-left'
    );
    expect(tiny.fontSize).toBeGreaterThanOrEqual(8);
  });
});

describe('fitTextToBox', () => {
  // A deterministic monospace-ish measure: every glyph is 0.5em wide.
  const measure = (text: string, fontSize: number) => text.length * fontSize * 0.5;

  it('leaves text alone when it already fits', () => {
    const fitted = fitTextToBox(
      { text: 'hi', width: 1000, height: 1000, fontSize: 40 },
      measure
    );
    expect(fitted.fontSize).toBe(40);
    expect(fitted.lines).toEqual(['hi']);
  });

  it('shrinks the font until the wrapped block fits the box height', () => {
    const fitted = fitTextToBox(
      { text: 'one two three four five six', width: 100, height: 200, fontSize: 40 },
      measure
    );
    expect(fitted.fontSize).toBeLessThan(40);
    expect(fitted.lines.length * fitted.lineHeight).toBeLessThanOrEqual(200);
  });

  it('stops at the 60% floor even when the text still overflows', () => {
    // Deliberate: shrinking without limit would render a headline unreadable,
    // so the floor wins and the block is allowed to overflow. This mirrors the
    // server renderer exactly.
    const fitted = fitTextToBox(
      { text: 'a very long line that cannot possibly fit', width: 20, height: 10, fontSize: 100 },
      measure
    );
    expect(fitted.fontSize).toBe(60);
    expect(fitted.lines.length * fitted.lineHeight).toBeGreaterThan(10);
  });

  it('honours explicit newlines', () => {
    const fitted = fitTextToBox(
      { text: 'a\nb', width: 1000, height: 1000, fontSize: 20 },
      measure
    );
    expect(fitted.lines).toEqual(['a', 'b']);
  });

  it('never grows text to fill a large box', () => {
    const fitted = fitTextToBox(
      { text: 'x', width: 5000, height: 5000, fontSize: 12 },
      measure
    );
    expect(fitted.fontSize).toBe(12);
  });
});
