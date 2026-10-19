import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useDesignerActions, type DesignerActionCtx } from './actions';
import { createDesignerStore, type VideoOutput } from './designer.store';

/**
 * The Filter menu in a VIDEO document: pixel filters stay disabled (no
 * image-mode element selection exists there), and the clip-aware parallel
 * path toggles the six inspector filter tokens on the selected clip.
 */

const stubCtx = (): DesignerActionCtx =>
  ({
    showSafeZones: false,
    showRulers: false,
    showPagesBar: false,
    aiActive: false,
    canShare: false,
    collabEnabled: false,
    inModal: false,
    canEditPixels: () => false,
    hasLastFilter: () => false,
    lastFilterLabel: () => '',
    hasSmartFilters: () => false,
  }) as unknown as DesignerActionCtx;

const videoStoreWithClip = () => {
  const store = createDesignerStore();
  store.getState().setMode('video');
  const vo = store.getState().doc.outputs[0] as VideoOutput;
  const trackId = vo.tracks[0].id;
  store.getState().addClip(0, trackId, {
    id: 'c1',
    startMs: 0,
    endMs: 3000,
    src: 'https://example.com/v.mp4',
  } as never);
  return { store, trackId };
};

const clipFilters = (store: ReturnType<typeof createDesignerStore>, trackId: string) =>
  (store.getState().doc.outputs[0] as VideoOutput).tracks.find((t) => t.id === trackId)!
    .clips[0].filters;

describe('Filter menu — video clip path', () => {
  it('enables the clip filters when a clip is selected, and applies the token', () => {
    const { store, trackId } = videoStoreWithClip();
    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'c1' });
    const { result } = renderHook(() => useDesignerActions(store, stubCtx()));

    const grayscale = result.current.find((a) => a.id === 'clip-filter-grayscale')!;
    expect(grayscale.enabled?.()).toBe(true);
    expect(grayscale.checked?.()).toBe(false);

    grayscale.run();
    expect(clipFilters(store, trackId)).toEqual(['grayscale']);
    expect(grayscale.checked?.()).toBe(true);

    // Toggling again removes it.
    grayscale.run();
    expect(clipFilters(store, trackId)).toEqual([]);
  });

  it('writes valued tokens with the canonical default and replaces them on retoggle', () => {
    const { store, trackId } = videoStoreWithClip();
    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'c1' });
    const { result } = renderHook(() => useDesignerActions(store, stubCtx()));

    result.current.find((a) => a.id === 'clip-filter-blur')!.run();
    expect(clipFilters(store, trackId)).toEqual(['blur:2']);

    // A pre-existing value for the same prefix is replaced, not duplicated.
    result.current.find((a) => a.id === 'clip-filter-blur')!.run();
    expect(clipFilters(store, trackId)).toEqual([]);

    result.current.find((a) => a.id === 'clip-filter-saturate')!.run();
    result.current.find((a) => a.id === 'clip-filter-contrast')!.run();
    expect(clipFilters(store, trackId)).toEqual(['saturate:1.4', 'contrast:1.25']);
  });

  it('disables the clip filters with no clip selected, and the pixel filters in video mode regardless', () => {
    const { store, trackId } = videoStoreWithClip();
    const { result, rerender } = renderHook(() => useDesignerActions(store, stubCtx()));

    expect(result.current.find((a) => a.id === 'clip-filter-grayscale')!.enabled?.()).toBe(false);
    // The image-only pixel filters never come on in a video document.
    expect(result.current.find((a) => a.id === 'filter-blur')!.enabled?.()).toBe(false);

    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'c1' });
    rerender();
    expect(result.current.find((a) => a.id === 'clip-filter-grayscale')!.enabled?.()).toBe(true);
    expect(result.current.find((a) => a.id === 'filter-blur')!.enabled?.()).toBe(false);
  });

  it('runs through updateClip, so a menu filter is one undo step', () => {
    const { store, trackId } = videoStoreWithClip();
    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'c1' });
    const { result } = renderHook(() => useDesignerActions(store, stubCtx()));

    result.current.find((a) => a.id === 'clip-filter-sepia')!.run();
    expect(clipFilters(store, trackId)).toEqual(['sepia']);

    store.getState().undo();
    expect(clipFilters(store, trackId) ?? []).toEqual([]);
  });
});
