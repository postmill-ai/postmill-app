import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDesignerStore, type VideoOutput } from './designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : fallback,
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));

vi.mock('@postmill-ai/frontend/components/layout/use-media-tools-status', () => ({
  useMediaToolsStatus: () => ({
    status: undefined,
    isLoading: false,
    operationAvailable: () => true,
    toolAvailable: () => true,
    tool: () => undefined,
  }),
}));

vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn(), closeAll: vi.fn(), closeById: vi.fn(), closeCurrent: vi.fn() }),
  usePromptModal: () => ({ open: vi.fn() }),
  useHasOpenModals: () => false,
}));

vi.mock('@postmill-ai/frontend/components/media-tools/use-media-picker', () => ({
  useMediaPicker: () => ({ open: vi.fn(), element: null }),
}));

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

class MockAudioContext {
  createGain() {
    return { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } };
  }
  createBufferSource() {
    return { connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }
  createMediaElementSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  get destination() {
    return {};
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

let VideoTimeline: (typeof import('./video-timeline'))['VideoTimeline'];

beforeAll(async () => {
  vi.stubGlobal('AudioContext', MockAudioContext);
  ({ VideoTimeline } = await import('./video-timeline'));
});

afterEach(cleanup);

const openAudioSettings = ({ frozen = false, locked = false } = {}) => {
  const store = createDesignerStore(1080, 1080);
  store.getState().setMode('video');
  store.getState().addTrack(0, 'audio');
  const output = store.getState().doc.outputs[0] as VideoOutput;
  const audioTrack = output.tracks.find((track) => track.type === 'audio')!;
  if (locked) store.getState().setTrackLocked(0, audioTrack.id, true);
  if (frozen) store.getState().setOutputFrozen(0, true);

  render(<VideoTimeline store={store} />);
  const expand = screen.queryByRole('button', { name: 'Expand timeline' });
  if (expand) fireEvent.click(expand);
  fireEvent.click(screen.getByRole('button', { name: 'Track settings: audio' }));

  return {
    gain: screen.getByRole('slider', { name: '' }) as HTMLInputElement,
    autoDuck: screen.getByRole('checkbox', { name: 'Auto-duck under voice' }) as HTMLInputElement,
    mute: screen.getByRole('checkbox', { name: 'Mute track' }) as HTMLInputElement,
  };
};

describe('video timeline audio track settings', () => {
  it('copies and pastes an audio volume envelope through the clip menu', () => {
    const store = createDesignerStore(1080, 1080);
    store.getState().setMode('video');
    store.getState().addTrack(0, 'audio');
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const trackId = output.tracks.find((track) => track.type === 'audio')!.id;
    store.getState().addClip(0, trackId, {
      id: 'audio-source', startMs: 0, endMs: 4000,
      keyframes: [
        { tMs: 0, props: { volume: 0 } },
        { tMs: 1000, props: { volume: 1 } },
      ],
    } as never);
    store.getState().addClip(0, trackId, {
      id: 'audio-target', startMs: 4000, endMs: 8000,
    } as never);

    render(<VideoTimeline store={store} />);
    const expand = screen.queryByRole('button', { name: 'Expand timeline' });
    if (expand) fireEvent.click(expand);
    const clips = screen.getAllByRole('slider', { name: 'Clip', exact: true });
    fireEvent.contextMenu(clips[0], { clientX: 100, clientY: 100 });
    const copy = screen.getByRole('button', { name: 'Copy keyframes', exact: true });
    expect(copy).toHaveProperty('disabled', false);
    expect(screen.queryByRole('button', { name: 'Copy Animation', exact: true })).toBeNull();
    fireEvent.click(copy);
    expect(store.getState().keyframeClipboard).toHaveLength(2);

    fireEvent.contextMenu(clips[1], { clientX: 100, clientY: 100 });
    const paste = screen.getByRole('button', { name: 'Paste keyframes', exact: true });
    expect(paste).toHaveProperty('disabled', false);
    expect(screen.queryByRole('button', { name: 'Paste Animation', exact: true })).toBeNull();
    fireEvent.click(paste);
    expect((store.getState().doc.outputs[0] as VideoOutput).tracks
      .find((track) => track.id === trackId)?.clips
      .find((clip) => clip.id === 'audio-target')?.keyframes).toEqual([
        { tMs: 0, props: { volume: 0 } },
        { tMs: 1000, props: { volume: 1 } },
      ]);
  });

  it('disables gain, auto-duck and mute when the format is frozen', () => {
    const controls = openAudioSettings({ frozen: true });

    expect(controls.gain.disabled).toBe(true);
    expect(controls.autoDuck.disabled).toBe(true);
    expect(controls.mute.disabled).toBe(true);
  });

  it('does not disable audio settings for a track lock alone', () => {
    const controls = openAudioSettings({ locked: true });

    expect(controls.gain.disabled).toBe(false);
    expect(controls.autoDuck.disabled).toBe(false);
    expect(controls.mute.disabled).toBe(false);
  });
});
