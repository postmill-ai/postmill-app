import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesignerStore, type DesignerElement, type VideoOutput } from './designer.store';
import {
  armCutoutRefinement,
  createCutoutMask,
  findCutoutTarget,
  updateCutoutTarget,
} from './cutout-refinement';
import { uploadBackgroundRemovalMask } from './background-removal-mask';
import { primeBufferFromSrc } from './raster-layers';

vi.mock('./background-removal-mask', () => ({
  uploadBackgroundRemovalMask: vi.fn(),
}));
vi.mock('./raster-layers', () => ({
  primeBufferFromSrc: vi.fn(),
}));

const uploadMock = vi.mocked(uploadBackgroundRemovalMask);
const primeMock = vi.mocked(primeBufferFromSrc);

describe('cutout refinement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadMock.mockResolvedValue({ src: '/mask.png', fileId: 'mask-file' });
    primeMock.mockResolvedValue(undefined);
  });

  it('creates a mask without replacing the current image and arms Restore', async () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'image-1', type: 'image', x: 0, y: 0, width: 200, height: 100,
      src: '/before.png', fileId: 'before-file', originalSrc: '/original.png',
      naturalWidth: 800, naturalHeight: 400,
    } as DesignerElement);
    const historyLength = store.getState().history.length;

    await expect(createCutoutMask({ store, fetch: vi.fn(), id: 'image-1' })).resolves.toBe(true);
    const target = findCutoutTarget(store, 'image-1');
    expect(target).toMatchObject({
      src: '/before.png',
      originalSrc: '/original.png',
      maskSrc: '/mask.png',
      maskFileId: 'mask-file',
      maskEnabled: true,
    });
    expect(store.getState().history).toHaveLength(historyLength + 1);
    expect(store.getState().maskTargetId).toBe('image-1');
    expect(store.getState().activeTool).toBe('brush');
    expect(store.getState().toolOptions.brush?.color).toBe('#ffffff');
    expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({
      frame: {
        width: 200,
        height: 100,
        crop: undefined,
        fitMode: undefined,
        focalPoint: undefined,
      },
    }));
  });

  it('updates and primes still-image clip masks through the same path', async () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const trackId = output.tracks[0].id;
    store.getState().addClip(0, trackId, {
      id: 'clip-1', startMs: 0, endMs: 1000,
      src: '/before.png', width: 200, height: 100,
      maskSrc: '/saved-mask.png', maskFileId: 'mask-file',
    });
    updateCutoutTarget(store, 'clip-1', { maskEnabled: false });
    expect(findCutoutTarget(store, 'clip-1')?.maskEnabled).toBe(false);

    await expect(armCutoutRefinement(store, 'clip-1')).resolves.toBe(true);
    expect(primeMock).toHaveBeenCalledWith('clip-1:mask', '/saved-mask.png', 200, 100);
    expect(store.getState().maskTargetId).toBe('clip-1');
    expect(store.getState().activeTool).toBe('brush');
  });
});
