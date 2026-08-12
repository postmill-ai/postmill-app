import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockResolve = vi.fn();
vi.mock('../../../media/designer-doc/icon-resolver', () => ({
  resolveIconifyIcon: (name: string) => mockResolve(name),
}));

import {
  buildExtraSlot,
  buildExtraSlots,
  isExtraSlot,
  resolveIconSlots,
  type ExtraSlotContext,
} from './extra-slots';
import { DesignerDocStrictSchema } from '../../../media/designer-doc/designer-doc.schema';
import type { DesignSlot } from '../../ai-designer.types';

/**
 * The five slot kinds that used to vanish.
 *
 * They were added to the schema with the design language and declared across
 * forty-one skills, and `_buildElements` read none of them — every one was
 * dropped before anything was built.
 */

const ctx = (over: Partial<ExtraSlotContext> = {}): ExtraSlotContext => ({
  w: 1080,
  h: 1080,
  margin: 60,
  accents: ['#ff5a36', '#2ec4b6'],
  ink: '#111111',
  headline: { x: 100, y: 400, width: 880, height: 160 },
  logo: { src: 'https://example.test/logo.png', fileId: 'f1', naturalWidth: 600, naturalHeight: 200 },
  ...over,
});

const slot = (kind: DesignSlot['kind'], role = 'decor', id = kind): DesignSlot => ({ id, role, kind });

const docOf = (children: unknown[]) => ({
  version: 6,
  mode: 'image' as const,
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

describe('isExtraSlot', () => {
  it('claims exactly the kinds nothing else builds', () => {
    for (const kind of ['shape', 'icon', 'divider', 'logo', 'frame'] as const) {
      expect(isExtraSlot({ kind }), kind).toBe(true);
    }
    for (const kind of ['text', 'image', 'cta-button', 'badge', 'accent-shape'] as const) {
      expect(isExtraSlot({ kind }), kind).toBe(false);
    }
  });
});

describe('every kind now produces something', () => {
  // `icon` is deliberately out of this list: an unresolved icon slot drops
  // (see the icon describe below) rather than stand in with a placeholder.
  it.each(['shape', 'divider', 'logo', 'frame'] as const)('%s builds an element', (kind) => {
    expect(buildExtraSlot(slot(kind), 0, ctx()).length).toBeGreaterThan(0);
  });

  it('produces documents the strict schema accepts', () => {
    // A malformed element fails the whole compose, not just itself.
    const children = buildExtraSlots(
      (['shape', 'icon', 'divider', 'logo', 'frame'] as const).map((k) => slot(k, 'decor', k)),
      ctx()
    );
    const parsed = DesignerDocStrictSchema.safeParse(docOf(children));
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.[0])).toBe(true);
  });

  it('keeps the plan′s slot id as the originId, so revise fixes can address them', () => {
    const els = buildExtraSlots([slot('frame', 'decor', 'my-frame')], ctx());
    expect(els[0].originId).toBe('my-frame');
  });
});

describe('divider', () => {
  it('spans the headline, not the canvas', () => {
    // A rule spanning the canvas while the copy it separates spans half of it
    // reads as a mistake.
    const [el] = buildExtraSlot(slot('divider'), 0, ctx());
    const xs = el.nodes!.map((n) => n.x);
    expect(Math.min(...xs)).toBeCloseTo(100, 0);
    expect(Math.max(...xs)).toBeCloseTo(980, 0);
  });

  it('sits below the headline, clear of its descenders', () => {
    const [el] = buildExtraSlot(slot('divider'), 0, ctx());
    expect(Math.min(...el.nodes!.map((n) => n.y))).toBeGreaterThan(400 + 160);
  });

  it('falls back to the canvas middle when there is no headline', () => {
    const [el] = buildExtraSlot(slot('divider'), 0, ctx({ headline: undefined }));
    expect(el.nodes!.length).toBeGreaterThan(0);
  });

  it('sizes the element box to the canvas, since path nodes are absolute', () => {
    const [el] = buildExtraSlot(slot('divider'), 0, ctx());
    expect([el.x, el.y, el.width, el.height]).toEqual([0, 0, 1080, 1080]);
  });

  it('uses the decor recipe its role names', () => {
    const dashed = buildExtraSlot(slot('divider', 'dashed-rule'), 0, ctx())[0];
    expect(dashed.strokeStyle?.dash?.length).toBeGreaterThan(0);
  });
});

describe('frame', () => {
  it('is stroked and never filled', () => {
    // A filled frame is a panel, and a panel over imagery is the framed-inset
    // defect three separate assertions already forbid.
    const [el] = buildExtraSlot(slot('frame'), 0, ctx());
    expect(el.stroke).toBeTruthy();
    expect(el.strokeWidth).toBeGreaterThan(0);
    expect(el.fill).toBeUndefined();
  });

  it('sits inside the margin', () => {
    // A path's element box is the CANVAS — the nodes carry the position — so
    // the margin is checked against the geometry, not the box.
    const [el] = buildExtraSlot(slot('frame'), 0, ctx());
    const xs = el.nodes!.map((n) => n.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(60 - 0.001);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1020 + 0.001);
  });

  it('rounds its corners with Live Corners rather than a border radius', () => {
    // `roundCorners` and `offsetPath` are shared, spec-covered, and were never
    // called by the composer until now. A real path is also what makes the
    // inner keyline below possible at all.
    const [el] = buildExtraSlot(slot('frame'), 0, ctx());
    expect(el.type).toBe('path');
    expect(el.nodes!.length).toBeGreaterThan(4);
  });

  it('draws a second, inset rule when there is room for one', () => {
    // Two lines a few pixels apart read as deliberate; one heavy line reads as
    // a browser border.
    const els = buildExtraSlot(slot('frame'), 0, ctx());
    expect(els).toHaveLength(2);
    expect(els[1].strokeWidth!).toBeLessThan(els[0].strokeWidth!);
    const outer = Math.min(...els[0].nodes!.map((n) => n.x));
    const inner = Math.min(...els[1].nodes!.map((n) => n.x));
    expect(inner).toBeGreaterThan(outer);
  });

  it('drops the inner rule on a frame too small to carry it', () => {
    // Inset on a small frame, the second line collides with the first.
    const small = buildExtraSlot(slot('frame'), 0, ctx(), {
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
    expect(small).toHaveLength(1);
  });
});

describe('logo', () => {
  it('preserves aspect and never crops', () => {
    // A cropped logo is a trademark problem, not a layout one.
    const [el] = buildExtraSlot(slot('logo'), 0, ctx());
    expect(el.fitMode).toBe('contain');
    expect(el.width / el.height).toBeCloseTo(3, 1);
  });

  it('emits nothing when the brand has no logo, rather than an empty box', () => {
    expect(buildExtraSlot(slot('logo'), 0, ctx({ logo: undefined }))).toEqual([]);
  });

  it('assumes a wide lockup when the asset has no dimensions', () => {
    const [el] = buildExtraSlot(
      slot('logo'),
      0,
      ctx({ logo: { src: 'https://example.test/l.png' } })
    );
    expect(el.width).toBeGreaterThan(el.height);
  });
});

describe('icon', () => {
  it('drops the slot when nothing resolvable was named', () => {
    // No resolved icon in the context — the slot drops rather than emitting
    // the old ellipse stand-in, which rendered as a placeholder-looking blob
    // (a grey circle that read as a defect, not decor). Deliberate dots are
    // the `shape` kind's job.
    const els = buildExtraSlot(slot('icon'), 0, ctx());
    expect(els).toEqual([]);
  });

  it('emits a real icon element when the slot was resolved', () => {
    const [el] = buildExtraSlot(
      slot('icon', 'mdi:rocket', 'icon'),
      0,
      ctx({
        resolvedIcons: new Map([
          ['icon', { body: '<path d="M2 12l10-9 3 9-3 9z"/>' }],
        ]),
      })
    );
    expect(el.type).toBe('icon');
    expect(el.src).toBe('<path d="M2 12l10-9 3 9-3 9z"/>');
    expect(el.fill).toBeTruthy();
    // The raw-body contract is schema-valid on icon elements now.
    expect(
      DesignerDocStrictSchema.safeParse(docOf([{ ...el, id: 'i1' }])).success
    ).toBe(true);
  });
});

describe('resolveIconSlots', () => {
  beforeEach(() => mockResolve.mockReset());

  it('resolves only icon-kind slots whose role is an Iconify name', async () => {
    mockResolve.mockResolvedValue({ body: '<path d="M0 0h1v1z"/>' });
    const map = await resolveIconSlots([
      slot('icon', 'mdi:rocket', 'a'),
      slot('icon', 'decor', 'b'),
      slot('shape', 'mdi:rocket', 'c'),
    ]);
    expect(map.size).toBe(1);
    expect(map.get('a')?.body).toBe('<path d="M0 0h1v1z"/>');
    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith('mdi:rocket');
  });

  it('drops failures instead of failing the compose', async () => {
    mockResolve.mockResolvedValue(null);
    const map = await resolveIconSlots([slot('icon', 'mdi:nope', 'a')]);
    expect(map.size).toBe(0);
  });

  it('asset-agent-resolved icons win over the literal-role convention', async () => {
    mockResolve.mockResolvedValue({ body: '<path d="M9 9"/>' });
    const pre = new Map([['a', { body: '<path d="M1 1"/>', viewBox: '0 0 32 32' }]]);
    const map = await resolveIconSlots(
      [slot('icon', 'mdi:rocket', 'a'), slot('icon', 'mdi:rocket', 'b')],
      pre
    );
    // Slot 'a' keeps the pre-resolved body (no network resolve for it);
    // slot 'b' still resolves through its literal role.
    expect(map.get('a')?.body).toBe('<path d="M1 1"/>');
    expect(map.get('a')?.viewBox).toBe('0 0 32 32');
    expect(map.get('b')?.body).toBe('<path d="M9 9"/>');
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });

  it('a pre-resolved icon needs no Iconify-shaped role at all', async () => {
    const pre = new Map([['a', { body: '<path d="M1 1"/>' }]]);
    const map = await resolveIconSlots([slot('icon', 'decor', 'a')], pre);
    expect(map.get('a')?.body).toBe('<path d="M1 1"/>');
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe('placement', () => {
  it('cycles corners so two decorative slots do not stack', () => {
    const els = buildExtraSlots([slot('shape', 'decor', 'a'), slot('shape', 'decor', 'b')], ctx());
    expect({ x: els[0].x, y: els[0].y }).not.toEqual({ x: els[1].x, y: els[1].y });
  });

  it('honours a box the layout engine supplies, over its own corner table', () => {
    // The engine will place these once it drives the composer; the corner table
    // is the fallback, not the rule.
    const boxes = new Map([['shape', { x: 10, y: 20, width: 30, height: 40 }]]);
    const [el] = buildExtraSlots([slot('shape', 'decor', 'shape')], ctx(), boxes);
    expect([el.x, el.y, el.width, el.height]).toEqual([10, 20, 30, 40]);
  });

  it('keeps everything inside the canvas', () => {
    const els = buildExtraSlots(
      (['shape', 'icon', 'divider', 'logo', 'frame'] as const).map((k) => slot(k, 'decor', k)),
      ctx()
    );
    for (const el of els) {
      expect(el.x, el.originId).toBeGreaterThanOrEqual(0);
      expect(el.y, el.originId).toBeGreaterThanOrEqual(0);
      expect(el.x + el.width, el.originId).toBeLessThanOrEqual(1080);
      expect(el.y + el.height, el.originId).toBeLessThanOrEqual(1080);
    }
  });

  it('ignores slots that belong to somebody else', () => {
    expect(buildExtraSlots([slot('text', 'headline', 'h'), slot('image', 'image', 'i')], ctx())).toEqual([]);
  });
});
