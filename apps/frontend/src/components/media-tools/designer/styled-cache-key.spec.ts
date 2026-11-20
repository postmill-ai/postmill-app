import { describe, it, expect } from 'vitest';
import { styledLeafCacheKey } from './elements';
import { hasLayerStyles } from './layer-render';
import type { DesignerElement } from './designer.store';

/**
 * Regression: an AI-composed image carrying layer styles painted blank and
 * stayed blank — StyledLayer cached its Konva buffer on mount, before the
 * image bitmap arrived, and the cache key (the element id alone) never
 * changed, so the cache was never rebuilt. Replacing the image didn't help
 * for the same reason; inserting one did, because an inserted image carries
 * no styles and never enters StyledLayer.
 */

const styledImage = {
  id: 'img-1',
  type: 'image',
  src: 'https://cdn.example.com/hero.png',
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  styles: [
    {
      type: 'drop-shadow',
      color: '#000000',
      opacity: 1,
      distance: 4,
      angle: 45,
      size: 8,
      spread: 0,
    },
  ],
} as unknown as DesignerElement;

describe('styledLeafCacheKey', () => {
  it('gives a styled image a different cache key before and after the bitmap loads', () => {
    // The key only matters for layers that enter StyledLayer.
    expect(hasLayerStyles(styledImage)).toBe(true);
    const pending = styledLeafCacheKey(styledImage, null);
    const ready = styledLeafCacheKey(styledImage, {} as HTMLImageElement);
    expect(pending).not.toBe(ready);
  });

  it('keeps a layer without a loading bitmap on one stable key', () => {
    const shape = {
      ...styledImage,
      id: 'shape-1',
      type: 'shape',
      src: undefined,
    } as DesignerElement;
    // StyledLeaf passes no src for non-image layers, so `image` stays null
    // and nothing forces a re-cache for them.
    expect(styledLeafCacheKey(shape, null)).toBe(styledLeafCacheKey(shape, null));
    expect(styledLeafCacheKey(shape, null)).toBe('shape-1:pending:0,0,200,200,0,0,0:unmasked:mask-ready');
  });

  it('turns over when the painted mask changes or is disabled', () => {
    const first = styledLeafCacheKey({
      ...styledImage,
      maskSrc: '/uploads/mask-a.png',
      maskFileId: 'mask-a',
    }, null);
    const second = styledLeafCacheKey({
      ...styledImage,
      maskSrc: '/uploads/mask-b.png',
      maskFileId: 'mask-b',
    }, null);
    const disabled = styledLeafCacheKey({
      ...styledImage,
      maskSrc: '/uploads/mask-b.png',
      maskFileId: 'mask-b',
      maskEnabled: false,
    }, null);

    expect(second).not.toBe(first);
    expect(disabled).not.toBe(second);
    expect(disabled).toContain(':unmasked');
  });

  it('turns over when the mask bitmap arrives', () => {
    const element = {
      ...styledImage,
      maskSrc: '/uploads/mask-a.png',
      maskFileId: 'mask-a',
    } as DesignerElement;
    const pending = styledLeafCacheKey(element, null, undefined, false);
    const ready = styledLeafCacheKey(element, null, undefined, true);

    expect(ready).not.toBe(pending);
    expect(pending).toContain(':mask-pending');
    expect(ready).toContain(':mask-ready');
  });

  it('turns over when media source, crop, focal geometry, or filter presets change', () => {
    const original = styledLeafCacheKey(styledImage, null);
    for (const patch of [
      { src: 'https://cdn.example.com/other.png' },
      { crop: { x: 10, y: 0, width: 100, height: 100 } },
      { fitMode: 'contain' as const },
      { focalPoint: { x: 0.25, y: 0.75 } },
      { filters: ['sepia', 'contrast:1.2'] },
    ]) {
      expect(styledLeafCacheKey({ ...styledImage, ...patch }, null)).not.toBe(original);
    }
  });
  it.each([
    ['focal point', { fitMode: 'cover', focalPoint: { x: 0.8, y: 0.2 } }],
    ['fit mode', { fitMode: 'contain' }],
    ['explicit crop', { crop: { x: 10, y: 20, width: 300, height: 200 } }],
  ] as const)('turns over when an image’s %s changes', (_name, patch) => {
    const before = styledLeafCacheKey({ ...styledImage, fitMode: 'cover' }, null);
    const after = styledLeafCacheKey({ ...styledImage, fitMode: 'cover', ...patch }, null);
    expect(after).not.toBe(before);
  });

  it('turns over when the element’s own geometry changes — and on a commit bump', () => {
    // Mid-drag the element's x/y change every rAF frame and the key MUST
    // follow for the dragged element: its styled buffer is cached in scene
    // space, so a key that ignored geometry kept painting the bitmap at the
    // pre-drag position until drop. Only the dragged element's key turns
    // over — every other layer's buffer stays cached. On commit the canvas
    // also bumps the geometry generation, which still turns the key over.
    const moved = { ...styledImage, x: 640, y: 480 } as DesignerElement;
    expect(styledLeafCacheKey(moved, null, 3)).not.toBe(styledLeafCacheKey(styledImage, null, 3));
    expect(styledLeafCacheKey(styledImage, null, 3)).toBe(styledLeafCacheKey(styledImage, null, 3));
    expect(styledLeafCacheKey(styledImage, null, 4)).not.toBe(
      styledLeafCacheKey(styledImage, null, 3)
    );
  });
});
