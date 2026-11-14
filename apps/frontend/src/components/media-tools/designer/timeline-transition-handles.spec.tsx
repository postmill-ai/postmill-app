import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { VideoClip, VideoTrack } from './designer.store';

const clip = (id: string, startMs: number, endMs: number): VideoClip => ({
  id,
  startMs,
  endMs,
  text: id,
  x: 0,
  y: 0,
  width: 100,
  height: 40,
});

describe('timeline transition handles', () => {
  it('keeps a cut junction visible and opens the existing transition popover state', async () => {
    vi.stubGlobal('AudioContext', class {});
    const { TrackRow } = await import('./video-timeline');
    const from = clip('from', 0, 2000);
    const to = clip('to', 2000, 4000);
    const track: VideoTrack = { id: 'text-track', type: 'text', clips: [from, to] };
    const setTransitionPopover = vi.fn();
    render(
      <TrackRow
        track={track}
        label="Text"
        pairs={[{ from, to }]}
        durationMs={4000}
        totalPixels={400}
        pixelsPerMs={0.1}
        dragOver={false}
        isSelected={() => false}
        isPrimary={() => false}
        transitionLabel={(type) => type[0].toUpperCase() + type.slice(1)}
        translate={((_key: string, fallback: string, params?: { label?: string }) =>
          fallback.replace('{{label}}', params?.label ?? '')) as never}
        dragMovedRef={{ current: false }}
        onSelectClip={vi.fn()}
        onClipKeyDown={vi.fn()}
        onSliderKeyUp={vi.fn()}
        onClipPointerDown={vi.fn()}
        onClipContextMenu={vi.fn()}
        onEdgeKeyDown={vi.fn()}
        onToggleLock={vi.fn()}
        onToggleHidden={vi.fn()}
        setTrackSettings={vi.fn()}
        setTransitionPopover={setTransitionPopover}
      />
    );

    const handle = screen.getByRole('button', { name: 'Cut transition' });
    expect(handle.getAttribute('data-transition-type')).toBe('cut');
    expect(handle.getAttribute('aria-haspopup')).toBe('dialog');
    expect(handle.querySelector('svg')).not.toBeNull();

    fireEvent.click(handle);
    expect(setTransitionPopover).toHaveBeenCalledWith({
      trackId: 'text-track',
      fromClipId: 'from',
      toClipId: 'to',
      x: 0,
      y: 0,
    });
  });
});
