import { describe, it, expect } from 'vitest';
import { adjustmentScopeCacheKey } from './elements';
import type { DesignerElement } from './designer.store';

/**
 * Regression (prod design cmv9726w101d0syzwnlzam954): an image folded into an
 * AdjustmentScope stayed invisible forever — the scope cached its contents on
 * mount, keyed on `backdropKey` alone, which only tracks the BACKGROUND
 * image. This design has no bg image, so the pending→ready transition of the
 * in-scope image never rebuilt the cache (and Replace Image didn't either).
 * The stale 0×0 cache also dead-ended hit-testing for anything in the fold.
 *
 * The fixture mirrors the prod layer stack: the styled image with two clipped
 * adjustments (levels, brightness-contrast) directly above it.
 */

// el-1732d083-8fd0-47d4-b474-c0dfbfa43377 in the prod doc.
const prodImage = {
  id: 'el-1732d083-8fd0-47d4-b474-c0dfbfa43377',
  type: 'image',
  x: 497,
  y: 0,
  width: 583,
  height: 1080,
  fitMode: 'cover',
  src: 'https://app.postmill.ai/uploads/7b34c8cb/2026/10/14/7a09b26f.jpg',
  styles: [
    {
      type: 'drop-shadow',
      size: 69.96,
      angle: 90,
      color: 'rgba(44, 44, 44, 0.28)',
      spread: 0,
      opacity: 1,
      distance: 29.15,
    },
  ],
} as unknown as DesignerElement;

const pending = () => false;
const ready = () => true;

describe('adjustmentScopeCacheKey', () => {
  it('changes when an in-scope image transitions pending → ready', () => {
    const beforeLoad = adjustmentScopeCacheKey('bg-pending', [prodImage], pending);
    const afterLoad = adjustmentScopeCacheKey('bg-pending', [prodImage], ready);
    expect(beforeLoad).not.toBe(afterLoad);
  });

  it('changes when an in-scope image is replaced (src identity)', () => {
    const replaced = {
      ...prodImage,
      src: 'https://app.postmill.ai/uploads/9c11dd22/2026/10/15/new-photo.jpg',
    } as DesignerElement;
    const before = adjustmentScopeCacheKey('bg-pending', [prodImage], ready);
    const after = adjustmentScopeCacheKey('bg-pending', [replaced], ready);
    expect(before).not.toBe(after);
  });

  it('changes when a layer is inserted into or removed from the fold', () => {
    // The ellipse case: a shape inserted under the adjustment layer must
    // rebuild the scope cache — the stale cache is what dead-ended its
    // hit-testing.
    const ellipse = {
      id: 'el-inserted-ellipse',
      type: 'shape',
      shape: 'ellipse',
      x: 100,
      y: 100,
      width: 120,
      height: 120,
    } as unknown as DesignerElement;
    const before = adjustmentScopeCacheKey('bg-pending', [prodImage], ready);
    const after = adjustmentScopeCacheKey('bg-pending', [prodImage, ellipse], ready);
    expect(before).not.toBe(after);
  });

  it('stays stable for a scope with no bitmap layers, whatever the load state', () => {
    const shape = {
      id: 'el-56bce547-121a-4788-8937-241c1539de22',
      type: 'shape',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 497,
      height: 1080,
    } as unknown as DesignerElement;
    expect(adjustmentScopeCacheKey('bg-pending', [shape], pending)).toBe(
      adjustmentScopeCacheKey('bg-pending', [shape], ready)
    );
  });

  it('still honours the backdrop key (bg image readiness)', () => {
    const shape = {
      id: 'shape-1',
      type: 'shape',
    } as unknown as DesignerElement;
    expect(adjustmentScopeCacheKey('bg-pending', [shape], pending)).not.toBe(
      adjustmentScopeCacheKey('bg-loaded', [shape], pending)
    );
  });

  it('is stable across reads while nothing changed (no spurious re-caches)', () => {
    expect(adjustmentScopeCacheKey('bg-pending', [prodImage], ready)).toBe(
      adjustmentScopeCacheKey('bg-pending', [prodImage], ready)
    );
  });

  it('changes when a folded layer moves — the scope’s bitmap must track its layers', () => {
    // The prod fixture's styled image dragged across the canvas: x/y move per
    // rAF-throttled drag frame, and the scope holding the DRAGGED layer must
    // re-rasterise with it — Konva never repaints a cached node for a moved
    // descendant, so a key that ignored geometry left the bitmap frozen at
    // the pre-drag position until drop. Scopes whose folded layers did NOT
    // move keep their key (see the stability test above), so this is not a
    // re-rasterise-everything-per-frame regime.
    const moved = { ...prodImage, x: 900, y: 640 } as DesignerElement;
    expect(adjustmentScopeCacheKey('bg-pending', [prodImage], ready, 7)).not.toBe(
      adjustmentScopeCacheKey('bg-pending', [moved], ready, 7)
    );
  });

  it('changes when the gesture-commit geometry generation bumps', () => {
    // A committed drag/transform bumps the nonce once, which is what refreshes
    // the cached scope — Konva never repaints a cached node for a moved
    // descendant, so without this the bitmap froze at the pre-drag position.
    const before = adjustmentScopeCacheKey('bg-pending', [prodImage], ready, 7);
    const after = adjustmentScopeCacheKey('bg-pending', [prodImage], ready, 8);
    expect(before).not.toBe(after);
  });
});
