import { describe, expect, it, vi } from 'vitest';
import { createDesignerStore, type VideoClip, type VideoOutput } from './designer.store';
import {
  clipMediaSourceMatches,
  imageReplacementPatch,
  removeClipImageBackground,
  replaceClipImage,
} from './clip-media';

const setup = () => {
  const store = createDesignerStore();
  store.getState().setMode('video');
  const output = store.getState().doc.outputs[0] as VideoOutput;
  const trackId = output.tracks[0].id;
  store.getState().addClip(0, trackId, {
    id: 'image',
    originId: 'origin',
    startMs: 250,
    endMs: 4250,
    trimInMs: 100,
    src: '/old.png',
    fileId: 'old-file',
    originalSrc: '/original.png',
    originalFileId: 'original-file',
    smartFilters: [{ id: 'blur', params: { radius: 4 }, enabled: true }],
    filters: ['sepia:0.2'],
    crop: { x: 1, y: 2, width: 20, height: 20 },
    x: 11,
    y: 12,
    width: 200,
    height: 100,
    rotation: 5,
    opacity: 0.8,
    naturalWidth: 40,
    naturalHeight: 20,
    keyframes: [{ tMs: 0, props: { x: 11 } }],
  } as VideoClip);
  return { store, trackId, target: { outputIndex: 0, trackId, clipId: 'image' } };
};

const clip = (store: ReturnType<typeof createDesignerStore>, trackId: string) =>
  (store.getState().doc.outputs[0] as VideoOutput).tracks.find((track) => track.id === trackId)!.clips[0];

describe('imageReplacementPatch', () => {
  it('changes only media state and clears stale crop/original/smart-filter state', () => {
    expect(imageReplacementPatch({
      url: '/new.png', fileId: 'new-file', width: 1600, height: 900,
    })).toEqual({
      src: '/new.png',
      fileId: 'new-file',
      mediaType: 'image',
      naturalWidth: 1600,
      naturalHeight: 900,
      crop: undefined,
      focalPoint: undefined,
      originalSrc: undefined,
      originalFileId: undefined,
      smartFilters: undefined,
    });
  });
});

describe('replaceClipImage', () => {
  it('probes missing intrinsic dimensions and preserves the clip editing state', async () => {
    const { store, trackId, target } = setup();
    const before = clip(store, trackId);
    await expect(replaceClipImage({
      store,
      target,
      item: { url: '/new.png', fileId: 'new-file' },
      probe: async () => ({ width: 1600, height: 900 }),
    })).resolves.toBe(true);
    expect(clip(store, trackId)).toMatchObject({
      id: before.id,
      originId: before.originId,
      startMs: before.startMs,
      endMs: before.endMs,
      trimInMs: before.trimInMs,
      x: before.x,
      y: before.y,
      width: before.width,
      height: before.height,
      keyframes: before.keyframes,
      filters: before.filters,
      src: '/new.png',
      fileId: 'new-file',
      naturalWidth: 1600,
      naturalHeight: 900,
    });
    expect(clip(store, trackId).crop).toBeUndefined();
    expect(clip(store, trackId).focalPoint).toBeUndefined();
  });

  it('rejects a pending result after another media edit is undone', async () => {
    const { store, trackId, target } = setup();
    let resolveProbe!: (value: { width: number; height: number }) => void;
    const pending = replaceClipImage({
      store,
      target,
      item: { url: '/pending.png' },
      probe: () => new Promise((resolve) => { resolveProbe = resolve; }),
    });
    store.getState().updateClipSilent(0, trackId, 'image', { src: '/newer.png' });
    store.getState().pushHistory();
    store.getState().undo();
    const historyLength = store.getState().history.length;
    expect(clip(store, trackId).src).toBe('/old.png');

    resolveProbe({ width: 1600, height: 900 });
    await expect(pending).resolves.toBe(false);
    expect(clip(store, trackId).src).toBe('/old.png');
    expect(store.getState().history).toHaveLength(historyLength);
  });
});

describe('removeClipImageBackground', () => {
  it('writes the transparent result only after success and preserves editing semantics', async () => {
    const { store, trackId, target } = setup();
    const before = clip(store, trackId);
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: '/transparent.png' }),
    });

    await expect(removeClipImageBackground({
      fetch, store, target, probe: async () => ({ width: 800, height: 600 }),
    })).resolves.toBe(true);

    const after = clip(store, trackId);
    expect(after).toMatchObject({
      id: before.id,
      originId: before.originId,
      startMs: before.startMs,
      endMs: before.endMs,
      trimInMs: before.trimInMs,
      x: before.x,
      y: before.y,
      width: before.width,
      height: before.height,
      rotation: before.rotation,
      opacity: before.opacity,
      filters: before.filters,
      keyframes: before.keyframes,
      src: '/transparent.png',
      mediaType: 'image',
      naturalWidth: 800,
      naturalHeight: 600,
    });
    expect(after.fileId).toBeUndefined();
    expect(after.crop).toBeUndefined();
    expect(after.originalSrc).toBeUndefined();
    expect(after.originalFileId).toBeUndefined();
    expect(after.smartFilters).toBeUndefined();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ imageUrl: '/old.png' });
  });

  it('surfaces provider errors without writing', async () => {
    const { store, trackId, target } = setup();
    const before = clip(store, trackId);
    await expect(removeClipImageBackground({
      store,
      target,
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Provider unavailable' }),
      }),
    })).rejects.toThrow('Provider unavailable');
    expect(clip(store, trackId)).toBe(before);
  });

  it('does not let an older result overwrite a newer media source', async () => {
    const { store, trackId, target } = setup();
    let resolveResponse!: (value: unknown) => void;
    const response = new Promise((resolve) => { resolveResponse = resolve; });
    const pending = removeClipImageBackground({
      store,
      target,
      fetch: vi.fn().mockReturnValue(response),
      probe: async () => null,
    });
    store.getState().updateClipSilent(0, trackId, 'image', { src: '/replacement.png' });
    resolveResponse({ ok: true, json: async () => ({ url: '/stale-transparent.png' }) });

    await expect(pending).resolves.toBe(false);
    expect(clip(store, trackId).src).toBe('/replacement.png');
  });
});

describe('clipMediaSourceMatches', () => {
  it('rejects a bake whose media identity or recipe changed in flight', () => {
    const before = { src: '/baked.png', originalSrc: '/original.png', smartFilters: [] };
    expect(clipMediaSourceMatches(before, before)).toBe(true);
    expect(clipMediaSourceMatches(before, { ...before, src: '/transparent.png' })).toBe(false);
    expect(clipMediaSourceMatches(before, { ...before, originalSrc: '/new.png' })).toBe(false);
    expect(clipMediaSourceMatches(before, undefined)).toBe(false);
  });
});
