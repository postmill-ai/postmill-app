import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useDesignerActions, type DesignerActionCtx } from './actions';
import {
  createDesignerStore,
  type DesignerElement,
  type DesignerOutput,
} from './designer.store';

/**
 * The Filter menu's empty state. With nothing selected, the ~47
 * descriptor-generated items would all render grey and read as broken — image
 * mode instead shows a single enabled pointer at what to do. Video mode keeps
 * its Clip submenu behaviour and is untouched by this.
 */

const stubCtx = (canEditPixels = false): DesignerActionCtx =>
  ({
    showSafeZones: false,
    showRulers: false,
    showPagesBar: false,
    aiActive: false,
    canShare: false,
    collabEnabled: false,
    inModal: false,
    canEditPixels: () => canEditPixels,
    hasLastFilter: () => false,
    lastFilterLabel: () => '',
    hasSmartFilters: () => false,
  }) as unknown as DesignerActionCtx;

const shape = (): DesignerElement => ({
  id: '',
  type: 'shape',
  shape: 'rect',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
});

const filterItems = (actions: { menu: string; id: string }[]) =>
  actions.filter((a) => a.menu === 'filter');

describe('Filter menu — nothing selected', () => {
  it('shows one enabled explanatory item instead of the all-grey family list', () => {
    const store = createDesignerStore();
    const { result } = renderHook(() => useDesignerActions(store, stubCtx(false)));

    const items = filterItems(result.current);
    const hint = items.find((a) => a.id === 'filter-select-layer-hint');
    expect(hint).toBeDefined();
    expect(hint!.enabled?.() ?? true).toBe(true);
    // The descriptor-generated families are replaced, not just disabled.
    expect(items.some((a) => a.id.startsWith('filter-') && a.id !== 'filter-select-layer-hint'
      && a.id !== 'filter-last' && a.id !== 'filter-flatten')).toBe(false);
    // The video-mode Clip submenu items stay — they are inert without a clip.
    expect(items.some((a) => a.id === 'clip-filter-blur')).toBe(true);
  });

  it('restores the family list once a layer is selected', () => {
    const store = createDesignerStore();
    const { result, rerender } = renderHook(() => useDesignerActions(store, stubCtx(true)));

    store.getState().addElement(shape());
    rerender();

    const items = filterItems(result.current);
    expect(items.find((a) => a.id === 'filter-select-layer-hint')).toBeUndefined();
    expect(items.filter((a) => a.id.startsWith('filter-')).length).toBeGreaterThan(40);
  });

  it('keeps the full (disabled) list in video mode, where the Clip submenu is the live path', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const { result } = renderHook(() => useDesignerActions(store, stubCtx(false)));

    const items = filterItems(result.current);
    expect(items.find((a) => a.id === 'filter-select-layer-hint')).toBeUndefined();
    expect(items.filter((a) => a.id.startsWith('filter-')).length).toBeGreaterThan(40);
    expect(items.filter((a) => a.id.startsWith('clip-filter-'))).toHaveLength(6);
  });
});
