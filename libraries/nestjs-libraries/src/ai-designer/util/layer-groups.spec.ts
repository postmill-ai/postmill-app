import { describe, it, expect } from 'vitest';
import { recoupleClippedAdjustments, wrapMoveUnitsInGroups } from './layer-groups';
import type { DesignerElement } from '../../media/designer-doc/designer-doc.schema';
import { buildLayerTree } from '../../media/designer-doc/layer-tree';

let seq = 0;
const genId = () => `g${++seq}`;

const el = (over: Partial<DesignerElement> & { id: string }): DesignerElement =>
  ({
    type: 'shape',
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

describe('wrapMoveUnitsInGroups', () => {
  it('wraps a companion pair in a real group', () => {
    seq = 0;
    const out = wrapMoveUnitsInGroups(
      [el({ id: 'plate', groupId: 'cta' }), el({ id: 'label', groupId: 'cta', type: 'text' })],
      { genId }
    );

    const group = out.find((e) => e.type === 'group');
    expect(group).toBeDefined();
    expect(out.filter((e) => e.parentId === group!.id).map((e) => e.id)).toEqual([
      'plate',
      'label',
    ]);
  });

  it('leaves the move-unit key in place', () => {
    // `groupId` and `parentId` answer different questions; the editor writes
    // both, and dropping `groupId` would break cross-format re-fitting.
    seq = 0;
    const out = wrapMoveUnitsInGroups(
      [el({ id: 'a', groupId: 'cta' }), el({ id: 'b', groupId: 'cta' })],
      { genId }
    );
    expect(out.filter((e) => e.type !== 'group').every((e) => e.groupId === 'cta')).toBe(true);
  });

  it('does not wrap a unit of one — a folder of one layer is panel noise', () => {
    seq = 0;
    const out = wrapMoveUnitsInGroups([el({ id: 'solo', groupId: 'headline' })], { genId });
    expect(out.some((e) => e.type === 'group')).toBe(false);
    expect(out[0].parentId).toBeUndefined();
  });

  it('ignores elements with no move-unit at all', () => {
    seq = 0;
    const input = [el({ id: 'a' }), el({ id: 'b' })];
    expect(wrapMoveUnitsInGroups(input, { genId })).toEqual(input);
  });

  it('never re-parents an element that already belongs to a group', () => {
    // Re-parenting here would silently pull a layer out of a group a previous
    // pass, or the user, had already built.
    seq = 0;
    const out = wrapMoveUnitsInGroups(
      [
        el({ id: 'a', groupId: 'cta', parentId: 'existing' }),
        el({ id: 'b', groupId: 'cta', parentId: 'existing' }),
      ],
      { genId }
    );
    expect(out.some((e) => e.type === 'group')).toBe(false);
    expect(out.every((e) => e.parentId === 'existing')).toBe(true);
  });

  it('inserts the container just below its lowest member, preserving z-order', () => {
    // Appending the group instead would re-stack the design: the container
    // draws its members, so its position IS their position.
    seq = 0;
    const out = wrapMoveUnitsInGroups(
      [
        el({ id: 'bg' }),
        el({ id: 'plate', groupId: 'cta' }),
        el({ id: 'label', groupId: 'cta' }),
        el({ id: 'fg' }),
      ],
      { genId }
    );
    expect(out.map((e) => e.id)).toEqual(['bg', 'g1', 'plate', 'label', 'fg']);
  });

  it('handles two separate units without crossing them', () => {
    seq = 0;
    const out = wrapMoveUnitsInGroups(
      [
        el({ id: 'cta-plate', groupId: 'cta' }),
        el({ id: 'badge-bg', groupId: 'badge' }),
        el({ id: 'cta-label', groupId: 'cta' }),
        el({ id: 'badge-num', groupId: 'badge' }),
      ],
      { genId }
    );
    const groups = out.filter((e) => e.type === 'group');
    expect(groups).toHaveLength(2);
    const parentOf = (id: string) => out.find((e) => e.id === id)!.parentId;
    expect(parentOf('cta-plate')).toBe(parentOf('cta-label'));
    expect(parentOf('badge-bg')).toBe(parentOf('badge-num'));
    expect(parentOf('cta-plate')).not.toBe(parentOf('badge-bg'));
  });

  it('gives the container a concrete id, since parentId must resolve', () => {
    // Every other element the composer emits carries `id: ''` for the ops layer
    // to fill in. A group cannot: the reference would dangle.
    seq = 0;
    const out = wrapMoveUnitsInGroups(
      [el({ id: 'a', groupId: 'cta' }), el({ id: 'b', groupId: 'cta' })],
      { genId }
    );
    const group = out.find((e) => e.type === 'group')!;
    expect(group.id).toBeTruthy();
    expect(out.filter((e) => e.parentId).every((e) => e.parentId === group.id)).toBe(true);
  });

  it('names the folder readably', () => {
    seq = 0;
    const out = wrapMoveUnitsInGroups(
      [el({ id: 'a', groupId: 'primary-cta' }), el({ id: 'b', groupId: 'primary-cta' })],
      { genId }
    );
    expect(out.find((e) => e.type === 'group')!.name).toBe('Primary Cta');
  });

  it('produces a tree the renderers can actually walk', () => {
    // The output is fed straight to `buildLayerTree`; a container the tree
    // builder rejects would drop its members from the render entirely.
    seq = 0;
    const out = wrapMoveUnitsInGroups(
      [el({ id: 'bg' }), el({ id: 'a', groupId: 'cta' }), el({ id: 'b', groupId: 'cta' })],
      { genId }
    );
    const tree = buildLayerTree(out);
    const group = tree.find((n) => n.element.type === 'group');
    expect(group).toBeDefined();
    expect(group!.children.map((c) => c.element.id)).toEqual(['a', 'b']);
    expect(tree).toHaveLength(2);
  });
});

describe('recoupleClippedAdjustments', () => {
  it('puts a displaced grade back above the layer it grades', () => {
    // A clipped adjustment binds to whatever is directly beneath it, so a
    // reorder that lands anything in between silently re-points it — the photo
    // returns to its original colours and nothing errors.
    const out = recoupleClippedAdjustments([
      el({ id: 'img', type: 'image', groupId: 'hero' }),
      el({ id: 'intruder' }),
      el({ id: 'grade', type: 'adjustment', clipped: true, groupId: 'hero' }),
    ]);
    expect(out.map((e) => e.id)).toEqual(['img', 'grade', 'intruder']);
  });

  it('leaves a correctly ordered document untouched', () => {
    const input = [
      el({ id: 'img', type: 'image', groupId: 'hero' }),
      el({ id: 'grade', type: 'adjustment', clipped: true, groupId: 'hero' }),
      el({ id: 'copy', type: 'text' }),
    ];
    expect(recoupleClippedAdjustments(input).map((e) => e.id)).toEqual([
      'img',
      'grade',
      'copy',
    ]);
  });

  it('keeps several grades in their original sequence', () => {
    // duotone is black-and-white THEN a ramp; swapped, the ramp is applied to
    // colour and then thrown away.
    const out = recoupleClippedAdjustments([
      el({ id: 'img', type: 'image', groupId: 'hero' }),
      el({ id: 'intruder' }),
      el({ id: 'bw', type: 'adjustment', clipped: true, groupId: 'hero' }),
      el({ id: 'ramp', type: 'adjustment', clipped: true, groupId: 'hero' }),
    ]);
    expect(out.map((e) => e.id)).toEqual(['img', 'bw', 'ramp', 'intruder']);
  });

  it('does not move an unclipped adjustment, which grades everything below it', () => {
    const input = [
      el({ id: 'img', type: 'image', groupId: 'hero' }),
      el({ id: 'intruder' }),
      el({ id: 'global', type: 'adjustment', groupId: 'hero' }),
    ];
    expect(recoupleClippedAdjustments(input).map((e) => e.id)).toEqual(input.map((e) => e.id));
  });

  it('keeps a grade whose base has been removed rather than dropping it', () => {
    const out = recoupleClippedAdjustments([
      el({ id: 'copy', type: 'text' }),
      el({ id: 'orphan', type: 'adjustment', clipped: true, groupId: 'gone' }),
    ]);
    expect(out.map((e) => e.id)).toContain('orphan');
  });

  it('is a no-op for a document with no clipped grades', () => {
    const input = [el({ id: 'a' }), el({ id: 'b' })];
    expect(recoupleClippedAdjustments(input)).toBe(input);
  });
});
