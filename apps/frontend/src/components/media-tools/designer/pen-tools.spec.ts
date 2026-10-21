import { describe, it, expect } from 'vitest';
import {
  CLOSE_HIT_RADIUS,
  emptyDraft,
  penClick,
  findNodeAt,
  popDraftAnchor,
  type PenDraft,
} from './pen-tools';

/**
 * The Pen state machine's zoom-compensated hit testing and draft pop. The
 * canvas divides CLOSE_HIT_RADIUS by the stage zoom before calling in, so the
 * hit area stays ~8 SCREEN px at any magnification; these lock the contract.
 */

describe('zoom-scaled hit radius', () => {
  // fit-to-screen on a large artboard, e.g. zoom 0.25 → 8 / 0.25 = 32 doc px.
  const docRadius = (zoom: number) => CLOSE_HIT_RADIUS / zoom;

  it('closes the path when the click lands within the scaled radius', () => {
    const draft: PenDraft = {
      nodes: [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 300 },
      ],
      closed: false,
    };
    // 20 doc px from the first anchor: a miss at zoom 1 (20 > 8), a hit at
    // zoom 0.25 (20 < 32).
    const click = { x: 120, y: 100 };
    expect(penClick(draft, click, docRadius(1)).finished).toBe(false);
    expect(penClick(draft, click, docRadius(0.25)).finished).toBe(true);
  });

  it('keeps the raw radius as the default so unscaled callers are unchanged', () => {
    const draft: PenDraft = {
      nodes: [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
      ],
      closed: false,
    };
    expect(penClick(draft, { x: 107, y: 100 }).finished).toBe(true);
    expect(penClick(draft, { x: 109, y: 100 }).finished).toBe(false);
  });

  it('findNodeAt honours the scaled radius', () => {
    const nodes = [{ x: 50, y: 50 }, { x: 400, y: 50 }];
    expect(findNodeAt(nodes, { x: 70, y: 50 })).toBe(-1);
    expect(findNodeAt(nodes, { x: 70, y: 50 }, docRadius(0.25))).toBe(0);
  });
});

describe('popDraftAnchor (⌘Z / Backspace mid-draft)', () => {
  it('drops the last anchor and keeps the draft open', () => {
    const draft: PenDraft = {
      nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      closed: false,
    };
    const next = popDraftAnchor(draft);
    expect(next).not.toBeNull();
    expect(next!.nodes).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    // The original draft is untouched — the state machine is immutable.
    expect(draft.nodes).toHaveLength(3);
  });

  it('popping the last anchor clears the draft', () => {
    expect(popDraftAnchor({ nodes: [{ x: 0, y: 0 }], closed: false })).toBeNull();
    expect(popDraftAnchor(emptyDraft())).toBeNull();
  });

  it('two pops then a commit leaves a valid two-anchor path', () => {
    let draft: PenDraft | null = {
      nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }],
      closed: false,
    };
    draft = draft && popDraftAnchor(draft);
    draft = draft && popDraftAnchor(draft);
    expect(draft?.nodes).toHaveLength(2);
  });
});
