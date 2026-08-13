import { describe, it, expect } from 'vitest';
import { smartReflow } from '../../media/designer-doc/reflow';
import { wrapMoveUnitsInGroups } from './layer-groups';
import type { DesignerElement } from '../../media/designer-doc/designer-doc.schema';

/**
 * Group containers meeting the cross-format re-fit.
 *
 * `reflow.ts` has no concept of a group — it re-fits whatever elements it is
 * handed. A container is deliberately zero-sized (its extent is derived from
 * its members), and a zero-sized box is exactly the shape that turns division
 * into `NaN` and silently corrupts a whole output. Nothing else in the suite
 * exercises this, because until now the composer never emitted one.
 */

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

const source = { width: 1080, height: 1080 };
const target = { width: 1080, height: 1920, formatId: 'ig-story' };

describe('a group container survives a re-fit', () => {
  const composed = () =>
    wrapMoveUnitsInGroups(
      [
        el({ id: 'plate', groupId: 'cta', x: 100, y: 800, width: 400, height: 120 }),
        el({ id: 'label', groupId: 'cta', type: 'text', x: 120, y: 830, width: 360, height: 60, fontSize: 40 }),
      ],
      { genId: () => 'grp-1' }
    );

  it('produces no NaN from a zero-sized box', () => {
    const container = composed().find((e) => e.type === 'group')!;
    const patch = smartReflow(container, source, target);
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value === 'number') {
        expect(Number.isFinite(value), `${key} became ${value}`).toBe(true);
      }
    }
  });

  it('does not give the container a non-zero box it would then be trusted for', () => {
    // The Designer derives a folder's extent from its members. A container that
    // came back from a re-fit with real dimensions would not be wrong on screen,
    // but it would be a second, stale source of truth for the same geometry.
    const container = composed().find((e) => e.type === 'group')!;
    const patch = smartReflow(container, source, target);
    expect(patch.width ?? 0).toBe(0);
    expect(patch.height ?? 0).toBe(0);
  });

  it('leaves the members re-fitting exactly as they did before grouping', () => {
    // The regression that would matter: adding a folder must not change where
    // anything lands. Members are re-fit individually either way.
    const ungrouped = [
      el({ id: 'plate', groupId: 'cta', x: 100, y: 800, width: 400, height: 120 }),
      el({ id: 'label', groupId: 'cta', type: 'text', x: 120, y: 830, width: 360, height: 60, fontSize: 40 }),
    ];
    const grouped = composed().filter((e) => e.type !== 'group');

    for (let i = 0; i < ungrouped.length; i++) {
      expect(smartReflow(grouped[i], source, target)).toEqual(
        smartReflow(ungrouped[i], source, target)
      );
    }
  });
});
