import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyClipMagicGrab, applyStaticMagicGrab, uploadMagicGrabSourceMask } from './magic-grab';
import { removeClipImageBackground } from './clip-media';
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

  it('creates an opaque white-subject-on-black inpaint mask', async () => {
    const operations: string[] = [];
    const context = {
      fillStyle: '',
      globalCompositeOperation: '',
      fillRect: vi.fn(() => {
        operations.push(context.globalCompositeOperation);
      }),
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
    expect(operations).toContain('destination-over');
    expect(context.fillStyle).toBe('#000000');
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
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns false and cleans the background when a static insert is rejected', async () => {
    const store = createDesignerStore();
    const before = {
      id: 'missing', type: 'image' as const, x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, hidden: false, src: '/photo.png',
    };
    const fetch = vi.fn(async () => ({ ok: true }) as Response);

    const applied = await applyStaticMagicGrab({
      fetch,
      store,
      candidate: {
        before,
        history: store.getState().history,
        source: { url: '/photo.png', naturalWidth: 8, naturalHeight: 2 },
        asset: { url: '/cutout.png', naturalWidth: 8, naturalHeight: 2 },
        background: { url: '/background.png', fileId: 'background-file' },
        sourceMask: { src: '/source-mask.png', fileId: 'source-mask' },
      },
    });

    expect(applied).toBe(false);
    expect(fetch).toHaveBeenCalledWith('/media/magic-grab/cleanup', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ fileId: 'background-file' }),
    }));
  });

  it('applies a video subject and background when the clip still exists', async () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().addTrack(0, 'image');
    const track = (store.getState().doc.outputs[0] as any).tracks.find((item: any) => item.type === 'image');
    store.getState().addClip(0, track.id, {
      id: 'photo', startMs: 0, endMs: 3000, src: '/photo.png', mediaType: 'image',
      naturalWidth: 8, naturalHeight: 2,
    });
    const target = { outputIndex: 0, trackId: track.id, clipId: 'photo' };
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: '/cutout.png', fileId: 'cutout-file' }),
    }) as Response);
    const candidate = await removeClipImageBackground({ fetch, store, target, probe: async () => ({ width: 8, height: 2 }) });
    expect(candidate).toBeTruthy();

    const applied = await applyClipMagicGrab({
      fetch,
      store,
      target,
      candidate: {
        ...candidate!,
        asset: { ...candidate!.asset, url: '/cutout.png' },
        background: { url: '/background.png', fileId: 'background-file' },
        sourceMask: { src: '/source-mask.png', fileId: 'source-mask' },
      },
    });

    expect(applied).toBe(true);
    const output = store.getState().doc.outputs[0] as any;
    const backgroundTrack = output.tracks.find((track: any) => track.id === target.trackId);
    const selected = store.getState().selectedClip;
    const subjectTrack = output.tracks.find((track: any) => track.id === selected?.trackId);
    expect(backgroundTrack.clips[0]).toMatchObject({ src: '/background.png', fileId: 'background-file' });
    expect(subjectTrack.clips[0]).toMatchObject({
      id: selected?.clipId,
      src: '/photo.png',
      maskSrc: '/subject-mask.png',
    });
  });
});
