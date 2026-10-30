import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesignerStore, type VideoOutput } from './designer.store';
import { TimelineTransportControls } from './timeline-transport-controls';

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));

const setup = () => {
  const store = createDesignerStore();
  store.getState().setMode('video');
  const output = store.getState().doc.outputs[0] as VideoOutput;
  const trackId = output.tracks[0].id;
  store.getState().addClip(0, trackId, {
    id: 'clip', startMs: 0, endMs: 4000, src: '/clip.mp4',
  });
  store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'clip' });
  render(<TimelineTransportControls store={store} outputIndex={0} />);
  return { store, trackId };
};

describe('TimelineTransportControls', () => {
  beforeEach(() => localStorage.clear());

  it('shares split gating with the store and keeps selection on a resulting half', () => {
    const { store, trackId } = setup();
    const split = screen.getByRole('button', { name: 'Split clip' });
    expect((split as HTMLButtonElement).disabled).toBe(true);

    act(() => store.getState().setPlayhead(500));
    fireEvent.click(split);
    const output = store.getState().doc.outputs[0] as VideoOutput;
    expect(output.tracks[0].clips).toHaveLength(2);
    expect(store.getState().selectedClip).toEqual({
      outputIndex: 0,
      trackId,
      clipId: output.tracks[0].clips[1].id,
    });
    expect(output.tracks[0].clips.map((clip) => [clip.startMs, clip.endMs])).toEqual([
      [0, 500], [500, 4000],
    ]);
  });

  it('duplicates and deletes the selected clip through existing operations', () => {
    const { store } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate clip' }));
    let output = store.getState().doc.outputs[0] as VideoOutput;
    expect(output.tracks[0].clips).toHaveLength(2);
    const selected = store.getState().selectedClip!.clipId;
    expect(selected).not.toBe('clip');

    fireEvent.click(screen.getByRole('button', { name: 'Delete clip' }));
    output = store.getState().doc.outputs[0] as VideoOutput;
    expect(output.tracks[0].clips.map((clip) => clip.id)).toEqual(['clip']);
    expect(store.getState().selectedClip).toBeNull();
  });

  it('edits duration in seconds and clamps to the 1–180 second contract', () => {
    const { store } = setup();
    const duration = screen.getByRole('spinbutton', { name: 'Duration (seconds)' });
    fireEvent.change(duration, { target: { value: '12' } });
    expect((store.getState().doc.outputs[0] as VideoOutput).durationMs).toBe(12000);
    fireEvent.change(duration, { target: { value: '181' } });
    expect((store.getState().doc.outputs[0] as VideoOutput).durationMs).toBe(180000);
    fireEvent.change(duration, { target: { value: '0' } });
    expect((store.getState().doc.outputs[0] as VideoOutput).durationMs).toBe(1000);
  });
});
