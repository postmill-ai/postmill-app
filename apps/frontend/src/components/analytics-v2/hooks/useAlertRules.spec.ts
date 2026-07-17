import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockFetchFn = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

const mockMutate = vi.fn();
vi.mock('swr', () => ({ default: vi.fn() }));

import useSWR from 'swr';
import { useAlertRules, AlertRuleInput } from './useAlertRules';

const mockUseSWR = vi.mocked(useSWR);

const rule: AlertRuleInput = {
  integrationId: null,
  metric: 'followers',
  comparator: 'gte',
  threshold: 10000,
  direction: 'up',
  enabled: true,
};

describe('useAlertRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue({
      data: [],
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    } as any);
  });

  it('reads from the alert-rules resource', () => {
    renderHook(() => useAlertRules());
    expect(mockUseSWR.mock.calls[0][0]).toBe('/analytics/v2/alert-rules');
  });

  it('create POSTs the rule and revalidates', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useAlertRules());
    await result.current.create(rule);
    expect(mockFetchFn.mock.calls[0][0]).toBe('/analytics/v2/alert-rules');
    expect(mockFetchFn.mock.calls[0][1].method).toBe('POST');
    expect(mockMutate).toHaveBeenCalled();
  });

  it('update PUTs to the rule id', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useAlertRules());
    await result.current.update('r1', { enabled: false });
    expect(mockFetchFn.mock.calls[0][0]).toBe('/analytics/v2/alert-rules/r1');
    expect(mockFetchFn.mock.calls[0][1].method).toBe('PUT');
  });

  it('remove DELETEs the rule id', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useAlertRules());
    await result.current.remove('r1');
    expect(mockFetchFn.mock.calls[0][0]).toBe('/analytics/v2/alert-rules/r1');
    expect(mockFetchFn.mock.calls[0][1].method).toBe('DELETE');
  });
});
