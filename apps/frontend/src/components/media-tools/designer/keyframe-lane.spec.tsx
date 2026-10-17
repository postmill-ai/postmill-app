import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { KeyframeLane } from './keyframe-lane';
import { createDesignerStore } from './designer.store';
import type { VideoOutput } from './designer.store';

/**
 * The keyframe lane's contract: diamonds sit at (clip.startMs + tMs) *
 * pixelsPerMs, a drag retimes with ONE history entry on release, the ease
 * mini-menu rewrites the ease, and Delete removes the diamond.
 */

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

afterEach(cleanup);

const PX_PER_MS = 0.5;

const storeWithClip = () => {
  const store = createDesignerStore();
  store.getState().setMode('video');
  const trackId = (store.getState().doc.outputs[0] as VideoOutput).tracks[0].id;
  store.getState().addClip(0, trackId, {
    id: 'c1',
    startMs: 2000,
    endMs: 6000,
    keyframes: [
      { tMs: 1000, props: { x: 10 } },
      { tMs: 2000, props: { opacity: 0.5 }, ease: 'easeOut' },
    ],
  } as never);
  store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'c1' });
  return { store, trackId };
};

const clipOf = (store: ReturnType<typeof createDesignerStore>) =>
  (store.getState().doc.outputs[0] as VideoOutput).tracks[0].clips.find((c) => c.id === 'c1')!;

const renderLane = (store: ReturnType<typeof createDesignerStore>) =>
  render(
    <KeyframeLane store={store} pixelsPerMs={PX_PER_MS} labelWidth={64} contentWidth={10000} />
  );

describe('KeyframeLane', () => {
  it('renders one row per animated property with diamonds at the absolute px/ms position', () => {
    const { store } = storeWithClip();
    renderLane(store);

    expect(screen.getByTestId('kf-lane-row-x')).toBeTruthy();
    expect(screen.getByTestId('kf-lane-row-opacity')).toBeTruthy();
    // Only keyframed props get rows.
    expect(screen.queryByTestId('kf-lane-row-width')).toBeNull();

    // (clip.startMs + tMs) * pixelsPerMs = (2000 + 1000) * 0.5 = 1500.
    expect(screen.getByTestId('kf-diamond-x-1000').style.left).toBe('1500px');
    expect(screen.getByTestId('kf-diamond-opacity-2000').style.left).toBe('2000px');
  });

  it('clicking a diamond selects it and shows the inline readout', () => {
    const { store } = storeWithClip();
    renderLane(store);

    fireEvent.click(screen.getByTestId('kf-diamond-opacity-2000'));

    const readout = screen.getByTestId('kf-lane-readout');
    expect(readout.textContent).toContain('opacity');
    expect(readout.textContent).toContain('50%');
    expect(readout.textContent).toContain('Ease Out');
    expect(readout.textContent).toContain('2000ms');
  });

  it('drags retime silently and land as ONE history entry on release', () => {
    const { store } = storeWithClip();
    renderLane(store);
    const depth = store.getState().history.length;

    const diamond = screen.getByTestId('kf-diamond-x-1000');
    fireEvent.mouseDown(diamond, { button: 0, clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 600 });
    fireEvent.mouseMove(window, { clientX: 700 });
    // Silent during the drag — no history yet.
    expect(store.getState().history.length).toBe(depth);
    fireEvent.mouseUp(window);

    // dx = 200px at 0.5 px/ms → +400ms.
    expect(clipOf(store).keyframes!.find((kf) => kf.props.x !== undefined)!.tMs).toBe(1400);
    expect(store.getState().history.length).toBe(depth + 1);

    store.getState().undo();
    expect(clipOf(store).keyframes!.find((kf) => kf.props.x !== undefined)!.tMs).toBe(1000);
  });

  it('clamps a retime drag into the clip duration', () => {
    const { store } = storeWithClip();
    renderLane(store);

    const diamond = screen.getByTestId('kf-diamond-x-1000');
    fireEvent.mouseDown(diamond, { button: 0, clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 500000 });
    fireEvent.mouseUp(window);

    expect(clipOf(store).keyframes!.find((kf) => kf.props.x !== undefined)!.tMs).toBe(4000);
  });

  it('right-click opens the ease menu and picking a preset rewrites the ease', () => {
    const { store } = storeWithClip();
    renderLane(store);
    const depth = store.getState().history.length;

    fireEvent.contextMenu(screen.getByTestId('kf-diamond-x-1000'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ease In' }));

    expect(clipOf(store).keyframes!.find((kf) => kf.tMs === 1000)!.ease).toBe('easeIn');
    expect(store.getState().history.length).toBe(depth + 1);
  });

  it('Delete removes the prop; an emptied keyframe disappears', () => {
    const { store } = storeWithClip();
    renderLane(store);
    const depth = store.getState().history.length;

    const diamond = screen.getByTestId('kf-diamond-x-1000');
    fireEvent.click(diamond);
    fireEvent.keyDown(diamond, { key: 'Delete' });

    // x was the only prop on that keyframe — the whole keyframe is gone.
    expect(clipOf(store).keyframes).toEqual([
      { tMs: 2000, props: { opacity: 0.5 }, ease: 'easeOut' },
    ]);
    expect(screen.queryByTestId('kf-lane-row-x')).toBeNull();
    expect(store.getState().history.length).toBe(depth + 1);
  });

  it('shows the hint when no clip is selected', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    renderLane(store);
    expect(screen.getByText('Select a clip to edit its keyframes')).toBeTruthy();
  });
});
