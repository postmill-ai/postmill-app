import { describe, it, expect } from 'vitest';
import { emitDecor, type DecorPlacementContext } from './emit-decor';
import { DesignerDocStrictSchema } from '../../media/designer-doc/designer-doc.schema';

const ctx = (over: Partial<DecorPlacementContext> = {}): DecorPlacementContext => ({
  canvas: { width: 1080, height: 1080 },
  margin: 60,
  headline: { x: 100, y: 400, width: 880, height: 160 },
  palette: ['#0b1020', '#f5f5f0', '#ff5a36'],
  ...over,
});

const nodesOf = (id: string, c = ctx()) => emitDecor([id], c)[0]?.nodes ?? [];

describe('emitDecor', () => {
  it('places a rule below the headline, clear of its descenders', () => {
    // A rule struck through the copy it is meant to underline is the classic
    // version of this mistake.
    const ys = nodesOf('rule').map((n) => n.y);
    expect(Math.min(...ys)).toBeGreaterThan(400 + 160);
  });

  it('matches a rule to the headline width, not the canvas', () => {
    const xs = nodesOf('rule').map((n) => n.x);
    expect(Math.min(...xs)).toBeCloseTo(100, 0);
    expect(Math.max(...xs)).toBeCloseTo(980, 0);
  });

  it('falls back to a corner when there is no headline to attach to', () => {
    const nodes = nodesOf('rule', ctx({ headline: undefined }));
    expect(nodes.length).toBeGreaterThan(0);
    expect(Math.min(...nodes.map((n) => n.y))).toBeGreaterThanOrEqual(60);
  });

  it('gives a frame the whole canvas inside the margin', () => {
    const nodes = nodesOf('full-frame');
    expect(Math.min(...nodes.map((n) => n.x))).toBeCloseTo(60, 0);
    expect(Math.max(...nodes.map((n) => n.x))).toBeCloseTo(1020, 0);
  });

  it('sizes the path box to the CANVAS, since nodes are absolute', () => {
    // Giving the element the mark's bounding box instead would offset every
    // node by that origin a second time, and the mark would drift off-canvas.
    const [element] = emitDecor(['rule'], ctx());
    expect([element.x, element.y]).toEqual([0, 0]);
    expect([element.width, element.height]).toEqual([1080, 1080]);
  });

  it('strokes an open mark and fills a closed one', () => {
    const [rule] = emitDecor(['rule'], ctx());
    const [burst] = emitDecor(['burst'], ctx());
    expect(rule.stroke).toBeTruthy();
    expect(rule.strokeWidth).toBeGreaterThan(0);
    expect(rule.fill).toBeUndefined();
    expect(burst.fill).toBeTruthy();
  });

  it('scales a dash pattern by the stroke weight', () => {
    // A dash array in raw px is invisible on a large canvas and solid on a
    // small one.
    const [dashed] = emitDecor(['dashed-rule'], ctx());
    expect(dashed.strokeStyle?.dash?.every((d) => d > 0)).toBe(true);
  });

  it('keeps only one loud mark', () => {
    const out = emitDecor(['burst', 'diagonal-stripes', 'rule'], ctx());
    expect(out.map((e) => e.originId)).toContain('decor-rule');
    expect(out).toHaveLength(2);
  });

  it('emits nothing for "none", an unknown id, or an empty list', () => {
    expect(emitDecor(['none'], ctx())).toEqual([]);
    expect(emitDecor(['not-a-mark'], ctx())).toEqual([]);
    expect(emitDecor(undefined, ctx())).toEqual([]);
  });

  it('uses the palette accent rather than a fixed colour', () => {
    const [a] = emitDecor(['rule'], ctx({ palette: ['#000', '#111', '#ff0000'] }));
    const [b] = emitDecor(['rule'], ctx({ palette: ['#000', '#111', '#00ff00'] }));
    expect(a.stroke).not.toBe(b.stroke);
  });

  it('produces elements the strict schema accepts', () => {
    // A malformed decor element would fail the whole compose, not just itself.
    const children = emitDecor(['rule', 'burst', 'dot-grid', 'corner-brackets'], ctx());
    const parsed = DesignerDocStrictSchema.safeParse({
      version: 6,
      mode: 'image',
      outputs: [
        {
          id: 'o',
          formatId: 'square',
          name: 'S',
          width: 1080,
          height: 1080,
          background: '#ffffff',
          children,
        },
      ],
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.[0])).toBe(true);
  });

  it('keeps every node inside the canvas', () => {
    for (const id of ['rule', 'burst', 'dot-grid', 'corner-brackets', 'full-frame', 'arc']) {
      for (const n of nodesOf(id)) {
        expect(n.x, `${id}.x`).toBeGreaterThanOrEqual(-1);
        expect(n.x, `${id}.x`).toBeLessThanOrEqual(1081);
        expect(n.y, `${id}.y`).toBeGreaterThanOrEqual(-1);
        expect(n.y, `${id}.y`).toBeLessThanOrEqual(1081);
      }
    }
  });
});
