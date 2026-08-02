import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useLongPress } from './use-long-press';

const Tile: React.FC<{
  onLongPress: (p: { clientX: number; clientY: number }, payload: string) => void;
  onClick: () => void;
  payload?: string;
}> = ({ onLongPress, onClick, payload = 'file-1' }) => {
  const { bind } = useLongPress<string>(onLongPress);
  return (
    <button type="button" onClick={onClick} {...bind(payload)}>
      tile
    </button>
  );
};

/** Two pressables sharing one hook instance, as `FileList` does for its rows. */
const TwoTiles: React.FC<{
  onLongPress: (p: { clientX: number; clientY: number }, payload: string) => void;
}> = ({ onLongPress }) => {
  const { bind } = useLongPress<string>(onLongPress);
  return (
    <>
      <button type="button" {...bind('row-a')}>
        a
      </button>
      <button type="button" {...bind('row-b')}>
        b
      </button>
    </>
  );
};

const touch = (clientX: number, clientY: number) => ({
  touches: [{ clientX, clientY }],
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useLongPress', () => {
  it('fires after the hold delay', () => {
    const onLongPress = vi.fn();
    render(<Tile onLongPress={onLongPress} onClick={vi.fn()} />);
    const tile = screen.getByRole('button');

    fireEvent.touchStart(tile, touch(30, 40));
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(onLongPress).toHaveBeenCalledWith({ clientX: 30, clientY: 40 }, 'file-1');
  });

  it('reports the payload of the pressed element when one instance serves many', () => {
    const onLongPress = vi.fn();
    render(<TwoTiles onLongPress={onLongPress} />);
    const [, b] = screen.getAllByRole('button');

    fireEvent.touchStart(b, touch(5, 6));
    vi.advanceTimersByTime(500);

    expect(onLongPress).toHaveBeenCalledWith({ clientX: 5, clientY: 6 }, 'row-b');
  });

  it('does not fire before the delay elapses', () => {
    const onLongPress = vi.fn();
    render(<Tile onLongPress={onLongPress} onClick={vi.fn()} />);
    const tile = screen.getByRole('button');

    fireEvent.touchStart(tile, touch(0, 0));
    vi.advanceTimersByTime(499);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('is cancelled by a touchend before the delay', () => {
    const onLongPress = vi.fn();
    render(<Tile onLongPress={onLongPress} onClick={vi.fn()} />);
    const tile = screen.getByRole('button');

    fireEvent.touchStart(tile, touch(0, 0));
    fireEvent.touchEnd(tile);
    vi.advanceTimersByTime(1000);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('is cancelled by finger drift beyond the tolerance (a scroll)', () => {
    const onLongPress = vi.fn();
    render(<Tile onLongPress={onLongPress} onClick={vi.fn()} />);
    const tile = screen.getByRole('button');

    fireEvent.touchStart(tile, touch(0, 0));
    fireEvent.touchMove(tile, touch(0, 25));
    vi.advanceTimersByTime(1000);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('survives small drift within the tolerance', () => {
    const onLongPress = vi.fn();
    render(<Tile onLongPress={onLongPress} onClick={vi.fn()} />);
    const tile = screen.getByRole('button');

    fireEvent.touchStart(tile, touch(0, 0));
    fireEvent.touchMove(tile, touch(3, 4));
    vi.advanceTimersByTime(500);

    expect(onLongPress).toHaveBeenCalled();
  });

  it('swallows the synthetic click that touchend emits after firing', () => {
    // Without this, a long-press in the media picker opens the menu and the
    // tile's click handler immediately selects the file and closes the modal.
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(<Tile onLongPress={onLongPress} onClick={onClick} />);
    const tile = screen.getByRole('button');

    fireEvent.touchStart(tile, touch(0, 0));
    vi.advanceTimersByTime(500);
    fireEvent.touchEnd(tile);
    fireEvent.click(tile);

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('lets a normal tap through', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(<Tile onLongPress={onLongPress} onClick={onClick} />);
    const tile = screen.getByRole('button');

    fireEvent.touchStart(tile, touch(0, 0));
    vi.advanceTimersByTime(120);
    fireEvent.touchEnd(tile);
    fireEvent.click(tile);

    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('only swallows one click, so the next tap works', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(<Tile onLongPress={onLongPress} onClick={onClick} />);
    const tile = screen.getByRole('button');

    fireEvent.touchStart(tile, touch(0, 0));
    vi.advanceTimersByTime(500);
    fireEvent.touchEnd(tile);
    fireEvent.click(tile);
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(tile);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
