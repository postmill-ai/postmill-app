import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockFetchFn = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

import { useChannelRefresh, ChannelRefreshError } from './useChannelRefresh';

describe('useChannelRefresh', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs the refresh route for the integration', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useChannelRefresh());
    await result.current('int-1');
    expect(mockFetchFn).toHaveBeenCalledWith('/analytics/v2/refresh/int-1', {
      method: 'POST',
    });
  });

  it('throws a ChannelRefreshError carrying the status on failure', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: false, status: 429 });
    const { result } = renderHook(() => useChannelRefresh());
    await expect(result.current('int-1')).rejects.toMatchObject({ status: 429 });
    mockFetchFn.mockResolvedValueOnce({ ok: false, status: 502 });
    await expect(result.current('int-1')).rejects.toBeInstanceOf(ChannelRefreshError);
  });
});
