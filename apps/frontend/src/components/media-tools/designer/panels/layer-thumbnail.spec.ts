import { describe, expect, it } from 'vitest';
import { layerThumbnailKey } from './layer-thumbnail';
import type { DesignerElement } from '../designer.store';

const image = {
  id: 'image-1',
  type: 'image',
  src: '/uploads/image.png',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
} as DesignerElement;

describe('layerThumbnailKey', () => {
  it('invalidates for crop, focal, fit, filter, and mask changes', () => {
    const original = layerThumbnailKey(image);
    for (const patch of [
      { crop: { x: 0, y: 0, width: 50, height: 50 } },
      { focalPoint: { x: 0.25, y: 0.75 } },
      { fitMode: 'contain' as const },
      { filters: ['grayscale'] },
      { maskSrc: '/uploads/mask.png' },
      { maskEnabled: false },
    ]) {
      expect(layerThumbnailKey({ ...image, ...patch })).not.toBe(original);
    }
  });

  it('does not churn for selection-only editor state', () => {
    expect(layerThumbnailKey({ ...image, selected: true } as DesignerElement)).toBe(layerThumbnailKey(image));
  });
});
