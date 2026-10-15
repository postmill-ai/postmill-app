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
    expect(styledLeafCacheKey(shape, null)).toBe('shape-1:pending');
  });
});
