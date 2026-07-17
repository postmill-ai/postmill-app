import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockFetchFn = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));
vi.mock('swr', () => ({ default: vi.fn() }));

import useSWR from 'swr';
import { useHealth } from './useHealth';

const mockUseSWR = vi.mocked(useSWR);

describe('useHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue({ data: undefined, error: undefined, isLoading: false } as any);
  });

  it('reads the data-health resource', () => {
    renderHook(() => useHealth());
    expect(mockUseSWR.mock.calls[0][0]).toBe('/analytics/v2/health');
  });

  it('load fetcher returns json on success', async () => {
    renderHook(() => useHealth());
    const load = mockUseSWR.mock.calls[0][1] as (p: string) => Promise<any>;
    const rows = [{ integrationId: 'i1' }];
    mockFetchFn.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(rows) });
    await expect(load('/analytics/v2/health')).resolves.toEqual(rows);
  });

  it('load fetcher throws on failure', async () => {
    renderHook(() => useHealth());
    const load = mockUseSWR.mock.calls[0][1] as (p: string) => Promise<any>;
    mockFetchFn.mockResolvedValueOnce({ ok: false });
    await expect(load('/x')).rejects.toThrow('Failed to fetch data health');
  });
});
