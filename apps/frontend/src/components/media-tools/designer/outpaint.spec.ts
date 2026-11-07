import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_SOURCE_MAX_BYTES } from '@postmill-ai/nestjs-libraries/dtos/ai/image-source.validator';
import { createDesignerStore } from './designer.store';
import {
  applyAiOutpaint,
  applyWholePageOutpaint,
  outpaintGeometry,
  prepareAiOutpaint,
  prepareWholePageOutpaint,
  type OutpaintCandidate,
} from './outpaint';

vi.mock('./elements', () => ({
  probeImageNaturalSize: vi.fn(async () => ({ width: 1600, height: 900 })),
}));
vi.mock('./background-removal-mask', () => ({
  loadMaskImage: vi.fn(async () => ({ naturalWidth: 800, naturalHeight: 450 })),
}));

const imageElement = () => ({
  id: 'image-1', type: 'image' as const, x: 100, y: 50, width: 400, height: 225,
  rotation: 0, opacity: 1, locked: false, hidden: false,
  src: '/photo.png', naturalWidth: 800, naturalHeight: 450,
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
  it('extends left while preserving the original content scale', () => {
    expect(outpaintGeometry(
      { x: 100, y: 50, width: 400, height: 225 },
      'left',
      { width: 800, height: 450 },
      { width: 1600, height: 900 }
    )).toEqual({ x: -300, y: 50, width: 800, height: 450 });
  });

  it('centers zoom and square expansion', () => {
    expect(outpaintGeometry(
      { x: 100, y: 50, width: 400, height: 225 },
      'zoom-2x',
      { width: 800, height: 450 },
      { width: 1600, height: 900 }
    )).toEqual({ x: -100, y: -62.5, width: 800, height: 450 });
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
    expect(after).toMatchObject({ x: -300, y: 50, width: 800, height: 450, src: '/expanded.png' });
    expect(store.getState().history).toHaveLength(history.length + 1);
  });

  it('prepares one request without changing the document', async () => {
    const store = createDesignerStore();
    store.getState().addElement(imageElement());
    const history = store.getState().history;
    const fetch = vi.fn(async () => response('/expanded.png'));

    await prepareAiOutpaint({ fetch, store, elementId: 'image-1', mode: 'left', prompt: ' more field ' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.getState().history).toBe(history);
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({
      imageUrl: '/photo.png', mode: 'left', prompt: 'more field',
    });
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

  it('composes the original page and mask, then translates every other layer with it', async () => {
    const store = createDesignerStore(1000, 500);
    store.getState().addElement(imageElement());
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
    expect(drawn.drawImage.mock.calls[0].slice(-4)).toEqual([350, 175, 400, 225]);
    expect(masked.fillRect).toHaveBeenLastCalledWith(350, 175, 400, 225);

    expect(applyWholePageOutpaint({ store, candidate })).toBe(true);
    const output = store.getState().doc.outputs[0] as any;
    expect(output).toMatchObject({ width: 1500, height: 750, name: '1500×750' });
    expect(output.children[0]).toMatchObject({ x: 0, y: 0, width: 1500, height: 750, src: '/expanded-page.png' });
    expect(output.children[1]).toMatchObject({ x: 255, y: 131, text: 'Keep me' });
    expect(store.getState().history).toHaveLength(history.length + 1);
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
