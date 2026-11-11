import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClipInspector } from './clip-inspector';
import { createDesignerStore } from '../designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
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

const makeStore = () => {
  const store = createDesignerStore();
  store.setState({
    doc: {
      mode: 'video',
      outputs: [{
        id: 'out-1',
        width: 1080,
        height: 1080,
        durationMs: 10_000,
        fps: 30,
        tracks: [{
          id: 'video-1',
          type: 'video',
          clips: [{
            id: 'clip-1',
            startMs: 0,
            endMs: 5000,
            src: '/video.mp4',
            volume: 0.4,
            reverse: false,
          }],
        }],
      }],
    } as any,
  });
  return store;
};

describe('ClipInspector playback controls', () => {
  it('toggles reverse and restores the previous nonzero original-audio volume', () => {
    const store = makeStore();
    render(<ClipInspector store={store} outputIndex={0} trackId="video-1" clipId="clip-1" />);

    fireEvent.click(screen.getByRole('switch', { name: 'Reverse' }));
    expect(store.getState().doc.outputs[0].tracks[0].clips[0].reverse).toBe(true);

    fireEvent.click(screen.getByRole('switch', { name: 'Original audio' }));
    expect(store.getState().doc.outputs[0].tracks[0].clips[0].volume).toBe(0);
    fireEvent.click(screen.getByRole('switch', { name: 'Original audio' }));
    expect(store.getState().doc.outputs[0].tracks[0].clips[0].volume).toBe(0.4);
  });
});
