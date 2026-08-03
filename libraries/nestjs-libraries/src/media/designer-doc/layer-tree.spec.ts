import { describe, it, expect } from 'vitest';
import {
  buildLayerTree,
  walkLayerTree,
  flattenForDisplay,
  descendantIds,
  groupBounds,
  isEffectivelyHidden,
  isEffectivelyLocked,
  moveLayers,
} from './layer-tree';
import type { DesignerElement } from './designer-doc.schema';

const el = (id: string, over: Partial<DesignerElement> = {}): DesignerElement =>
  ({
    id, type: 'shape', x: 0, y: 0, width: 10, height: 10,
    rotation: 0, opacity: 1, locked: false, hidden: false, ...over,
  }) as DesignerElement;

const group = (id: string, over: Partial<DesignerElement> = {}) =>
  el(id, { type: 'group', ...over });

const order = (children: DesignerElement[]) => {
  const out: string[] = [];
  walkLayerTree(buildLayerTree(children), (n) => out.push(n.element.id));
  return out;
};

describe('buildLayerTree', () => {
  it('returns a flat list when nothing has a parent', () => {
    const tree = buildLayerTree([el('a'), el('b')]);
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(0);
    expect(tree[0].depth).toBe(0);
  });

  it('nests members under their group', () => {
    const tree = buildLayerTree([group('g'), el('a', { parentId: 'g' }), el('b', { parentId: 'g' })]);
    expect(tree).toHaveLength(1);
    expect(tree[0].element.id).toBe('g');
    expect(tree[0].children.map((c) => c.element.id)).toEqual(['a', 'b']);
    expect(tree[0].children[0].depth).toBe(1);
  });

  it('nests groups within groups', () => {
    const tree = buildLayerTree([
      group('outer'), group('inner', { parentId: 'outer' }), el('a', { parentId: 'inner' }),
    ]);
    expect(tree[0].children[0].children[0].element.id).toBe('a');
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });

  it('emits a group at the position of its FIRST member when it sorts later', () => {
    // Nothing enforces that a group element precedes its members, so the tree
    // must place the group before the first member it sees either way.
    expect(order([el('a', { parentId: 'g' }), el('b'), group('g')])).toEqual(['g', 'a', 'b']);
  });

  it('keeps non-contiguous members together under their group', () => {
    // Reordering can scatter a group's members; they must still render as one.
    expect(order([group('g'), el('a', { parentId: 'g' }), el('loose'), el('b', { parentId: 'g' })]))
      .toEqual(['g', 'a', 'b', 'loose']);
  });

  it('treats a dangling parentId as top level rather than dropping the layer', () => {
    const tree = buildLayerTree([el('a', { parentId: 'ghost' })]);
    expect(tree.map((n) => n.element.id)).toEqual(['a']);
  });

  it('ignores a parentId that points at a non-group', () => {
    const tree = buildLayerTree([el('a'), el('b', { parentId: 'a' })]);
    expect(tree).toHaveLength(2);
  });

  it('breaks a self-parent without looping forever', () => {
    const tree = buildLayerTree([group('g', { parentId: 'g' })]);
    expect(tree.map((n) => n.element.id)).toEqual(['g']);
  });

  it('breaks a parent cycle without looping forever', () => {
    const tree = buildLayerTree([
      group('a', { parentId: 'b' }), group('b', { parentId: 'a' }),
    ]);
    // Both survive at some level; the important thing is it terminates.
    const ids: string[] = [];
    walkLayerTree(tree, (n) => ids.push(n.element.id));
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('preserves array order as z-order', () => {
    expect(order([el('bottom'), el('middle'), el('top')])).toEqual(['bottom', 'middle', 'top']);
  });
});

describe('flattenForDisplay', () => {
  it('lists the topmost layer first, groups above their contents', () => {
    const tree = buildLayerTree([el('bottom'), group('g'), el('inner', { parentId: 'g' }), el('top')]);
    expect(flattenForDisplay(tree).map((n) => n.element.id)).toEqual(['top', 'g', 'inner', 'bottom']);
  });
});

describe('descendantIds', () => {
  it('collects nested descendants', () => {
    const children = [
      group('outer'), group('inner', { parentId: 'outer' }),
      el('a', { parentId: 'inner' }), el('b', { parentId: 'outer' }), el('loose'),
    ];
    expect(descendantIds(children, 'outer').sort()).toEqual(['a', 'b', 'inner'].sort());
  });

  it('is empty for a leaf', () => {
    expect(descendantIds([el('a')], 'a')).toEqual([]);
  });
});

describe('groupBounds', () => {
  it('derives the box from members, ignoring the group element itself', () => {
    const children = [
      group('g'),
      el('a', { parentId: 'g', x: 10, y: 20, width: 30, height: 40 }),
      el('b', { parentId: 'g', x: 50, y: 10, width: 10, height: 10 }),
    ];
    expect(groupBounds(children, 'g')).toEqual({ x: 10, y: 10, width: 50, height: 50 });
  });

  it('returns null for an empty group', () => {
    expect(groupBounds([group('g')], 'g')).toBeNull();
  });
});

describe('effective visibility and lock', () => {
  const children = [
    group('g', { hidden: true }),
    el('a', { parentId: 'g' }),
    group('locked', { locked: true }),
    el('b', { parentId: 'locked' }),
    el('free'),
  ];

  it('hides a visible layer inside a hidden group', () => {
    expect(isEffectivelyHidden(children, children[1])).toBe(true);
    expect(isEffectivelyHidden(children, children[4])).toBe(false);
  });

  it('locks an unlocked layer inside a locked group', () => {
    expect(isEffectivelyLocked(children, children[3])).toBe(true);
    expect(isEffectivelyLocked(children, children[4])).toBe(false);
  });
});

describe('moveLayers', () => {
  const base = [el('a'), el('b'), el('c')];

  it('moves a layer to a new index', () => {
    expect(moveLayers(base, ['c'], 0).map((e) => e.id)).toEqual(['c', 'a', 'b']);
    expect(moveLayers(base, ['a'], 3).map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('clamps an out-of-range index', () => {
    expect(moveLayers(base, ['a'], 99).map((e) => e.id)).toEqual(['b', 'c', 'a']);
    expect(moveLayers(base, ['c'], -5).map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('reparents into a group', () => {
    const children = [group('g'), el('a')];
    const moved = moveLayers(children, ['a'], 1, 'g');
    expect(moved.find((e) => e.id === 'a')?.parentId).toBe('g');
  });

  it('carries a group\'s whole subtree when the group moves', () => {
    const children = [
      el('top'), group('g'), el('a', { parentId: 'g' }), el('b', { parentId: 'g' }),
    ];
    const moved = moveLayers(children, ['g'], 0);
    expect(moved.map((e) => e.id)).toEqual(['g', 'a', 'b', 'top']);
    // Members keep their parent — only the dragged group was reparented.
    expect(moved.find((e) => e.id === 'a')?.parentId).toBe('g');
  });

  it('refuses to drop a group inside itself', () => {
    const children = [group('g'), el('a', { parentId: 'g' })];
    expect(moveLayers(children, ['g'], 1, 'g')).toEqual(children);
  });

  it('is a no-op for unknown ids', () => {
    expect(moveLayers(base, ['nope'], 0)).toEqual(base);
  });

  it('clears the parent when dropped at top level', () => {
    const children = [group('g'), el('a', { parentId: 'g' })];
    const moved = moveLayers(children, ['a'], 0, undefined);
    expect(moved.find((e) => e.id === 'a')?.parentId).toBeUndefined();
  });
});
