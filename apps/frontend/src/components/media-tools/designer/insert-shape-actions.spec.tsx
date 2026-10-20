import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useDesignerActions, type DesignerActionCtx } from './actions';
import {
  createDesignerStore,
  type DesignerOutput,
  type VideoOutput,
} from './designer.store';

/**
 * Insert ▸ Shapes and the Layer menu across the two document modes: shapes are
 * dual-mode (element in an image doc, shape clip at the playhead in a video
 * doc), while the element-mutating Layer actions are honestly disabled in a
 * video doc instead of dead-clicking into the store's no-op guards.
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

const SHAPE_IDS = [
  'insert-shape',
  'insert-ellipse',
  'insert-triangle',
  'insert-polygon',
  'insert-star',
  'insert-line',
];

describe('Insert ▸ Shapes', () => {
  it('lands a shape clip on a shape track at the playhead in a video document', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().setPlayhead(1500);
    const { result } = renderHook(() => useDesignerActions(store, stubCtx()));

    for (const id of SHAPE_IDS) {
      expect(result.current.find((a) => a.id === id)!.enabled?.()).not.toBe(false);
    }

    result.current.find((a) => a.id === 'insert-star')!.run();

    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const shapeTrack = vo.tracks.find((t) => t.type === 'shape')!;
    expect(shapeTrack).toBeDefined();
    const clip = shapeTrack.clips[0];
    expect(clip.shape).toBe('star');
    expect(clip.sides).toBeGreaterThan(0);
    expect(clip.startMs).toBe(1500);
    expect(clip.fill).toBeTruthy();
    // Centered on the canvas.
    expect(clip.x).toBe(Math.round(vo.width / 2 - 70));
    // The new clip becomes the timeline selection.
    expect(store.getState().selectedClip).toEqual({
      outputIndex: 0,
      trackId: shapeTrack.id,
      clipId: clip.id,
    });
  });

  it('still inserts an element in an image document', () => {
    const store = createDesignerStore();
    const { result } = renderHook(() => useDesignerActions(store, stubCtx()));

    result.current.find((a) => a.id === 'insert-shape')!.run();

    const out = store.getState().doc.outputs[0] as DesignerOutput;
    const el = out.children.at(-1)!;
    expect(el.type).toBe('shape');
    expect(el.shape).toBe('rect');
    expect(store.getState().selectedIds).toEqual([el.id]);
  });
});

describe('Layer menu — video mode gating', () => {
  it('disables the element-mutating layer actions in a video document', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const { result } = renderHook(() => useDesignerActions(store, stubCtx()));

    for (const id of [
      'layer-new-layer',
      'layer-new-group',
      'layer-fill-solid',
      'layer-fill-gradient',
      'layer-fill-pattern',
      'layer-adj-brightness-contrast',
      'layer-clip',
    ]) {
      expect(result.current.find((a) => a.id === id)!.enabled?.()).toBe(false);
    }

    // New ▸ Artboard is the one exception: addOutput clones the timeline onto
    // a new format in video mode, so it stays live.
    expect(result.current.find((a) => a.id === 'layer-new-artboard')!.enabled?.()).not.toBe(false);
  });

  it('keeps them enabled in an image document', () => {
    const store = createDesignerStore();
    const { result } = renderHook(() => useDesignerActions(store, stubCtx()));

    for (const id of ['layer-new-layer', 'layer-new-group', 'layer-fill-solid']) {
      expect(result.current.find((a) => a.id === id)!.enabled?.()).not.toBe(false);
    }

    result.current.find((a) => a.id === 'layer-new-layer')!.run();
    const out = store.getState().doc.outputs[0] as DesignerOutput;
    expect(out.children.at(-1)!.type).toBe('fill');
  });
});
