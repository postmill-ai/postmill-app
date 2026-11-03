import { describe, expect, it } from 'vitest';
import { backgroundRemovalPatch, centeredMediaFrame } from './background-removal';

const before = { x: 11, y: 12, width: 200, height: 100 };
const asset = { url: '/result.png', fileId: 'result-file', naturalWidth: 800, naturalHeight: 600 };

describe('backgroundRemovalPatch', () => {
  it('preserves the frame and switches to contain by default', () => {
    expect(backgroundRemovalPatch({
      asset,
      output: { width: 1080, height: 1080 },
      fit: 'frame',
    })).toMatchObject({
      src: '/result.png',
      fileId: 'result-file',
      naturalWidth: 800,
      naturalHeight: 600,
      fitMode: 'contain',
    });
    const patch = backgroundRemovalPatch({ asset, output: { width: 1080, height: 1080 }, fit: 'frame' });
    expect(patch).not.toHaveProperty('x');
    expect(patch).not.toHaveProperty('y');
    expect(patch).not.toHaveProperty('width');
    expect(patch).not.toHaveProperty('height');
    expect(patch.crop).toBeUndefined();
    expect(patch.originalSrc).toBeUndefined();
    expect(patch.smartFilters).toBeUndefined();
  });

  it('fits and centers on the canvas without distortion', () => {
    expect(backgroundRemovalPatch({
      asset,
      output: { width: 1080, height: 1080 },
      fit: 'canvas',
    })).toMatchObject({ x: 0, y: 135, width: 1080, height: 810, fitMode: 'contain' });
  });

  it('leaves the existing fitting mode and geometry alone in manual mode', () => {
    const patch = backgroundRemovalPatch({ asset, output: { width: 1080, height: 1080 }, fit: 'manual' });
    expect(patch).not.toHaveProperty('fitMode');
    expect(patch).not.toHaveProperty('width');
    expect(patch).not.toHaveProperty('x');
  });
});

describe('centeredMediaFrame', () => {
  it('centers without changing the frame size', () => {
    expect(centeredMediaFrame(before, { width: 1080, height: 1920 })).toEqual({ x: 440, y: 910 });
  });
});
