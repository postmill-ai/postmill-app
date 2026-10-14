import { describe, it, expect } from 'vitest';
import { computePopoverPlacement } from './output-tabs';

describe('computePopoverPlacement', () => {
  it('opens above when there is plenty of room', () => {
    const p = computePopoverPlacement({ top: 700, bottom: 740 }, 900);
    expect(p.side).toBe('above');
    expect(p.maxHeight).toBe(688);
  });

  it('flips below when the anchor sits near the top', () => {
    const p = computePopoverPlacement({ top: 60, bottom: 100 }, 900);
    expect(p.side).toBe('below');
    expect(p.maxHeight).toBe(788);
  });

  it('caps the height to the available space so the list scrolls instead of clipping', () => {
    // Short viewport, anchor mid-screen: above has 292px — the ~300px resize
    // menu must be capped rather than run off-screen.
    const p = computePopoverPlacement({ top: 300, bottom: 340 }, 600);
    expect(p.side).toBe('above');
    expect(p.maxHeight).toBe(288);
  });

  it('never goes below a usable minimum', () => {
    // Only 88px below the anchor — still flips there (more than the 48 above)
    // but the height floor keeps the menu usable.
    const p = computePopoverPlacement({ top: 60, bottom: 500 }, 600);
    expect(p.side).toBe('below');
    expect(p.maxHeight).toBe(120);
  });
});
