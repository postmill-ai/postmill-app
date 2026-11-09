import { afterEach, describe, expect, it, vi } from 'vitest';
import { originalSubjectWithAlpha, preserveOutpaintSource } from './image-edit-pixels';

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

    await expect(preserveOutpaintSource({
      sourceUrl: '/original.png',
      generatedUrl: '/generated.png',
      sourceNatural: { width: 8, height: 2 },
      resultNatural: { width: 800, height: 200 },
      frame: { x: 400, y: 20, width: 400, height: 100, fitMode: 'fill' },
    })).resolves.toBe('data:image/png;base64,expanded');

    expect(context.drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 800, 200]);
    expect(context.drawImage.mock.calls[1].slice(1)).toEqual([0, 0, 8, 2, 400, 20, 400, 100]);
    expect(images).toHaveLength(2);
  });
});
