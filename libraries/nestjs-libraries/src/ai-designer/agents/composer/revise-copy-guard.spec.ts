import { describe, it, expect } from 'vitest';
import { AiDesignerComposerService } from './ai-designer-composer.service';

/**
 * Observed live: a revision that said "set the Fresh & Tasty textScaleX to
 * 0.62" came back with the ACCENT line deleted — a whole line of the poster's
 * type stack gone from an instruction that named a different element, with
 * nothing in the UI to say so. Copy is now protected the way imagery already
 * was: a revise may only delete a line the user asked to delete.
 */

const svc = () => new AiDesignerComposerService({} as never, {} as never, {} as never);

const doc = (): any => ({
  version: 2,
  mode: 'image',
  outputs: [
    {
      id: 'o1',
      formatId: 'ig-post',
      name: 'Square',
      width: 1080,
      height: 1080,
      background: '#111',
      children: [
        { id: 'e-accent', originId: 'accent', type: 'text', text: 'Italian', x: 0, y: 0, width: 400, height: 90, rotation: 0, opacity: 1, locked: false, hidden: false },
        { id: 'e-head', originId: 'headline', type: 'text', text: 'PIZZA', x: 0, y: 100, width: 600, height: 160, rotation: 0, opacity: 1, locked: false, hidden: false },
        { id: 'e-img', originId: 'image', type: 'image', src: 'https://x/y.png', x: 0, y: 0, width: 1080, height: 1080, rotation: 0, opacity: 1, locked: false, hidden: false },
      ],
    },
  ],
});

const removeOp = (elementId: string) => ({ op: 'removeElement', outputIndex: 0, elementId } as never);
const filter = (ops: unknown[], removalAsked: boolean, targetSlots?: string[]) =>
  (svc() as never as {
    _filterReviseOps: (
      d: unknown, o: unknown[], t?: string[], l?: Record<string, string>, r?: boolean, s?: string[]
    ) => unknown[];
  })._filterReviseOps(doc(), ops, undefined, undefined, removalAsked, targetSlots);

describe('revise copy guard', () => {
  it('refuses to delete copy the instruction never asked to remove', () => {
    expect(filter([removeOp('e-accent')], false)).toHaveLength(0);
  });

  it('allows the deletion when the user actually asked for one', () => {
    expect(filter([removeOp('e-accent')], true)).toHaveLength(1);
  });

  it('allows it when the instruction targeted that slot', () => {
    expect(filter([removeOp('e-accent')], false, ['accent'])).toHaveLength(1);
  });

  it('still protects imagery even when a removal was asked for', () => {
    expect(filter([removeOp('e-img')], true)).toHaveLength(0);
  });

  it('lets an empty text element go — there is no copy to lose', () => {
    const d = doc();
    d.outputs[0].children[0].text = '   ';
    const out = (svc() as never as { _filterReviseOps: (...a: unknown[]) => unknown[] })
      ._filterReviseOps(d, [removeOp('e-accent')], undefined, undefined, false, undefined);
    expect(out).toHaveLength(1);
  });
});

describe('addElement duplicate guard (raw ops)', () => {
  const addOp = (element: Record<string, unknown>) =>
    ({ op: 'addElement', outputIndex: 0, element } as never);

  it('skips an added element whose originId duplicates an existing slot', () => {
    // Live: the model layered a free-floating 64px "FREE" with
    // originId "headline" NEXT TO the real headline.
    const out = filter(
      [
        addOp({
          id: '', type: 'text', text: 'FREE', originId: 'headline',
          x: 621, y: 643, width: 405, height: 109, fontSize: 64,
          rotation: 0, opacity: 1, locked: false, hidden: false,
        }),
      ],
      false
    );
    expect(out).toHaveLength(0);
  });

  it('keeps an added element with a fresh originId', () => {
    const out = filter(
      [
        addOp({
          id: '', type: 'text', text: 'Terms apply', originId: 'legal',
          x: 54, y: 1000, width: 972, height: 20, fontSize: 12,
          rotation: 0, opacity: 1, locked: false, hidden: false,
        }),
      ],
      false
    );
    expect(out).toHaveLength(1);
  });
});
