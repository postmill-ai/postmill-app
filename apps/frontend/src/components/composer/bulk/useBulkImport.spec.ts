import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const fetchMock = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

import { useBulkImport } from './useBulkImport';

describe('useBulkImport (3.12 res.ok handling)', () => {
  beforeEach(() => fetchMock.mockReset());

  it('surfaces the server message on a non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Too many rows' }),
    });

    const { result } = renderHook(() => useBulkImport());
    await act(async () => {
      await result.current.submit([
        { content: 'x', channels: ['a'], scheduleAt: 'z' },
      ]);
    });

    expect(result.current.error).toBe('Too many rows');
    expect(result.current.results).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('falls back to a generic message when the body has none', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('not json');
      },
    });

    const { result } = renderHook(() => useBulkImport());
    await act(async () => {
      await result.current.submit([]);
    });

    expect(result.current.error).toBe('Bulk import failed');
  });

  it('stores rows on a successful response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [{ index: 0, success: true }] }),
    });

    const { result } = renderHook(() => useBulkImport());
    await act(async () => {
      await result.current.submit([
        { content: 'x', channels: ['a'], scheduleAt: 'z' },
      ]);
    });

    expect(result.current.error).toBe('');
    expect(result.current.results).toEqual([{ index: 0, success: true }]);
  });
});
