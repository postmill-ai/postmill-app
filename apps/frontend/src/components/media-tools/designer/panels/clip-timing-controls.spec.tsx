import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClipTimingControls } from './clip-timing-controls';
import type { VideoClip } from '../designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const clip: VideoClip = {
  id: 'clip-1',
  startMs: 1000,
  endMs: 4000,
  src: '/image.png',
};

describe('ClipTimingControls', () => {
  it('edits Start, End, and Duration independently of the output duration', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { rerender } = render(
      <ClipTimingControls
        clip={clip}
        trackType="image"
        outputDurationMs={10000}
        onChange={onChange}
        onCommit={onCommit}
      />
    );

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Start (s)' }), { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith({ startMs: 2000, endMs: 5000 });
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'Start (s)' }));
    expect(onCommit).toHaveBeenCalledTimes(1);

    rerender(
      <ClipTimingControls
        clip={{ ...clip, startMs: 2000, endMs: 5000 }}
        trackType="image"
        outputDurationMs={10000}
        onChange={onChange}
        onCommit={onCommit}
      />
    );
    fireEvent.change(screen.getByRole('spinbutton', { name: 'End (s)' }), { target: { value: '6' } });
    expect(onChange).toHaveBeenLastCalledWith({ startMs: 2000, endMs: 6000 });
    screen.getByRole('spinbutton', { name: 'End (s)' }).focus();
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'End (s)' }), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(2);

    rerender(
      <ClipTimingControls
        clip={{ ...clip, startMs: 2000, endMs: 6000 }}
        trackType="image"
        outputDurationMs={10000}
        onChange={onChange}
        onCommit={onCommit}
      />
    );
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Duration (s)' }), { target: { value: '1.5' } });
    expect(onChange).toHaveBeenLastCalledWith({ startMs: 2000, endMs: 3500 });
  });

  it('commits a stepper button edit once without a duplicate blur entry', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <ClipTimingControls
        clip={clip}
        trackType="image"
        outputDurationMs={10000}
        onChange={onChange}
        onCommit={onCommit}
      />
    );
    const input = screen.getByRole('spinbutton', { name: 'Duration (s)' });
    input.focus();
    const increase = screen.getAllByRole('button', { name: 'Increase' })[2];
    fireEvent.blur(input, { relatedTarget: increase });
    fireEvent.click(increase);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('skips unchanged blur commits and avoids a Safari-style duplicate click commit', () => {
    const onCommit = vi.fn();
    render(
      <ClipTimingControls
        clip={clip}
        trackType="image"
        outputDurationMs={10000}
        onChange={vi.fn()}
        onCommit={onCommit}
      />
    );
    const input = screen.getByRole('spinbutton', { name: 'Duration (s)' });
    input.focus();
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input, { relatedTarget: null });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const increase = screen.getAllByRole('button', { name: 'Increase' })[2];
    fireEvent.click(increase);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('disables every timing input and button for a locked track', () => {
    render(
      <ClipTimingControls
        clip={clip}
        trackType="image"
        outputDurationMs={10000}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        disabled
      />
    );
    for (const label of ['Start (s)', 'End (s)', 'Duration (s)']) {
      expect(screen.getByRole('spinbutton', { name: label }).matches(':disabled')).toBe(true);
    }
    for (const button of screen.getAllByRole('button')) {
      expect(button.matches(':disabled')).toBe(true);
    }
  });
});
