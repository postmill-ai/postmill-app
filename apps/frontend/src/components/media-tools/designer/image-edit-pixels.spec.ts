import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPageOutpaintExtension,
  originalSubjectWithAlpha,
  preserveOutpaintSource,
  rasterizeMediaFrame,
} from './image-edit-pixels';

describe('image edit pixel preservation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('draws original subject pixels through the provider alpha', async () => {
    const context = { drawImage: vi.fn(), globalCompositeOperation: 'source-over' };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => 'data:image/png;base64,subject'),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    vi.stubGlobal('Image', class {
      naturalWidth = 8;
      naturalHeight = 2;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });

    await expect(originalSubjectWithAlpha('/original.png', '/cutout.png')).resolves.toBe('data:image/png;base64,subject');

    expect(context.drawImage.mock.calls[0][0]).toBeInstanceOf(Image);
    expect(context.drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 8, 2]);
    expect(context.drawImage.mock.calls[1].slice(1)).toEqual([0, 0, 8, 2]);
    expect(context.globalCompositeOperation).toBe('destination-in');
  });

  it('draws generated expansion first and restores the exact original frame over it', async () => {
    const context = { drawImage: vi.fn(), globalCompositeOperation: 'source-over' };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => 'data:image/png;base64,expanded'),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    const images: HTMLImageElement[] = [];
    vi.stubGlobal('Image', class {
      naturalWidth = 8;
      naturalHeight = 2;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() { images.push(this as unknown as HTMLImageElement); }
      set src(value: string) {
        if (value.includes('generated')) {
          this.naturalWidth = 800;
          this.naturalHeight = 200;
        }
        queueMicrotask(() => this.onload?.());
      }
    });

    const result = await preserveOutpaintSource({
      sourceUrl: '/original.png',
      generatedUrl: '/generated.png',
      sourceNatural: { width: 8, height: 2 },
      resultNatural: { width: 800, height: 200 },
      frame: { x: 400, y: 20, width: 400, height: 100, fitMode: 'fill' },
    });
    expect(result.toDataURL()).toBe('data:image/png;base64,expanded');

    expect(context.drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 800, 200]);
    expect(context.drawImage.mock.calls[1].slice(1)).toEqual([0, 0, 8, 2, 400, 20, 400, 100]);
    expect(images).toHaveLength(2);
  });

  it('rasterizes the exact cropped display frame at native resolution, not 604×864 display pixels', async () => {
    const context = { drawImage: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context) };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    vi.stubGlobal('Image', class {
      naturalWidth = 1431;
      naturalHeight = 2048;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    const crop = { x: 143.1, y: 307.2, width: 1287.9, height: 1740.8 };

    const result = await rasterizeMediaFrame({
      sourceUrl: '/original.png',
      sourceNatural: { width: 1431, height: 2048 },
      frame: { x: 238, y: 108, width: 604, height: 864, crop, fitMode: 'cover' },
    });

    expect(result.natural).toEqual({ width: 1288, height: 1842 });
    const args = context.drawImage.mock.calls[0].slice(1);
    expect(args.slice(0, 4)).toEqual([143.1, 307.2, 1287.9, 1740.8]);
    expect(args[4]).toBe(0);
    expect(args[5]).toBeCloseTo(50.747, 3);
    expect(args[6]).toBeCloseTo(1287.9, 5);
    expect(args[7]).toBeCloseTo(1740.8, 5);
  });

  it('normalizes provider page dimensions and clears the complete original page composition', async () => {
    const context = { drawImage: vi.fn(), clearRect: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context) };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    vi.stubGlobal('Image', class {
      naturalWidth = 1000;
      naturalHeight = 700;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });

    await createPageOutpaintExtension({
      generatedUrl: '/generated.png',
      targetNatural: { width: 1080, height: 1620 },
      originalPage: { x: 0, y: 270, width: 1080, height: 1080 },
    });

    expect(context.drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 1080, 1620]);
    expect(context.clearRect).toHaveBeenCalledWith(0, 270, 1080, 1080);
  });
});
