import { describe, expect, it, vi } from 'vitest';
import { createDesignerStore, type DesignerElement } from './designer.store';
import { aiRemoveBackground, applyAiRemoveBackground } from './ai-image-actions';

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
      fitMode: 'contain',
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
});
