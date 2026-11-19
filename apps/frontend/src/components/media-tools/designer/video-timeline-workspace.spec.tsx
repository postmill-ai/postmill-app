import React, { act } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesignerStore, type VideoOutput } from './designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(vars[key])) : fallback,
}));
vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: currentOrgId }),
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

let currentOrgId = 'org-a';
let VideoTimeline: (typeof import('./video-timeline'))['VideoTimeline'];

beforeAll(async () => {
  vi.stubGlobal('AudioContext', MockAudioContext);
  ({ VideoTimeline } = await import('./video-timeline'));
});

beforeEach(() => {
  localStorage.clear();
  currentOrgId = 'org-a';
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const makeStore = () => {
  const store = createDesignerStore(400, 300);
  store.getState().loadDesign({
    version: 10,
    mode: 'video',
    outputs: [{
      id: 'out', width: 400, height: 300, durationMs: 4000, fps: 30,
      tracks: [
        {
          id: 'track-a', type: 'text', name: 'First',
          clips: [
            { id: 'clip-a', text: 'A', startMs: 0, endMs: 2000 },
            { id: 'clip-b', text: 'B', startMs: 2000, endMs: 4000 },
          ],
        },
        {
          id: 'track-b', type: 'text', name: 'Second',
          clips: [{ id: 'clip-c', text: 'Text', startMs: 0, endMs: 4000 }],
        },
      ],
    }],
  } as any, 'workspace', 'Workspace');
  return store;
};

const row = (id: string) => document.querySelector(`[data-track-id="${id}"]`) as HTMLElement;

describe('video timeline workspace', () => {
  it('compacts rows while retaining clip and transition controls', () => {
    const store = makeStore();
    render(<VideoTimeline store={store} />);
    expect(row('track-a').style.height).toBe('56px');
    expect(within(row('track-a')).getByRole('button', { name: 'Cut transition' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Compact tracks' }));

    expect(screen.getByRole('button', { name: 'Compact tracks' }).getAttribute('aria-pressed')).toBe('true');
    expect(row('track-a').style.height).toBe('38px');
    expect(store.getState().timelineHeight).toBe(204);
    expect(within(row('track-a')).getAllByRole('slider', { name: 'Clip' })).toHaveLength(2);
    expect(within(row('track-a')).getAllByRole('slider', { name: 'Trim clip start' })).toHaveLength(2);
    expect(within(row('track-a')).getByRole('button', { name: 'Cut transition' })).toBeTruthy();
  });

  it('collapses and restores one track without losing selection or scroll', () => {
    const store = makeStore();
    store.getState().setSelectedClip({ outputIndex: 0, trackId: 'track-a', clipId: 'clip-a' });
    render(<VideoTimeline store={store} />);
    const tracks = screen.getByRole('region', { name: 'Timeline tracks' });
    tracks.scrollTop = 17;

    fireEvent.click(screen.getByRole('button', { name: 'Collapse track: First' }));
    expect(row('track-a').dataset.collapsed).toBe('true');
    expect(within(row('track-a')).queryByRole('slider', { name: 'Clip' })).toBeNull();
    expect(store.getState().selectedClip?.clipId).toBe('clip-a');
    expect(tracks.scrollTop).toBe(17);

    fireEvent.click(screen.getByRole('button', { name: 'Expand track: First' }));
    expect(within(row('track-a')).getAllByRole('slider', { name: 'Clip' })).toHaveLength(2);
    expect(tracks.scrollTop).toBe(17);
  });

  it('collapses and expands every track from one toolbar action', () => {
    const store = makeStore();
    render(<VideoTimeline store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all tracks' }));
    expect(store.getState().collapsedTimelineTrackIds).toEqual(['track-a', 'track-b']);
    expect(screen.queryByRole('slider', { name: 'Clip' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expand all tracks' }));
    expect(store.getState().collapsedTimelineTrackIds).toEqual([]);
    expect(screen.getAllByRole('slider', { name: 'Clip' })).toHaveLength(3);
  });

  it('resizes by pointer and removes the gesture listeners on release', () => {
    const store = makeStore();
    render(<VideoTimeline store={store} />);
    const separator = screen.getByRole('separator', { name: 'Resize timeline' });

    fireEvent(separator, new MouseEvent('pointerdown', { bubbles: true, clientY: 500 }));
    fireEvent(window, new MouseEvent('pointermove', { bubbles: true, clientY: 450 }));
    expect(store.getState().timelineHeight).toBe(290);
    fireEvent(window, new MouseEvent('pointerup', { bubbles: true, clientY: 450 }));
    fireEvent(window, new MouseEvent('pointermove', { bubbles: true, clientY: 400 }));
    expect(store.getState().timelineHeight).toBe(290);
  });

  it('resizes by keyboard without invoking timeline playback', () => {
    const store = makeStore();
    render(<VideoTimeline store={store} />);
    const separator = screen.getByRole('separator', { name: 'Resize timeline' });

    fireEvent.keyDown(separator, { key: 'ArrowUp' });
    expect(store.getState().timelineHeight).toBe(256);
    fireEvent.keyDown(separator, { key: 'ArrowDown' });
    expect(store.getState().timelineHeight).toBe(240);
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(store.getState().timelineHeight).toBe(120);
    fireEvent.keyDown(separator, { key: 'End' });
    expect(store.getState().timelineHeight).toBe(600);
    expect(store.getState().isPlaying).toBe(false);
  });

  it('restores organization preferences on a new store', async () => {
    const first = makeStore();
    const mounted = render(<VideoTimeline store={first} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compact tracks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse track: First' }));
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize timeline' }), { key: 'ArrowUp' });
    mounted.unmount();

    const second = makeStore();
    render(<VideoTimeline store={second} />);
    await waitFor(() => expect(row('track-a').dataset.collapsed).toBe('true'));
    expect(second.getState().timelineDensity).toBe('compact');
    expect(second.getState().timelineHeight).toBe(220);
    expect(screen.getByRole('button', { name: 'Compact tracks' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('does not write one organization\'s preferences into a newly selected organization', async () => {
    const store = makeStore();
    const mounted = render(<VideoTimeline store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compact tracks' }));
    const writeSpy = vi.spyOn(Storage.prototype, 'setItem');

    currentOrgId = 'org-b';
    mounted.rerender(<VideoTimeline store={store} />);

    await waitFor(() => expect(store.getState().timelineDensity).toBe('comfortable'));
    const otherOrgWrites = writeSpy.mock.calls
      .filter(([key]) => key === 'designer-video-timeline-org-b')
      .map(([, value]) => JSON.parse(String(value)));
    expect(otherOrgWrites.length).toBeGreaterThan(0);
    expect(otherOrgWrites.every((preference) => preference.density === 'comfortable')).toBe(true);
  });

  it('keeps trim and split working on a compact selected clip', () => {
    const store = makeStore();
    store.getState().setSelectedClip({ outputIndex: 0, trackId: 'track-a', clipId: 'clip-a' });
    render(<VideoTimeline store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compact tracks' }));

    fireEvent.keyDown(within(row('track-a')).getAllByRole('slider', { name: 'Trim clip end' })[0], {
      key: 'ArrowLeft',
    });
    const output = store.getState().doc.outputs[0] as VideoOutput;
    expect(output.tracks[0].clips[0].endMs).toBeLessThan(2000);

    act(() => store.getState().setPlayhead(1000));
    fireEvent.click(screen.getByRole('button', { name: 'Split clip' }));
    expect((store.getState().doc.outputs[0] as VideoOutput).tracks[0].clips).toHaveLength(3);
  });
});
