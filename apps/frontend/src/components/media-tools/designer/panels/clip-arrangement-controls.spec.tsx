import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClipInspector } from './clip-inspector';
import { createDesignerStore } from '../designer.store';
import { ContextMenu } from '../context-menu';
import type { VideoOutput, VideoTrack } from '../designer.store';

const toasterShow = vi.hoisted(() => vi.fn());

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: toasterShow }),
}));
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));
vi.mock('@postmill-ai/frontend/components/layout/use-media-tools-status', () => ({
  useMediaToolsStatus: () => ({ operationAvailable: () => false }),
}));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn() }),
}));
vi.mock('../../use-media-picker', () => ({
  useMediaPicker: () => ({ open: vi.fn(), close: vi.fn(), element: null }),
}));

const clip = (id: string, over = {}) => ({ id, startMs: 0, endMs: 1000, ...over });
const track = (
  id: string,
  type: VideoTrack['type'],
  over: Partial<VideoTrack> = {}
): VideoTrack => ({ id, type, clips: [clip(`${id}-clip`)], ...over });

const makeStore = (over: Partial<VideoOutput> = {}) => {
  const store = createDesignerStore();
  store.getState().loadDesign({
    version: 14,
    mode: 'video',
    outputs: [{
      id: 'output',
      formatId: 'square',
      name: 'Square',
      width: 500,
      height: 500,
      fps: 30,
      durationMs: 10000,
      tracks: [
        track('a', 'video'),
        track('b', 'shape'),
        track('c', 'text'),
        track('d', 'image'),
      ],
      ...over,
    }],
  }, 'design', 'Arrange controls');
  return store;
};

describe('ClipInspector layer order controls', () => {
  beforeEach(() => toasterShow.mockClear());

  it('wires the canvas clip context menu to the same atomic action', () => {
    const store = makeStore({ tracks: [track('a', 'video'), track('b', 'shape')] });
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={20}
        y={20}
        targetType="clip"
        elementId="a-clip"
        store={store}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Bring Forward', exact: true }));
    expect((store.getState().doc.outputs[0] as VideoOutput).tracks.map((item) => item.id))
      .toEqual(['b', 'a']);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('arranges the full multi-selection rather than only the primary Inspector clip', () => {
    const store = makeStore();
    const refs = [
      { trackId: 'a', clipId: 'a-clip' },
      { trackId: 'c', clipId: 'c-clip' },
    ];
    store.getState().setSelectedClips(refs, refs[0]);
    render(<ClipInspector store={store} outputIndex={0} trackId="a" clipId="a-clip" />);

    fireEvent.click(screen.getByRole('button', { name: 'Bring forward', exact: true }));
    expect((store.getState().doc.outputs[0] as VideoOutput).tracks.map((item) => item.id))
      .toEqual(['b', 'd', 'a', 'c']);
    expect(store.getState().selectedClips).toHaveLength(2);
  });

  it('disables every command when any selected track is locked', () => {
    const store = makeStore();
    const refs = [
      { trackId: 'a', clipId: 'a-clip' },
      { trackId: 'c', clipId: 'c-clip' },
    ];
    store.getState().setTrackLocked(0, 'c', true);
    store.getState().setSelectedClips(refs, refs[0]);
    render(<ClipInspector store={store} outputIndex={0} trackId="a" clipId="a-clip" />);

    for (const name of ['Send to back', 'Send backward', 'Bring forward', 'Bring to front']) {
      expect((screen.getByRole('button', { name, exact: true }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByRole('button', { name: 'Bring forward', exact: true }).getAttribute('title'))
      .toBe('Unlock every selected track before arranging its clips');
  });

  it('disables arrangement for audio and frozen outputs', () => {
    const audioStore = makeStore({
      tracks: [track('a', 'audio')],
    });
    const audio = render(<ClipInspector store={audioStore} outputIndex={0} trackId="a" clipId="a-clip" />);
    expect(screen.getByRole('button', { name: 'Bring forward', exact: true }).getAttribute('title'))
      .toBe('Audio clips do not have visual layer order');
    expect((screen.getByRole('button', { name: 'Bring forward', exact: true }) as HTMLButtonElement).disabled).toBe(true);
    audio.unmount();

    const frozenStore = makeStore({ frozen: true });
    render(<ClipInspector store={frozenStore} outputIndex={0} trackId="a" clipId="a-clip" />);
    expect(screen.getByRole('button', { name: 'Bring forward', exact: true }).getAttribute('title'))
      .toBe('Unfreeze this output before arranging clips');
    expect((screen.getByRole('button', { name: 'Bring forward', exact: true }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports an already-at-extreme command without adding history', () => {
    const store = makeStore({ tracks: [track('a', 'video')] });
    const historyBefore = store.getState().history.length;
    render(<ClipInspector store={store} outputIndex={0} trackId="a" clipId="a-clip" />);

    fireEvent.click(screen.getByRole('button', { name: 'Bring to front', exact: true }));
    expect(toasterShow).toHaveBeenCalledWith('The selection is already at the front', 'warning');
    expect(store.getState().history).toHaveLength(historyBefore);
  });
});
