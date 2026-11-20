import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MotionPathControls } from './motion-path-controls';
import { createDesignerStore } from '../designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const videoStore = () => {
  const store = createDesignerStore();
  store.getState().setMode('video');
  const trackId = store.getState().doc.outputs[0].tracks[0].id;
  store.getState().addClip(0, trackId, {
    id: 'clip', startMs: 1000, endMs: 3000, src: '/movie.mp4',
  } as never);
  return { store, trackId };
};

describe('MotionPathControls', () => {
  it('starts/cancels recording and edits easing, rotation, and deletion with Undo', () => {
    const { store, trackId } = videoStore();
    render(<MotionPathControls store={store} outputIndex={0} trackId={trackId} clipId="clip" clip={store.getState().doc.outputs[0].tracks[0].clips[0]} disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record motion path' }));
    expect(store.getState().motionPathRecording).toMatchObject({ outputIndex: 0, trackId, clipId: 'clip' });
    expect(store.getState().playheadMs).toBe(1000);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel recording' }));
    expect(store.getState().motionPathRecording).toBeNull();

    store.getState().updateClip(0, trackId, 'clip', {
      motionPath: { points: [{ x: 0, y: 0, tMs: 0 }, { x: 100, y: 100, tMs: 2000 }] },
    });
    const clip = store.getState().doc.outputs[0].tracks[0].clips[0];
    render(<MotionPathControls store={store} outputIndex={0} trackId={trackId} clipId="clip" clip={clip} disabled={false} />);
    const historyBefore = store.getState().history.length;
    fireEvent.change(screen.getAllByRole('combobox', { name: 'Path easing' })[1], { target: { value: 'easeInOut' } });
    expect(store.getState().doc.outputs[0].tracks[0].clips[0].motionPath?.ease).toBe('easeInOut');
    fireEvent.click(screen.getAllByRole('switch', { name: 'Rotate with path' })[1]);
    expect(store.getState().doc.outputs[0].tracks[0].clips[0].motionPath?.followRotation).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete motion path' })[1]);
    expect(store.getState().doc.outputs[0].tracks[0].clips[0].motionPath).toBeUndefined();
    expect(store.getState().history).toHaveLength(historyBefore + 3);
    store.getState().undo();
    expect(store.getState().doc.outputs[0].tracks[0].clips[0].motionPath?.followRotation).toBe(true);
  });

  it('disables recording and editing for a locked track', () => {
    const { store, trackId } = videoStore();
    store.getState().setTrackLocked(0, trackId, true);
    const clip = store.getState().doc.outputs[0].tracks[0].clips[0];
    render(<MotionPathControls store={store} outputIndex={0} trackId={trackId} clipId="clip" clip={clip} disabled />);
    expect(screen.getByRole('button', { name: 'Record motion path' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('combobox', { name: 'Path easing' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('switch', { name: 'Rotate with path' })).toHaveProperty('disabled', true);
  });
});


describe('MotionPathControls point accessibility', () => {
  it('deletes a selected point through a keyboard/touch-accessible control with one Undo', () => {
    const { store, trackId } = videoStore();
    store.getState().updateClip(0, trackId, 'clip', {
      motionPath: {
        points: [
          { x: 0, y: 0, tMs: 0 },
          { x: 100, y: 100, tMs: 1000 },
          { x: 200, y: 50, tMs: 2000 },
        ],
      },
    });
    const clip = store.getState().doc.outputs[0].tracks[0].clips[0];
    render(<MotionPathControls store={store} outputIndex={0} trackId={trackId} clipId="clip" clip={clip} disabled={false} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Path point' }), { target: { value: '1' } });
    expect(store.getState().motionPathPointIndex).toBe(1);
    const historyBefore = store.getState().history.length;

    fireEvent.click(screen.getByRole('button', { name: 'Delete selected point' }));

    const points = store.getState().doc.outputs[0].tracks[0].clips[0].motionPath?.points;
    expect(points?.map((point) => point.x)).toEqual([0, 200]);
    expect(store.getState().motionPathPointIndex).toBeNull();
    expect(store.getState().history).toHaveLength(historyBefore + 1);
    store.getState().undo();
    expect(store.getState().doc.outputs[0].tracks[0].clips[0].motionPath?.points).toHaveLength(3);
  });
});
