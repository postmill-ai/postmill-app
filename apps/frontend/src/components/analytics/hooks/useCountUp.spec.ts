import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountUp } from './useCountUp';

describe('useCountUp', () => {
  let rafCallbacks: Array<(time: number) => void> = [];
  let rafIdCounter = 0;
  let currentTime = 0;

  beforeEach(() => {
    rafCallbacks = [];
    rafIdCounter = 0;
    currentTime = 0;

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    vi.spyOn(performance, 'now').mockImplementation(() => currentTime);

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
      (cb: FrameRequestCallback) => {
        const id = ++rafIdCounter;
        rafCallbacks.push(cb as (time: number) => void);
        return id;
      }
    );

    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns target immediately when enabled is false', () => {
    const { result } = renderHook(() => useCountUp(100, 800, false));

    expect(result.current).toBe(100);
    expect(rafCallbacks.length).toBe(0);
  });

  it('returns 0 when enabled and target is positive', () => {
    const { result } = renderHook(() => useCountUp(100, 800));

    expect(result.current).toBe(0);
    expect(rafCallbacks.length).toBe(1);
  });

  it('increments toward target as animation frames fire', () => {
    const { result } = renderHook(() => useCountUp(100, 800));

    currentTime = 400;
    act(() => {
      rafCallbacks[0](currentTime);
    });

    const midValue = result.current;
    expect(midValue).toBeGreaterThan(0);
    expect(midValue).toBeLessThan(100);
  });

  it('reaches exact target when animation completes', () => {
    const { result } = renderHook(() => useCountUp(100, 800));

    currentTime = 800;
    act(() => {
      rafCallbacks[0](currentTime);
    });

    expect(result.current).toBe(100);
  });

  it('reaches exact target when time exceeds duration', () => {
    const { result } = renderHook(() => useCountUp(42, 500));

    currentTime = 2000;
    act(() => {
      rafCallbacks[0](currentTime);
    });

    expect(result.current).toBe(42);
  });

  it('works with target of zero', () => {
    const { result } = renderHook(() => useCountUp(0, 500));

    expect(result.current).toBe(0);

    currentTime = 500;
    act(() => {
      rafCallbacks[0](currentTime);
    });

    expect(result.current).toBe(0);
  });

  it('restarts animation when target changes', () => {
    const { result, rerender } = renderHook(
      ({ target }) => useCountUp(target, 800),
      { initialProps: { target: 100 } }
    );

    currentTime = 400;
    act(() => {
      rafCallbacks[0](currentTime);
    });
    const midValue = result.current;
    expect(midValue).toBe(87.5);

    rerender({ target: 200 });

    currentTime = 1200;
    act(() => {
      rafCallbacks[1](currentTime);
    });

    expect(result.current).toBeGreaterThan(midValue);
    expect(result.current).toBeLessThanOrEqual(200);
  });

  it('skips animation when user prefers reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useCountUp(100, 800, true));

    expect(result.current).toBe(100);
    expect(rafCallbacks.length).toBe(0);
  });
});
