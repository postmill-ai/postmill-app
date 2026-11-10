import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_SOURCE_MAX_BYTES } from '@postmill-ai/nestjs-libraries/media/image-source.limits';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import { createDesignerStore } from './designer.store';
import {
  applyAiOutpaint,
  applyWholePageOutpaint,
  outpaintGeometry,
  prepareAiOutpaint,
  prepareWholePageOutpaint,
  type OutpaintCandidate,
} from './outpaint';
import {
  createPageOutpaintExtension,
  preserveOutpaintSource,
  rasterizeMediaFrame,
} from './image-edit-pixels';
import { commitCanvas } from './raster-layers';

vi.mock('./elements', () => ({
  probeImageNaturalSize: vi.fn(async () => ({ width: 1600, height: 900 })),
}));
vi.mock('./background-removal-mask', () => ({
  loadMaskImage: vi.fn(async () => ({ naturalWidth: 800, naturalHeight: 450 })),
}));
vi.mock('./image-edit-pixels', () => ({
  preserveOutpaintSource: vi.fn(async () => ({})),
  createPageOutpaintExtension: vi.fn(async () => ({})),
  rasterizeMediaFrame: vi.fn(async () => ({
    canvas: { toDataURL: () => 'data:image/png;base64,AAAA' },
    natural: { width: 800, height: 450 },
  })),
}));
vi.mock('./raster-layers', () => ({
  commitCanvas: vi.fn(async () => ({ src: '/uploads/org/preserved.png', fileId: 'preserved-file' })),
  reconcileBuffersWithDoc: vi.fn(),
}));

const imageElement = () => ({
  id: 'image-1', type: 'image' as const, x: 100, y: 50, width: 400, height: 225,
  rotation: 0, opacity: 1, locked: false, hidden: false,
  src: '/uploads/org/photo.png', naturalWidth: 800, naturalHeight: 450,
});
const otherElement = () => ({
  id: 'text-1', type: 'text' as const, text: 'Keep me', x: 5, y: 6, width: 100, height: 30,
  rotation: 0, opacity: 1, locked: false, hidden: false,
});

const response = (url: string) => ({ ok: true, json: async () => ({ url }) }) as Response;

const makeCandidate = (before: any, outputIndex = 0): OutpaintCandidate => ({
  kind: 'image', before, outputIndex, history: undefined,
  sourceUrl: before.src, assetUrl: '/expanded.png',
  sourceNatural: { width: 800, height: 450 }, resultNatural: { width: 1600, height: 900 },
  mode: 'left',
});

describe('outpaintGeometry', () => {
  it('extends left without changing the displayed content height', () => {
    expect(outpaintGeometry(
      { x: 100, y: 50, width: 400, height: 225 },
      'left'
    )).toEqual({ x: -300, y: 50, width: 800, height: 225 });
  });

  it('centers zoom and square expansion', () => {
    expect(outpaintGeometry(
      { x: 100, y: 50, width: 400, height: 225 },
      'zoom-2x'
    )).toEqual({ x: -100, y: -62.5, width: 800, height: 450 });
    expect(outpaintGeometry(
      { x: 100, y: 50, width: 400, height: 225 },
      'make-square'
    )).toEqual({ x: 100, y: -37.5, width: 400, height: 400 });
  });
});

describe('image expansion', () => {
  it('does not edit during preparation and commits geometry once on Apply', () => {
    const store = createDesignerStore();
    store.getState().addElement(imageElement());
    const before = (store.getState().doc.outputs[0] as any).children[0];
    const history = store.getState().history;
    const candidate = { ...makeCandidate(before), history };

    expect(applyAiOutpaint({ store, candidate })).toBe(true);

    const after = (store.getState().doc.outputs[0] as any).children[0];
    expect(after).toMatchObject({ x: -300, y: 50, width: 800, height: 225, src: '/expanded.png' });
    expect(store.getState().history).toHaveLength(history.length + 1);
  });

  it('sends the rasterized display frame and saves the referenced result as internal', async () => {
    const store = createDesignerStore();
    store.getState().addElement(imageElement());
    const history = store.getState().history;
    const fetch = vi.fn(async () => response('/expanded.png'));

    await prepareAiOutpaint({ fetch, store, elementId: 'image-1', mode: 'left', prompt: ' more field ' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.getState().history).toBe(history);
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({
      imageUrl: 'data:image/png;base64,AAAA', mode: 'left', prompt: 'more field',
    });
    expect(commitCanvas).toHaveBeenCalledWith({}, 'image-1:outpaint', fetch, { internal: 'design-asset' });
  });

  it('preserves the production crop, aspect ratio, Undo, and serialized reopen despite provider dimensions', async () => {
    const crop = { x: 143.1, y: 307.2, width: 1287.9, height: 1740.8 };
    const store = createDesignerStore();
    store.getState().addElement({
      ...imageElement(),
      x: 238,
      y: 108,
      width: 604,
      height: 864,
      naturalWidth: 1431,
      naturalHeight: 2048,
      crop,
      fitMode: 'cover' as const,
    });
    vi.mocked(rasterizeMediaFrame).mockResolvedValueOnce({
      canvas: { toDataURL: () => 'data:image/png;base64,AAAA' } as HTMLCanvasElement,
      natural: { width: 1288, height: 1741 },
    });
    const fetch = vi.fn(async () => response('/expanded.png'));

    const candidate = await prepareAiOutpaint({ fetch, store, elementId: 'image-1', mode: 'right' });

    expect(rasterizeMediaFrame).toHaveBeenCalledWith({
      sourceUrl: '/uploads/org/photo.png',
      sourceNatural: { width: 1431, height: 2048 },
      frame: expect.objectContaining({ width: 604, height: 864, crop, fitMode: 'cover' }),
    });
    expect(candidate.resultNatural).toEqual({ width: 2576, height: 1741 });
    expect(preserveOutpaintSource).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceUrl: 'data:image/png;base64,AAAA',
      generatedUrl: '/expanded.png',
      sourceNatural: { width: 1288, height: 1741 },
      resultNatural: { width: 2576, height: 1741 },
      frame: expect.objectContaining({ x: 0, y: 0, fitMode: 'fill' }),
    }));
    const restore = vi.mocked(preserveOutpaintSource).mock.calls.at(-1)![0];
    expect(restore.frame.width).toBeCloseTo(1288, 8);
    expect(restore.frame.height).toBeCloseTo(1741, 8);

    expect(applyAiOutpaint({ store, candidate })).toBe(true);
    let current = (store.getState().doc.outputs[0] as any).children[0];
    expect(current).toMatchObject({
      x: 238,
      y: 108,
      width: 1208,
      height: 864,
      naturalWidth: 2576,
      naturalHeight: 1741,
      crop: undefined,
    });

    store.getState().undo();
    current = (store.getState().doc.outputs[0] as any).children[0];
    expect(current).toMatchObject({ x: 238, y: 108, width: 604, height: 864, crop, fitMode: 'cover' });
    store.getState().redo();

    const saved = JSON.parse(JSON.stringify(store.getState().doc));
    expect(() => new DesignerDocService().validate(saved)).not.toThrow();
    const reopened = createDesignerStore();
    reopened.getState().setDoc(saved);
    current = (reopened.getState().doc.outputs[0] as any).children[0];
    expect(current).toMatchObject({
      x: 238,
      y: 108,
      width: 1208,
      height: 864,
      naturalWidth: 2576,
      naturalHeight: 1741,
    });
  });

  it('upscales a small provider source uniformly and preserves the result geometry', async () => {
    const store = createDesignerStore();
    store.getState().addElement(imageElement());
    const originalCanvas = {} as HTMLCanvasElement;
    const context = { drawImage: vi.fn() };
    const providerCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => 'data:image/png;base64,AAAA'),
    };
    vi.mocked(rasterizeMediaFrame).mockResolvedValueOnce({
      canvas: originalCanvas,
      natural: { width: 120, height: 80 },
    });
    const createElement = vi.spyOn(document, 'createElement').mockReturnValueOnce(providerCanvas as any);
    const fetch = vi.fn(async () => response('/expanded.png'));

    try {
      const candidate = await prepareAiOutpaint({ fetch, store, elementId: 'image-1', mode: 'right' });

      expect(providerCanvas).toMatchObject({ width: 384, height: 256 });
      expect(context.drawImage).toHaveBeenCalledWith(originalCanvas, 0, 0, 384, 256);
      expect(candidate.resultNatural).toEqual({ width: 768, height: 256 });
      expect(preserveOutpaintSource).toHaveBeenLastCalledWith(expect.objectContaining({
        sourceNatural: { width: 384, height: 256 },
        resultNatural: { width: 768, height: 256 },
      }));
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      createElement.mockRestore();
    }
  });

  it('rejects an extreme aspect ratio locally before a paid provider request', async () => {
    const store = createDesignerStore();
    store.getState().addElement(imageElement());
    vi.mocked(rasterizeMediaFrame).mockResolvedValueOnce({
      canvas: {} as HTMLCanvasElement,
      natural: { width: 1, height: 5000 },
    });
    const fetch = vi.fn(async () => response('/expanded.png'));

    await expect(prepareAiOutpaint({ fetch, store, elementId: 'image-1', mode: 'right' }))
      .rejects.toThrow('too narrow to upscale safely');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cleans the uploaded candidate when the design changes during preparation', async () => {
    const store = createDesignerStore();
    store.getState().addElement(imageElement());
    vi.mocked(commitCanvas).mockImplementationOnce(async () => {
      store.getState().pushHistory('Concurrent edit');
      return { src: '/uploads/org/preserved.png', fileId: 'preserved-file' };
    });
    const fetch = vi.fn(async () => response('/expanded.png'));

    await expect(prepareAiOutpaint({ fetch, store, elementId: 'image-1', mode: 'right' }))
      .rejects.toThrow('design changed');

    expect(fetch.mock.calls[1][0]).toBe('/media/outpaint/cleanup');
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({ fileId: 'preserved-file' });
  });
});

describe('whole-page expansion', () => {
  let contexts: any[];

  beforeEach(() => {
    contexts = [];
    vi.spyOn(document, 'createElement').mockImplementation(() => {
      const current = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
      contexts.push(current);
      return {
        width: 0,
        height: 0,
        getContext: vi.fn(() => current),
        toDataURL: vi.fn(() => 'data:image/png;base64,AAAA'),
      } as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('masks only the original page and preserves its selected image, other layers, and background', async () => {
    const crop = { x: 80, y: 45, width: 640, height: 360 };
    const store = createDesignerStore(1000, 500);
    store.getState().addElement({ ...imageElement(), crop });
    store.getState().addElement(otherElement());
    const history = store.getState().history;
    const fetch = vi.fn(async () => response('/expanded-page.png'));

    const candidate = await prepareWholePageOutpaint({
      fetch, store, elementId: 'image-1', targetWidth: 1500, targetHeight: 750,
    });

    expect(store.getState().history).toBe(history);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(candidate).toMatchObject({ kind: 'page', targetWidth: 1500, targetHeight: 750 });
    const drawn = contexts.find((item) => item.drawImage.mock.calls.length);
    const masked = contexts.find((item) => item.fillRect.mock.calls.some((call: number[]) => call[0] === 350));
    expect(drawn.drawImage.mock.calls[0].slice(1, 5)).toEqual([80, 45, 640, 360]);
    expect(drawn.drawImage.mock.calls[0].slice(-4)).toEqual([350, 175, 400, 225]);
    expect(masked.fillRect).toHaveBeenLastCalledWith(350, 175, 400, 225);
    expect(createPageOutpaintExtension).toHaveBeenCalledWith({
      generatedUrl: '/expanded-page.png',
      targetNatural: { width: 1500, height: 750 },
      originalPage: { x: 250, y: 125, width: 1000, height: 500 },
    });
    expect(commitCanvas).toHaveBeenCalledWith({}, 'image-1:outpaint-page', fetch, { internal: 'design-asset' });

    expect(applyWholePageOutpaint({ store, candidate })).toBe(true);
    const output = store.getState().doc.outputs[0] as any;
    expect(output).toMatchObject({ width: 1500, height: 750, name: '1500×750', background: '#ffffff' });
    expect(output.children).toHaveLength(3);
    expect(output.children[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 1500,
      height: 750,
      src: '/uploads/org/preserved.png',
      fileId: 'preserved-file',
      name: 'Generated page extension',
    });
    expect(output.children[1]).toMatchObject({
      id: 'image-1',
      x: 350,
      y: 175,
      width: 400,
      height: 225,
      src: '/uploads/org/photo.png',
      naturalWidth: 800,
      naturalHeight: 450,
      crop,
    });
    expect(output.children[2]).toMatchObject({ x: 255, y: 131, text: 'Keep me' });
    expect(store.getState().history).toHaveLength(history.length + 1);
    expect(() => new DesignerDocService().validate(store.getState().doc)).not.toThrow();

    store.getState().undo();
    const undone = store.getState().doc.outputs[0] as any;
    expect(undone).toMatchObject({ width: 1000, height: 500, background: '#ffffff' });
    expect(undone.children).toHaveLength(2);
    expect(undone.children[0]).toMatchObject({ x: 100, y: 50, crop });
    store.getState().redo();
    const reopened = createDesignerStore();
    reopened.getState().setDoc(JSON.parse(JSON.stringify(store.getState().doc)));
    expect((reopened.getState().doc.outputs[0] as any).children).toHaveLength(3);
  });

  it('rejects oversized whole-page compositions before reading or uploading the image', async () => {
    const store = createDesignerStore(1000, 500);
    store.getState().addElement(imageElement());
    const fetch = vi.fn(async () => response('/expanded-page.png'));

    await expect(prepareWholePageOutpaint({
      fetch, store, elementId: 'image-1', targetWidth: 5001, targetHeight: 5000,
    })).rejects.toThrow('25 million pixels');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an inline image over the server decoded-size cap', async () => {
    const store = createDesignerStore(1000, 500);
    store.getState().addElement(imageElement());
    const fetch = vi.fn(async () => response('/expanded-page.png'));
    const data = `data:image/png;base64,${'A'.repeat(Math.floor((IMAGE_SOURCE_MAX_BYTES / 3) * 4) + 1)}`;
    vi.mocked(document.createElement).mockImplementation(() => ({
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() })),
      toDataURL: vi.fn(() => data),
    }) as any);

    await expect(prepareWholePageOutpaint({
      fetch, store, elementId: 'image-1', targetWidth: 1500, targetHeight: 750,
    })).rejects.toThrow('20 MB image upload limit');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a combined request over 45 MB even when each image fits its own cap', async () => {
    const store = createDesignerStore(1000, 500);
    store.getState().addElement(imageElement());
    const fetch = vi.fn(async () => response('/expanded-page.png'));
    const data = `data:image/png;base64,${'A'.repeat(24 * 1024 * 1024)}`;
    vi.mocked(document.createElement).mockImplementation(() => ({
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() })),
      toDataURL: vi.fn(() => data),
    }) as any);

    await expect(prepareWholePageOutpaint({
      fetch, store, elementId: 'image-1', targetWidth: 1500, targetHeight: 750,
    })).rejects.toThrow('45 MB combined upload limit');
    expect(fetch).not.toHaveBeenCalled();
  });
});
