import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockFetchFn = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

import { useNarrate, NarrateError } from './useNarrate';

describe('useNarrate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs the narrate route with the range and returns the text', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'A good week.' }) });
    const { result } = renderHook(() => useNarrate());
    const text = await result.current('2024-01-01', '2024-01-31');
    expect(text).toBe('A good week.');
    expect(mockFetchFn.mock.calls[0][0]).toContain('/analytics/v2/narrate?');
    expect(mockFetchFn.mock.calls[0][0]).toContain('from=2024-01-01');
    expect(mockFetchFn.mock.calls[0][1]).toEqual({ method: 'POST' });
  });

  it('accepts a raw string body', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: true, json: async () => 'plain narration' });
    const { result } = renderHook(() => useNarrate());
    expect(await result.current('a', 'b')).toBe('plain narration');
  });

  it('throws a NarrateError with the status for AI-off (503) / budget (429)', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: false, status: 503 });
    const { result } = renderHook(() => useNarrate());
    await expect(result.current('a', 'b')).rejects.toMatchObject({ code: 503 });
    mockFetchFn.mockResolvedValueOnce({ ok: false, status: 429 });
    await expect(result.current('a', 'b')).rejects.toBeInstanceOf(NarrateError);
  });
});
