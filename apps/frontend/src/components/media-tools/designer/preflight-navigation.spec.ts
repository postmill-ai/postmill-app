import { describe, expect, it, vi } from 'vitest';
import { createDesignerStore } from './designer.store';
import { openDesignerPreflightFinding } from './preflight-navigation';

describe('openDesignerPreflightFinding', () => {
  it('selects the static output, page, and element before closing', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'text-1', type: 'text', text: 'Check me', x: 0, y: 0, width: 100, height: 50,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().addPage('Page 2');
    const onClose = vi.fn();

    openDesignerPreflightFinding(store, {
      rule: 'low-contrast', key: 'test', vars: {}, outputIndex: 0, pageNumber: 1, elementId: 'text-1',
    }, onClose);

    expect(store.getState().currentOutput).toBe(0);
    expect(store.getState().currentPage).toBe(1);
    expect(store.getState().selectedIds).toEqual(['text-1']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('selects the video clip before closing', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const onClose = vi.fn();

    openDesignerPreflightFinding(store, {
      rule: 'text-overflow', key: 'test', vars: {}, outputIndex: 0, pageNumber: 0,
      clip: { trackId: 'track-1', clipId: 'clip-1' },
    }, onClose);

    expect(store.getState().selectedClip).toEqual({ outputIndex: 0, trackId: 'track-1', clipId: 'clip-1' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
