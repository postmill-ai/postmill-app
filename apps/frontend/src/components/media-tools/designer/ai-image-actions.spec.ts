import { describe, expect, it, vi } from 'vitest';
import { createDesignerStore, type DesignerElement } from './designer.store';
import { aiImageToImage, aiInpaint, aiRemoveBackground, aiUpscale, applyAiRemoveBackground } from './ai-image-actions';

const setup = () => {
  const store = createDesignerStore();
  store.getState().addElement({
    id: 'image-1',
    type: 'image',
    x: 10,
    y: 20,
    width: 300,
    height: 200,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    src: '/before.png',
    fileId: 'before-file',
    originalSrc: '/original.png',
    crop: { x: 40, y: 50, width: 700, height: 500 },
    fitMode: 'cover',
    focalPoint: { x: 0.3, y: 0.7 },
    smartFilters: [{ id: 'blur', params: { radius: 2 }, enabled: true }],
  } as DesignerElement);
  return store;
};

const element = (store: ReturnType<typeof createDesignerStore>) =>
  (store.getState().doc.outputs[0] as any).children[0] as DesignerElement;

const candidateFor = async (store: ReturnType<typeof createDesignerStore>) => aiRemoveBackground({
  store,
  elementId: 'image-1',
  fetch: vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ url: '/transparent.png', fileId: 'transparent-file' }),
  }),
  probe: async () => ({ width: 1200, height: 800 }),
});

describe('AI background removal review', () => {
  it('generates without editing, then applies original pixels plus the reviewed mask', async () => {
    const store = setup();
    const historyLength = store.getState().history.length;
    const candidate = await candidateFor(store);

    expect(candidate).not.toBeNull();
    expect(element(store).src).toBe('/before.png');
    expect(store.getState().history).toHaveLength(historyLength);
    await expect(applyAiRemoveBackground({
      store,
      candidate: candidate!,
      output: { width: 1080, height: 1080 },
      fetch: vi.fn(),
      createMask: async () => ({ src: '/mask.png', fileId: 'mask-file' }),
    })).resolves.toBe(true);
    expect(element(store)).toMatchObject({
      src: '/before.png',
      fileId: 'before-file',
      originalSrc: '/before.png',
      originalFileId: 'before-file',
      naturalWidth: 1200,
      naturalHeight: 800,
      maskSrc: '/mask.png',
      maskFileId: 'mask-file',
      maskEnabled: true,
      x: 10,
      y: 20,
      width: 300,
      height: 200,
      fitMode: 'cover',
    });
    expect(element(store).smartFilters).toBeUndefined();
    expect(store.getState().history).toHaveLength(historyLength + 1);
  });

  it('rejects an Apply after the source changes without creating a mask', async () => {
    const store = setup();
    const candidate = await candidateFor(store);
    store.getState().updateElement('image-1', { src: '/newer.png' });
    const createMask = vi.fn(async () => ({ src: '/mask.png', fileId: 'mask-file' }));

    await expect(applyAiRemoveBackground({
      store,
      candidate: candidate!,
      output: { width: 1080, height: 1080 },
      fetch: vi.fn(),
      createMask,
    })).resolves.toBe(false);
    expect(createMask).not.toHaveBeenCalled();
    expect(element(store).src).toBe('/newer.png');
  });

  it('discards an uploaded mask instead of overwriting a newer edit', async () => {
    const store = setup();
    const candidate = await candidateFor(store);
    let resolveMask!: (value: { src: string; fileId: string }) => void;
    const createMask = vi.fn(() => new Promise<{ src: string; fileId: string }>((resolve) => {
      resolveMask = resolve;
    }));
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const pending = applyAiRemoveBackground({
      store,
      candidate: candidate!,
      output: { width: 1080, height: 1080 },
      fetch,
      createMask,
    });
    store.getState().updateElement('image-1', { src: '/newer.png' });
    resolveMask({ src: '/mask.png', fileId: 'mask-file' });

    await expect(pending).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledWith('/files/mask-file', { method: 'DELETE' });
    expect(element(store).src).toBe('/newer.png');
  });

  it('keeps a paid result valid when persisted save adoption lands during generation', async () => {
    const store = setup();
    const sentDoc = store.getState().doc;
    const history = store.getState().history;
    let resolveResponse!: (value: unknown) => void;
    const response = new Promise((resolve) => { resolveResponse = resolve; });
    const pending = aiRemoveBackground({
      store,
      elementId: 'image-1',
      fetch: vi.fn().mockReturnValue(response),
      probe: async () => ({ width: 1200, height: 800 }),
    });
    const persistedDoc = JSON.parse(JSON.stringify(sentDoc));
    persistedDoc.outputs[0].name = 'Materialized by autosave';
    store.getState().adoptPersistedDoc(sentDoc, persistedDoc);
    resolveResponse({ ok: true, json: async () => ({ url: '/transparent.png' }) });

    await expect(pending).resolves.not.toBeNull();
    expect(store.getState().history).toBe(history);
  });

  it('does not return a candidate when the source changes during generation', async () => {
    const store = setup();
    let resolveResponse!: (value: unknown) => void;
    const response = new Promise((resolve) => { resolveResponse = resolve; });
    const pending = aiRemoveBackground({
      store,
      elementId: 'image-1',
      fetch: vi.fn().mockReturnValue(response),
      probe: async () => null,
    });
    store.getState().updateElement('image-1', { src: '/newer.png' });
    resolveResponse({ ok: true, json: async () => ({ url: '/stale.png' }) });

    await expect(pending).resolves.toBeNull();
    expect(element(store).src).toBe('/newer.png');
  });

  it('builds the mask at the reviewed frame geometry', async () => {
    const store = setup();
    const candidate = await candidateFor(store);
    const createMask = vi.fn(async () => ({ src: '/mask.png', fileId: 'mask-file' }));

    await applyAiRemoveBackground({
      store,
      candidate: candidate!,
      output: { width: 1080, height: 1080 },
      fetch: vi.fn(),
      createMask,
    });

    expect(createMask).toHaveBeenCalledWith(expect.objectContaining({
      frame: {
        width: 300,
        height: 200,
        crop: { x: 40, y: 50, width: 700, height: 500 },
        fitMode: 'cover',
        focalPoint: { x: 0.3, y: 0.7 },
      },
    }));
  });

  it('applies the flattened cutout when mask preparation fails', async () => {
    const store = setup();
    const candidate = await candidateFor(store);

    await expect(applyAiRemoveBackground({
      store,
      candidate: candidate!,
      output: { width: 1080, height: 1080 },
      fetch: vi.fn(),
      createMask: async () => { throw new Error('CORS blocked'); },
    })).resolves.toBe(true);

    expect(element(store)).toMatchObject({
      src: '/transparent.png',
      fileId: 'transparent-file',
      originalSrc: undefined,
      originalFileId: undefined,
      maskSrc: undefined,
      maskFileId: undefined,
      maskEnabled: undefined,
      fitMode: 'cover',
    });
  });
});


describe('direct image AI actions', () => {
  it('keeps request payloads and commits one labeled history entry per accepted result', async () => {
    const store = setup();
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: '/upscaled.png' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: '/inpainted.png' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: '/transformed.png' }) });
    const depth = store.getState().history.length;

    await expect(aiUpscale({ store, elementId: 'image-1', fetch }, 4)).resolves.toBe(true);
    await expect(aiInpaint(
      { store, elementId: 'image-1', fetch },
      { maskUrl: '/mask.png', prompt: 'replace this area' }
    )).resolves.toBe(true);
    await expect(aiImageToImage({ store, elementId: 'image-1', fetch }, 'make it a sketch')).resolves.toBe(true);

    expect(fetch.mock.calls.map(([path, init]) => ({ path, body: JSON.parse(String(init?.body)) }))).toEqual([
      { path: '/media/upscale', body: { imageUrl: '/before.png', scale: 4 } },
      { path: '/media/inpaint', body: { imageUrl: '/upscaled.png', maskUrl: '/mask.png', prompt: 'replace this area' } },
      { path: '/media/image-to-image', body: { imageUrl: '/inpainted.png', prompt: 'make it a sketch' } },
    ]);
    expect(element(store).src).toBe('/transformed.png');
    expect(store.getState().history).toHaveLength(depth + 3);
    expect(store.getState().historyLabels.slice(-3)).toEqual(['Upscale image', 'Inpaint image', 'Image to image']);
  });

  it('rejects a response after the source changes', async () => {
    const store = setup();
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    const pending = aiImageToImage({ store, elementId: 'image-1', fetch }, 'sketch');
    const depth = store.getState().history.length;
    store.getState().updateElement('image-1', { src: '/newer.png' });
    resolve({ ok: true, json: async () => ({ url: '/stale.png' }) } as Response);

    await expect(pending).resolves.toBe(false);
    expect(element(store).src).toBe('/newer.png');
    expect(store.getState().history).toHaveLength(depth);
  });

  it('rejects an older out-of-order response', async () => {
    const store = setup();
    const resolvers: ((response: Response) => void)[] = [];
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { resolvers.push(resolve); }));
    const first = aiUpscale({ store, elementId: 'image-1', fetch }, 2);
    const second = aiUpscale({ store, elementId: 'image-1', fetch }, 4);
    resolvers[1]({ ok: true, json: async () => ({ url: '/newest.png' }) } as Response);
    await expect(second).resolves.toBe(true);
    resolvers[0]({ ok: true, json: async () => ({ url: '/older.png' }) } as Response);

    await expect(first).resolves.toBe(false);
    expect(element(store).src).toBe('/newest.png');
    expect(store.getState().historyLabels.filter((label) => label === 'Upscale image')).toHaveLength(1);
  });

  it('resolves and updates an image on a later page', async () => {
    const store = setup();
    store.getState().addPage();
    store.getState().addElement({
      ...element(store),
      id: 'page-2-image',
      originId: undefined,
      src: '/page-2.png',
    });
    const depth = store.getState().history.length;
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: '/page-2-result.png' }) });

    await expect(aiImageToImage({ store, elementId: 'page-2-image', fetch }, 'watercolor')).resolves.toBe(true);
    expect((store.getState().doc.outputs[0] as any).pages[0].children[0].src).toBe('/page-2-result.png');
    expect(store.getState().history).toHaveLength(depth + 1);
  });
});
