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
