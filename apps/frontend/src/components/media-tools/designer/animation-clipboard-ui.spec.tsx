import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ContextMenu } from './context-menu';
import { ClipInspector } from './panels/clip-inspector';
import { createDesignerStore, type VideoOutput } from './designer.store';

const toasterShow = vi.hoisted(() => vi.fn());
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, params?: Record<string, string | number>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(params?.[key])),
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: toasterShow }),
}));
vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: 'org-a' }),
}));
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));
vi.mock('@postmill-ai/frontend/components/layout/use-media-tools-status', () => ({
  useMediaToolsStatus: () => ({ operationAvailable: () => false }),
}));
vi.mock('@postmill-ai/frontend/components/media-tools/use-media-picker', () => ({
  useMediaPicker: () => ({ open: vi.fn(), element: null }),
}));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn(), closeAll: vi.fn(), closeCurrent: vi.fn() }),
}));

const storeWithAnimation = () => {
  const store = createDesignerStore();
  store.getState().setMode('video');
  const trackId = (store.getState().doc.outputs[0] as VideoOutput).tracks[0].id;
  store.getState().addClip(0, trackId, {
    id: 'source', startMs: 0, endMs: 4000,
    keyframes: [{ tMs: 0, props: { opacity: 0.25 } }],
  } as never);
  store.getState().addClip(0, trackId, {
    id: 'first', startMs: 4000, endMs: 8000,
  } as never);
  store.getState().addClip(0, trackId, {
    id: 'second', startMs: 8000, endMs: 10000,
  } as never);
  return { store, trackId };
};

describe('animation clipboard menu and Inspector', () => {
  beforeEach(() => toasterShow.mockClear());

  it('shows canvas Copy/Paste Animation states and pastes onto the retained multi-selection', () => {
    const { store, trackId } = storeWithAnimation();
    const close = vi.fn();
    const { unmount } = render(
      <ContextMenu x={10} y={10} targetType="clip" elementId="source" store={store} onClose={close} />
    );
    expect(screen.getByRole('button', { name: 'Copy Animation' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Paste Animation' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Animation' }));
    expect(store.getState().animationClipboard?.orgId).toBe('org-a');
    expect(close).toHaveBeenCalled();
    unmount();

    store.getState().setSelectedClips([
      { trackId, clipId: 'first' },
      { trackId, clipId: 'second' },
    ]);
    render(
      <ContextMenu x={10} y={10} targetType="clip" elementId="first" store={store} onClose={vi.fn()} />
    );
    const paste = screen.getByRole('button', { name: 'Paste Animation' });
    expect(paste).toHaveProperty('disabled', false);
    fireEvent.click(paste);
    expect(toasterShow).toHaveBeenLastCalledWith('Animation pasted to 2 clip(s)', 'success');
    expect((store.getState().doc.outputs[0] as VideoOutput).tracks[0].clips
      .filter((clip) => clip.id !== 'source')
      .every((clip) => clip.keyframes?.[0].props.opacity === 0.25)).toBe(true);
  });

  it('disables canvas copy for a clip without supported animation', () => {
    const { store } = storeWithAnimation();
    render(
      <ContextMenu x={10} y={10} targetType="clip" elementId="first" store={store} onClose={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Copy Animation' })).toHaveProperty('disabled', true);
  });

  it('invokes the same multi-target paste from the Inspector', () => {
    const { store, trackId } = storeWithAnimation();
    store.getState().copyAnimation(0, trackId, 'source', 'org-a');
    store.getState().setSelectedClips([
      { trackId, clipId: 'first' },
      { trackId, clipId: 'second' },
    ], { trackId, clipId: 'first' });
    render(<ClipInspector store={store} outputIndex={0} trackId={trackId} clipId="first" />);

    const paste = screen.getByRole('button', { name: 'Paste Animation' });
    expect(paste).toHaveProperty('disabled', false);
    fireEvent.click(paste);
    expect(toasterShow).toHaveBeenLastCalledWith('Animation pasted to 2 clip(s)', 'success');
    expect(store.getState().selectedClip).toMatchObject({ trackId, clipId: 'first' });
  });
});
