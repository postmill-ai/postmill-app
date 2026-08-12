import { describe, it, expect } from 'vitest';
import {
  compositionRoleFor,
  expandRoles,
  groupByRole,
  layoutSlots,
  resolveCompositionFor,
  type BoundSlot,
} from './layout-bridge';
import { buildGrid } from '../../layout/grid';
import { compositionById } from '../../layout/compositions';
import type { LayoutNode } from '../../layout/box-model';

const bound = (
  id: string,
  role: BoundSlot['role'],
  kind: BoundSlot['slot']['kind'] = 'text',
  text = 'Copy'
): BoundSlot => ({ slot: { id, role, kind }, role, text });

const grid = buildGrid({ width: 1080, height: 1080, formatId: 'ig-post' });
const measureSlot = () => 100;

describe('compositionRoleFor', () => {
  it('maps the composer roles onto composition roles', () => {
    expect(compositionRoleFor(bound('h', 'headline'))).toBe('headline');
    expect(compositionRoleFor(bound('c', 'cta', 'cta-button'))).toBe('cta');
    expect(compositionRoleFor(bound('b', 'badge', 'badge'))).toBe('badge');
    expect(compositionRoleFor(bound('l', 'legal'))).toBe('legal');
  });

  it('stacks body copy with the subhead', () => {
    // A composition with a role per copy slot would be the template thinking
    // this replaces; body copy has always gone where the subhead goes.
    expect(compositionRoleFor(bound('x', 'body'))).toBe('subhead');
  });

  it('routes imagery and logos by KIND, not by role', () => {
    expect(compositionRoleFor(bound('i', 'body', 'image'))).toBe('image');
    expect(compositionRoleFor(bound('lg', 'body', 'logo'))).toBe('logo');
  });

  it('routes decoration away from the copy roles', () => {
    expect(compositionRoleFor(bound('d', 'body', 'accent-shape'))).toBe('decor');
    expect(compositionRoleFor(bound('d', 'body', 'divider'))).toBe('decor');
  });
});

describe('groupByRole', () => {
  it('collects several slots under one role, in plan order', () => {
    // Order is load-bearing: `_slotRole` makes the FIRST copy slot the
    // headline, so re-ordering here would silently re-rank the design.
    const grouped = groupByRole([
      bound('sub-a', 'subhead'),
      bound('sub-b', 'body'),
      bound('h', 'headline'),
    ]);
    expect(grouped.get('subhead')!.map((b) => b.slot.id)).toEqual(['sub-a', 'sub-b']);
    expect(grouped.get('headline')!.map((b) => b.slot.id)).toEqual(['h']);
  });
});

describe('expandRoles', () => {
  const roleLeaf = (role: string): LayoutNode => ({ kind: 'leaf', slotId: role });

  it('replaces a role with the slot bound to it', () => {
    const tree = expandRoles(roleLeaf('headline'), groupByRole([bound('h', 'headline')]));
    expect(tree).toMatchObject({ kind: 'leaf', slotId: 'h' });
  });

  it('stacks a role that several slots claim', () => {
    const tree = expandRoles(
      roleLeaf('subhead'),
      groupByRole([bound('a', 'subhead'), bound('b', 'body')])
    );
    expect(tree).toMatchObject({ kind: 'stack' });
    expect((tree as { children: { slotId: string }[] }).children.map((c) => c.slotId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('drops a role no slot claims, which is what lets one composition serve many genres', () => {
    expect(expandRoles(roleLeaf('badge'), groupByRole([bound('h', 'headline')]))).toBeNull();
  });

  it('drops a container once every child has gone', () => {
    const tree: LayoutNode = { kind: 'stack', children: [roleLeaf('badge'), roleLeaf('legal')] };
    expect(expandRoles(tree, groupByRole([bound('h', 'headline')]))).toBeNull();
  });

  it('keeps the composition′s own hints on the expanded leaf', () => {
    // A composition saying "the image fills what is left" must survive binding.
    const tree = expandRoles(
      { kind: 'leaf', slotId: 'image', fill: true, aspect: 1.6 },
      groupByRole([bound('img', 'body', 'image')])
    );
    expect(tree).toMatchObject({ slotId: 'img', fill: true, aspect: 1.6 });
  });
});

describe('layoutSlots', () => {
  const slots = [
    bound('img', 'body', 'image'),
    bound('headline', 'headline'),
    bound('sub', 'subhead'),
    bound('cta', 'cta', 'cta-button'),
  ];

  it('places every slot the composition can hold', () => {
    const placed = layoutSlots({
      composition: compositionById('hero-fullbleed')!,
      grid,
      slots,
      measureSlot,
    });
    for (const s of slots) expect(placed.has(s.slot.id), s.slot.id).toBe(true);
  });

  it('keys placements by slot id, so a caller can reach its own factory', () => {
    const placed = layoutSlots({
      composition: compositionById('minimal-centered')!,
      grid,
      slots,
      measureSlot,
    });
    expect([...placed.keys()].every((k) => slots.some((s) => s.slot.id === k))).toBe(true);
  });

  it('keeps every box finite and inside the canvas horizontally', () => {
    const placed = layoutSlots({
      composition: compositionById('split-panel')!,
      grid,
      slots,
      measureSlot,
    });
    for (const [id, box] of placed) {
      expect(Number.isFinite(box.x), id).toBe(true);
      expect(Number.isFinite(box.y), id).toBe(true);
      expect(box.width, id).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(grid.width + 1);
    }
  });

  it('returns nothing rather than throwing when no slot matches the composition', () => {
    const placed = layoutSlots({
      composition: compositionById('badge-burst')!,
      grid,
      slots: [],
      measureSlot,
    });
    expect(placed.size).toBe(0);
  });

  it('honours a reference-measured band over the composition box', () => {
    const withGeometry = [
      bound('img', 'body', 'image'),
      {
        ...bound('headline', 'headline'),
        slot: {
          id: 'headline',
          role: 'headline',
          kind: 'text' as const,
          geometry: { yBand: [0.08, 0.2] as [number, number], xAnchor: 'left' as const },
        },
      },
      bound('sub', 'subhead'),
    ];
    const placed = layoutSlots({
      composition: compositionById('hero-fullbleed')!,
      grid,
      slots: withGeometry as BoundSlot[],
      measureSlot,
    });
    const box = placed.get('headline')!;
    const contentHeight = grid.bottom - grid.top;
    expect(box.y).toBe(Math.round(grid.top + 0.08 * contentHeight));
    expect(box.height).toBe(Math.round(0.12 * contentHeight));
    expect(box.x).toBe(grid.left);
    // Width stays the engine's — bands are a vertical spec.
    expect(box.width).toBeGreaterThan(0);
    // Slots without geometry keep their engine boxes.
    expect(placed.get('sub')).toBeDefined();
  });

  it('never band-overrides imagery — the photo keeps the composition box', () => {
    const plain = [bound('img', 'body', 'image'), bound('headline', 'headline')];
    const withGeometry = [
      {
        ...bound('img', 'body', 'image'),
        slot: {
          id: 'img',
          role: 'body',
          kind: 'image' as const,
          geometry: { yBand: [0.4, 0.6] as [number, number] },
        },
      },
      bound('headline', 'headline'),
    ];
    const engine = layoutSlots({
      composition: compositionById('hero-fullbleed')!,
      grid,
      slots: plain,
      measureSlot,
    });
    const placed = layoutSlots({
      composition: compositionById('hero-fullbleed')!,
      grid,
      slots: withGeometry as BoundSlot[],
      measureSlot,
    });
    // The photo is the design's ground — a measured strip must not tear it
    // out of the composition. Identical box with or without geometry.
    expect(placed.get('img')).toEqual(engine.get('img'));
  });

  it('asks for each slot′s height at the width it will actually get', () => {
    // The two-pass contract. A headline is taller in a narrow column, and a
    // measure that ignored width is the bug this whole engine replaces.
    const widths: number[] = [];
    layoutSlots({
      composition: compositionById('split-panel')!,
      grid,
      slots,
      measureSlot: (_b, width) => {
        widths.push(width);
        return 100;
      },
    });
    expect(widths.length).toBeGreaterThan(0);
    expect(widths.every((w) => w > 0 && w <= grid.width)).toBe(true);
  });
});

describe('resolveCompositionFor', () => {
  const ctx = { aspect: 1, has: () => true };

  it('honours the first candidate that fits', () => {
    expect(resolveCompositionFor(['minimal-centered'], ctx, 'hero-fullbleed').id).toBe(
      'minimal-centered'
    );
  });

  it('falls through the candidates in order', () => {
    // plan.composition, then the legacy formatTemplate, then the default.
    expect(resolveCompositionFor([undefined, 'top-bottom'], ctx, 'hero-fullbleed').id).toBe(
      'top-bottom'
    );
  });

  it('replaces a composition the canvas cannot carry', () => {
    // A split panel on a story lays out fine and is unreadable — the failure
    // that never errors and always ships.
    const story = { aspect: 1080 / 1920, has: () => true };
    expect(resolveCompositionFor(['split-panel'], story, 'hero-fullbleed').id).not.toBe(
      'split-panel'
    );
  });

  it('replaces a composition whose centrepiece the plan lacks', () => {
    const noBadge = { aspect: 1, has: (r: string) => r !== 'badge' };
    expect(resolveCompositionFor(['badge-burst'], noBadge, 'hero-fullbleed').id).not.toBe(
      'badge-burst'
    );
  });

  it('always returns something, even when nothing named fits', () => {
    const extreme = { aspect: 0.1, has: () => false };
    expect(resolveCompositionFor(['split-panel', 'banner-strip'], extreme, 'split-panel')).toBeDefined();
  });
});
