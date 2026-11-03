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

describe('AI background removal review', () => {
  it('generates without editing, then applies the reviewed result with fresh intrinsics', async () => {
    const store = setup();
    const historyLength = store.getState().history.length;
    const candidate = await aiRemoveBackground({
      store,
      elementId: 'image-1',
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ url: '/transparent.png', fileId: 'transparent-file' }),
      }),
      probe: async () => ({ width: 1200, height: 800 }),
    });

    expect(candidate).not.toBeNull();
    expect(element(store).src).toBe('/before.png');
    expect(store.getState().history).toHaveLength(historyLength);
    expect(applyAiRemoveBackground({
      store,
      candidate: candidate!,
      output: { width: 1080, height: 1080 },
    })).toBe(true);
    expect(element(store)).toMatchObject({
      src: '/transparent.png',
      fileId: 'transparent-file',
      naturalWidth: 1200,
      naturalHeight: 800,
      x: 10,
      y: 20,
      width: 300,
      height: 200,
      fitMode: 'contain',
    });
    expect(element(store).originalSrc).toBeUndefined();
    expect(element(store).smartFilters).toBeUndefined();
    expect(store.getState().history).toHaveLength(historyLength + 1);
  });

  it('rejects an Apply after the source changes', async () => {
    const store = setup();
    const candidate = await aiRemoveBackground({
      store,
      elementId: 'image-1',
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ url: '/transparent.png' }),
      }),
      probe: async () => null,
    });
    store.getState().updateElement('image-1', { src: '/newer.png' });

    expect(applyAiRemoveBackground({
      store,
      candidate: candidate!,
      output: { width: 1080, height: 1080 },
    })).toBe(false);
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
