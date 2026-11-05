import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { maskFrameAspectChanged, remapBackgroundRemovalMask, uploadBackgroundRemovalMask } from './background-removal-mask';
import { commitCanvas, seedBufferFromCanvas } from './raster-layers';

vi.mock('./raster-layers', () => ({
  commitCanvas: vi.fn(async () => ({ src: '/mask.png', fileId: 'mask-file' })),
  seedBufferFromCanvas: vi.fn(),
}));

describe('uploadBackgroundRemovalMask', () => {
  let context: {
    fillStyle: string;
    globalCompositeOperation: string;
    fillRect: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
  };
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    context = {
      fillStyle: '',
      globalCompositeOperation: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    };
    canvas = { width: 0, height: 0, getContext: vi.fn(() => context) } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockImplementation(() => canvas);
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

  const upload = (fitMode: 'contain' | 'cover') => uploadBackgroundRemovalMask({
    fetch: vi.fn(),
    source: { url: '/source.png', naturalWidth: 8, naturalHeight: 2 },
    cutout: { url: '/cutout.png', naturalWidth: 8, naturalHeight: 2 },
    frame: { width: 400, height: 300, fitMode },
    id: 'image-1',
  });

  it('rasterizes the source alpha into the letterboxed element box', async () => {
    await upload('contain');

    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
    expect(context.drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 8, 2, 0, 100, 400, 100]);
    expect(seedBufferFromCanvas).toHaveBeenCalledWith('image-1:mask', canvas);
    expect(commitCanvas).toHaveBeenCalledWith(canvas, 'image-1:mask', expect.any(Function));
  });

  it('uses the same cover crop window for the mask as for the image', async () => {
    await upload('cover');

    const args = context.drawImage.mock.calls[0].slice(1);
    expect(args[0]).toBeCloseTo(8 / 3);
    expect(args.slice(1, 4)).toEqual([0, 8 / 3, 2]);
    expect(args.slice(4)).toEqual([0, 0, 400, 300]);
  });
});

describe('remapBackgroundRemovalMask', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('recovers source alpha and re-letterboxes it for the new frame', async () => {
    const sourceContext = { drawImage: vi.fn() };
    const nextContext = {
      fillStyle: '',
      globalCompositeOperation: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    };
    const canvases = [
      { width: 0, height: 0, getContext: vi.fn(() => sourceContext) },
      { width: 0, height: 0, getContext: vi.fn(() => nextContext) },
    ] as unknown as HTMLCanvasElement[];
    vi.spyOn(document, 'createElement').mockImplementation(() => canvases.shift()!);
    vi.stubGlobal('Image', class {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    });

    await remapBackgroundRemovalMask({
      fetch: vi.fn(),
      maskSrc: '/old-mask.png',
      source: { naturalWidth: 8, naturalHeight: 2 },
      previousFrame: { width: 400, height: 300, fitMode: 'contain' },
      nextFrame: { width: 200, height: 200, fitMode: 'contain' },
      id: 'image-1',
    });

    expect(sourceContext.drawImage.mock.calls[0].slice(1)).toEqual([0, 100, 400, 100]);
    expect(nextContext.drawImage.mock.calls[0][0]).toBeDefined();
    expect(nextContext.drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 8, 2, 0, 75, 200, 50]);
    expect(maskFrameAspectChanged({ width: 400, height: 300 }, { width: 200, height: 200 })).toBe(true);
    expect(maskFrameAspectChanged({ width: 400, height: 300 }, { width: 200, height: 150 })).toBe(false);
  });
});
