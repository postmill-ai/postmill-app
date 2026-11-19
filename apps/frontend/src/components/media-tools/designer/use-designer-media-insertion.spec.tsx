import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { MediaSelectorItem } from '@postmill-ai/frontend/components/media-tools/media-selector-modal';
import { createDesignerStore } from './designer.store';
import { useDesignerMediaInsertion } from './use-designer-media-insertion';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  show: vi.fn(),
  importStock: vi.fn(),
  addImage: vi.fn(),
  addImageClip: vi.fn(),
  addMedia: vi.fn(),
}));

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({ useFetch: () => mocks.fetch }));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({ useToaster: () => ({ show: mocks.show }) }));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@postmill-ai/frontend/components/media-tools/media-import', () => ({
  useImportStockMedia: () => mocks.importStock,
}));
vi.mock('./insert-image', () => ({ addImageElementFromMedia: mocks.addImage }));
vi.mock('./add-media-to-timeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./add-media-to-timeline')>()),
  addImageClipToTimeline: mocks.addImageClip,
  addMediaToTimeline: mocks.addMedia,
}));

const item = (overrides: Partial<MediaSelectorItem> = {}): MediaSelectorItem => ({
  source: 'stock',
  url: 'https://cdn.example.test/photo.png',
  width: 1200,
  height: 800,
  type: 'image',
  stockSource: 'unsplash',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.addMedia.mockResolvedValue(null);
});

describe('useDesignerMediaInsertion', () => {
  it('places a static photo as an aspect-correct image element at the drop point', async () => {
    const store = createDesignerStore(400, 300);
    const { result } = renderHook(() => useDesignerMediaInsertion(store));
    const at = { x: 140, y: 120 };

    await result.current('image', item(), at);

    expect(mocks.addImage).toHaveBeenCalledWith(store, expect.objectContaining({
      url: item().url,
      width: 1200,
      height: 800,
      at,
    }));
    expect(mocks.importStock).not.toHaveBeenCalled();
  });

  it('routes static images and square icons to image clips at the drop point in video documents', async () => {
    const store = createDesignerStore(400, 300);
    store.getState().setMode('video');
    const { result } = renderHook(() => useDesignerMediaInsertion(store));
    const at = { x: 140, y: 120 };

    await result.current('sticker', item(), at);
    await result.current('icon', item({ url: 'https://api.iconify.design/mdi/home.svg', width: 24, height: 24 }), at);

    expect(mocks.addImageClip).toHaveBeenNthCalledWith(1, store, expect.objectContaining({ square: false, at }));
    expect(mocks.addImageClip).toHaveBeenNthCalledWith(2, store, expect.objectContaining({ square: true, at }));
  });

  it('resolves an editable static icon and centers it on the drop point', async () => {
    const store = createDesignerStore(400, 300);
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ body: '<svg />', viewBox: '0 0 24 24' }) });
    const { result } = renderHook(() => useDesignerMediaInsertion(store));

    await result.current('icon', item({ url: 'https://api.iconify.design/mdi/home.svg' }), { x: 150, y: 100 });

    const output = store.getState().doc.outputs[0];
    expect(output.children[0]).toMatchObject({
      type: 'icon', src: '<svg />', viewBox: '0 0 24 24',
      x: 120, y: 70, width: 60, height: 60,
    });
  });

  it('imports a direct stock vector once but does not re-import a picker-resolved file', async () => {
    const store = createDesignerStore(400, 300);
    const imported = item({ source: 'file', fileId: 'vector-file', url: '/uploads/vector.png' });
    mocks.importStock.mockResolvedValue(imported);
    const { result } = renderHook(() => useDesignerMediaInsertion(store));

    await result.current('vector', item({ url: 'https://cdn.example.test/vector.svg' }));
    await result.current('vector', imported);

    expect(mocks.importStock).toHaveBeenCalledTimes(1);
    expect(mocks.addImage).toHaveBeenCalledTimes(2);
    expect(mocks.addImage).toHaveBeenLastCalledWith(store, expect.objectContaining({ fileId: 'vector-file' }));
  });

  it('keeps vector import failures out of the document', async () => {
    const store = createDesignerStore(400, 300);
    mocks.importStock.mockRejectedValue(new Error('Import unavailable'));
    const { result } = renderHook(() => useDesignerMediaInsertion(store));

    await result.current('vector', item());

    expect(mocks.addImage).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledWith('Import unavailable', 'warning');
  });

  it.each([
    ['video', item({ type: 'video', url: '/video.mp4' })],
    ['audio', item({ type: 'audio', url: '/audio.mp3', width: 0, height: 0 })],
  ] as const)('rejects %s without changing a populated image design', async (kind, picked) => {
    const store = createDesignerStore(400, 300);
    store.getState().addElement({
      id: 'existing-text', type: 'text', text: 'Keep me', x: 20, y: 20, width: 200, height: 50,
    } as never);
    const before = store.getState().doc;
    const { result } = renderHook(() => useDesignerMediaInsertion(store));

    await result.current(kind, picked, { x: 200, y: 150 });

    expect(store.getState().doc).toBe(before);
    expect(store.getState().doc.mode).toBe('image');
    expect(store.getState().doc.outputs[0].children[0]).toMatchObject({ id: 'existing-text', text: 'Keep me' });
    expect(mocks.addMedia).not.toHaveBeenCalled();
    expect(mocks.addImage).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledWith(
      'This media requires a video design. Your image design has not been changed.',
      'warning'
    );
  });

  it('inserts an animated sticker as its static thumbnail in an image design', async () => {
    const store = createDesignerStore(400, 300);
    store.getState().addElement({ id: 'existing-text', type: 'text', text: 'Keep me' } as never);
    const { result } = renderHook(() => useDesignerMediaInsertion(store));
    const at = { x: 200, y: 150 };

    await result.current('sticker', item({
      type: 'video', url: '/sticker.mp4', thumbnail: '/sticker.png',
    }), at);

    expect(store.getState().doc.mode).toBe('image');
    expect(store.getState().doc.outputs[0].children[0]).toMatchObject({ id: 'existing-text', text: 'Keep me' });
    expect(mocks.addMedia).not.toHaveBeenCalled();
    expect(mocks.addImage).toHaveBeenCalledWith(store, expect.objectContaining({
      url: '/sticker.png', width: undefined, height: undefined, at,
    }));
  });

  it('rejects an animated sticker without a static thumbnail in an image design', async () => {
    const store = createDesignerStore(400, 300);
    const before = store.getState().doc;
    const { result } = renderHook(() => useDesignerMediaInsertion(store));

    await result.current('sticker', item({ type: 'video', url: '/sticker.mp4' }));

    expect(store.getState().doc).toBe(before);
    expect(mocks.addMedia).not.toHaveBeenCalled();
    expect(mocks.addImage).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledWith(expect.stringContaining('requires a video design'), 'warning');
  });

  it('routes videos, audio, and animated stickers to their real timeline media types in video designs', async () => {
    const store = createDesignerStore(400, 300);
    store.getState().setMode('video');
    const { result } = renderHook(() => useDesignerMediaInsertion(store));
    const at = { x: 200, y: 150 };

    await result.current('sticker', item({ type: 'video', url: '/sticker.mp4' }), at);
    await result.current('video', item({ type: 'video', url: '/video.mp4' }));
    await result.current('audio', item({ type: 'audio', url: '/audio.mp3', width: 0, height: 0 }));

    expect(mocks.addMedia).toHaveBeenNthCalledWith(1, store, expect.objectContaining({
      type: 'video', url: '/sticker.mp4', sticker: true, at,
    }));
    expect(mocks.addMedia).toHaveBeenNthCalledWith(2, store, expect.objectContaining({ type: 'video', url: '/video.mp4' }));
    expect(mocks.addMedia).toHaveBeenNthCalledWith(3, store, expect.objectContaining({ type: 'audio', url: '/audio.mp3' }));
  });

  it('retains the existing metadata-probe warning', async () => {
    const store = createDesignerStore(400, 300);
    store.getState().setMode('video');
    mocks.addMedia.mockResolvedValue({ probeFailed: true });
    const { result } = renderHook(() => useDesignerMediaInsertion(store));

    await result.current('video', item({ type: 'video' }));

    expect(mocks.show).toHaveBeenCalledWith(expect.stringContaining('default duration'), 'warning');
  });
});
