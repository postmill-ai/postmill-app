import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInlineSuggestPref } from './use-inline-suggest-pref';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('useInlineSuggestPref', () => {
  it('is ON for someone who has never touched it', () => {
    const { result } = renderHook(() => useInlineSuggestPref());
    expect(result.current.enabled).toBe(true);
  });

  it('only an explicit opt-out turns it off', () => {
    localStorage.setItem('composer_inline_suggest', '0');
    const { result } = renderHook(() => useInlineSuggestPref());
    expect(result.current.enabled).toBe(false);
  });

  it('persists a toggle and reflects it immediately', () => {
    const { result } = renderHook(() => useInlineSuggestPref());

    act(() => result.current.toggle());
    expect(localStorage.getItem('composer_inline_suggest')).toBe('0');
    expect(result.current.enabled).toBe(false);

    act(() => result.current.toggle());
    expect(localStorage.getItem('composer_inline_suggest')).toBe('1');
    expect(result.current.enabled).toBe(true);
  });

  it('keeps separate instances in step', () => {
    // The toolbar toggle and the editor hook are different components.
    const a = renderHook(() => useInlineSuggestPref());
    const b = renderHook(() => useInlineSuggestPref());

    act(() => a.result.current.setEnabled(false));

    expect(b.result.current.enabled).toBe(false);
  });

  it('survives localStorage being unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });

    try {
      const { result } = renderHook(() => useInlineSuggestPref());
      // Unreadable storage must not read as an opt-out.
      expect(result.current.enabled).toBe(true);
      expect(() => act(() => result.current.toggle())).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
