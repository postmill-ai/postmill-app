import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockFetch = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

import { useExport } from './useExport';

describe('useExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (URL as any).createObjectURL = vi.fn(() => 'blob:x');
    (URL as any).revokeObjectURL = vi.fn();
  });

  it('serializes params (integrations + compare) and triggers a download', async () => {
    mockFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(['a']) });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const { result } = renderHook(() => useExport());
    await act(async () => {
      await result.current.download({
        from: '2024-01-01',
        to: '2024-01-07',
        format: 'csv',
        integrations: ['i1', 'i2'],
        compare: true,
      });
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/analytics/v2/export?');
    expect(url).toContain('format=csv');
    expect(url).toContain('integrations=i1%2Ci2');
    expect(url).toContain('compare=true');
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('appends campaigns when present, omits it when absent (1.6)', async () => {
    mockFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(['a']) });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { result } = renderHook(() => useExport());
    await act(async () => {
      await result.current.download({
        from: '2024-01-01',
        to: '2024-01-07',
        format: 'csv',
        campaigns: ['c1', 'c2'],
      });
    });
    expect(mockFetch.mock.calls[0][0] as string).toContain(
      'campaigns=c1%2Cc2'
    );

    await act(async () => {
      await result.current.download({
        from: '2024-01-01',
        to: '2024-01-07',
        format: 'csv',
      });
    });
    expect(mockFetch.mock.calls[1][0] as string).not.toContain('campaigns=');
  });

  it('omits integrations when none are selected and throws on a failed response', async () => {
    mockFetch.mockResolvedValue({ ok: false });
    const { result } = renderHook(() => useExport());
    await expect(
      result.current.download({ from: '2024-01-01', to: '2024-01-07', format: 'json' })
    ).rejects.toThrow('Failed to export');
    expect(mockFetch.mock.calls[0][0]).not.toContain('integrations=');
  });
});
