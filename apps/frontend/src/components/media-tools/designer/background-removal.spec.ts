import { describe, expect, it } from 'vitest';
import { backgroundMaskDimensions, backgroundRemovalPatch, centeredMediaFrame } from './background-removal';

const before = { x: 11, y: 12, width: 200, height: 100 };
const source = { url: '/before.png', fileId: 'before-file', naturalWidth: 800, naturalHeight: 600 };
const mask = { url: '/mask.png', fileId: 'mask-file' };

describe('backgroundRemovalPatch', () => {
  it('retains original pixels and applies the reviewed alpha as a mask', () => {
    expect(backgroundRemovalPatch({
      source,
      mask,
      output: { width: 1080, height: 1080 },
      fit: 'frame',
    })).toMatchObject({
      src: '/before.png',
      fileId: 'before-file',
      naturalWidth: 800,
      naturalHeight: 600,
      originalSrc: '/before.png',
      originalFileId: 'before-file',
      maskSrc: '/mask.png',
      maskFileId: 'mask-file',
      maskEnabled: true,
      fitMode: 'contain',
    });
    const patch = backgroundRemovalPatch({ source, mask, output: { width: 1080, height: 1080 }, fit: 'frame' });
    expect(patch).not.toHaveProperty('x');
    expect(patch).not.toHaveProperty('y');
    expect(patch).not.toHaveProperty('width');
    expect(patch).not.toHaveProperty('height');
    expect(patch.crop).toBeUndefined();
    expect(patch.smartFilters).toBeUndefined();
  });

  it('fits and centers on the canvas without distortion', () => {
    expect(backgroundRemovalPatch({
      source,
      mask,
      output: { width: 1080, height: 1080 },
      fit: 'canvas',
    })).toMatchObject({ x: 0, y: 135, width: 1080, height: 810, fitMode: 'contain' });
  });

  it('leaves the existing fitting mode and geometry alone in manual mode', () => {
    const patch = backgroundRemovalPatch({ source, mask, output: { width: 1080, height: 1080 }, fit: 'manual' });
    expect(patch).not.toHaveProperty('fitMode');
    expect(patch).not.toHaveProperty('crop');
    expect(patch).not.toHaveProperty('focalPoint');
    expect(patch).not.toHaveProperty('width');
    expect(patch).not.toHaveProperty('x');
  });
});

describe('backgroundMaskDimensions', () => {
  it('uses original-source resolution when a provider resized the cutout', () => {
    expect(backgroundMaskDimensions(source, { url: '/cutout.png', naturalWidth: 400, naturalHeight: 300 }))
      .toEqual({ width: 800, height: 600 });
  });

  it('rejects changed framing and missing dimensions', () => {
    expect(() => backgroundMaskDimensions(source, { url: '/cutout.png', naturalWidth: 400, naturalHeight: 400 }))
      .toThrow('different framing');
    expect(() => backgroundMaskDimensions(source, { url: '/cutout.png' }))
      .toThrow('dimensions');
  });
});

describe('centeredMediaFrame', () => {
  it('centers without changing the frame size', () => {
    expect(centeredMediaFrame(before, { width: 1080, height: 1920 })).toEqual({ x: 440, y: 910 });
  });
});
