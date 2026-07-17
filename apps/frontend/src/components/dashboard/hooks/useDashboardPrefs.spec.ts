import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDashboardPrefs } from './useDashboardPrefs';

describe('useDashboardPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns an empty hidden list by default', async () => {
    const { result } = renderHook(() => useDashboardPrefs());
    expect(result.current.hidden).toEqual([]);

    await waitFor(() => {
      expect(result.current.hidden).toEqual([]);
    });
  });

  it('toggle adds and removes ids', async () => {
    const { result } = renderHook(() => useDashboardPrefs());

    act(() => result.current.toggle('kpi'));
    await waitFor(() => expect(result.current.hidden).toContain('kpi'));

    act(() => result.current.toggle('schedule'));
    await waitFor(() =>
      expect(result.current.hidden).toEqual(expect.arrayContaining(['kpi', 'schedule']))
    );

    act(() => result.current.toggle('kpi'));
    await waitFor(() => expect(result.current.hidden).not.toContain('kpi'));
    expect(result.current.hidden).toContain('schedule');
  });

  it('persists across hook remounts', async () => {
    const { result, unmount } = renderHook(() => useDashboardPrefs());

    act(() => result.current.toggle('campaigns'));
    await waitFor(() => expect(result.current.hidden).toContain('campaigns'));
    unmount();

    const { result: next } = renderHook(() => useDashboardPrefs());
    await waitFor(() => expect(next.current.hidden).toContain('campaigns'));
    expect(localStorage.getItem('dashboard_prefs')).toEqual(
      JSON.stringify({ hidden: ['campaigns'], v: 1 })
    );
  });

  it('ignores unknown ids and non-string values from storage', async () => {
    localStorage.setItem(
      'dashboard_prefs',
      JSON.stringify({ hidden: ['known', 'old_unknown_id', 123, null], v: 1 })
    );

    const { result } = renderHook(() => useDashboardPrefs());
    await waitFor(() => {
      // Non-string values are dropped. String ids are kept verbatim; ids that
      // do not match a registered section id are naturally ignored by the
      // dashboard because no SectionCard renders for them.
      expect(result.current.hidden).toEqual(['known', 'old_unknown_id']);
    });
  });
});
