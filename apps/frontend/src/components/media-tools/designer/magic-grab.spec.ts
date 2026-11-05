import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStaticMagicGrab, uploadMagicGrabSourceMask } from './magic-grab';
import { uploadBackgroundRemovalMask } from './background-removal-mask';
import { commitCanvas } from './raster-layers';
import { createDesignerStore } from './designer.store';

vi.mock('./background-removal-mask', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./background-removal-mask')>();
  return {
    ...actual,
    uploadBackgroundRemovalMask: vi.fn(async () => ({ src: '/subject-mask.png', fileId: 'subject-mask' })),
  };
});

vi.mock('./raster-layers', () => ({
  commitCanvas: vi.fn(async () => ({ src: '/source-mask.png', fileId: 'source-mask' })),
}));

describe('Magic Grab', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', class {
      crossOrigin = '';
      naturalWidth = 8;
      naturalHeight = 2;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates a full-source white-subject inpaint mask', async () => {
    const operations: string[] = [];
    const context = {
      fillStyle: '',
      globalCompositeOperation: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(() => {
        operations.push(context.globalCompositeOperation);
      }),
    };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context) } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockImplementation(() => canvas);

    await uploadMagicGrabSourceMask({
      fetch: vi.fn(),
      source: { url: '/original.png', naturalWidth: 8, naturalHeight: 2 },
      cutout: { url: '/cutout.png', naturalWidth: 8, naturalHeight: 2 },
      id: 'image-1',
    });

    expect(canvas.width).toBe(8);
    expect(canvas.height).toBe(2);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 8, 2);
    expect(operations).toContain('destination-in');
    expect(context.drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 8, 2]);
    expect(commitCanvas).toHaveBeenCalledWith(canvas, 'image-1:magic-grab-mask', expect.any(Function));
  });

  it('applies background and movable subject with one history entry and removes the source mask', async () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'photo', type: 'image', x: 10, y: 20, width: 300, height: 200,
      rotation: 0, opacity: 1, locked: false, hidden: false, src: '/photo.png',
    });
    const before = store.getState().doc.outputs[0].children[0];
    const history = store.getState().history;
    const fetch = vi.fn(async () => ({ ok: true }) as Response);

    const applied = await applyStaticMagicGrab({
      fetch,
      store,
      candidate: {
        before,
        history,
        source: { url: '/photo.png', naturalWidth: 8, naturalHeight: 2 },
        asset: { url: '/cutout.png', fileId: 'cutout-file', naturalWidth: 8, naturalHeight: 2 },
        background: { url: '/background.png', fileId: 'background-file' },
        sourceMask: { src: '/source-mask.png', fileId: 'source-mask' },
      },
    });

    expect(applied).toBe(true);
    expect(uploadBackgroundRemovalMask).toHaveBeenCalled();
    const children = store.getState().doc.outputs[0].children;
    expect(children).toHaveLength(2);
    expect(children[0]).toMatchObject({ src: '/background.png', fileId: 'background-file' });
    expect(children[1]).toMatchObject({
      src: '/photo.png', originalSrc: '/photo.png', maskSrc: '/subject-mask.png',
    });
    expect(store.getState().selectedIds).toEqual([children[1].id]);
    expect(fetch).toHaveBeenCalledWith('/files/source-mask', { method: 'DELETE' });
  });
});
