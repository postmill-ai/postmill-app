import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockFetchFn = vi.fn();

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('swr', () => ({ default: vi.fn() }));

import useSWR from 'swr';
import { useInboxPreview } from './useInboxPreview';

const mockUseSWR = vi.mocked(useSWR);

describe('useInboxPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    } as any);
  });

  it('subscribes to the inbox endpoint with the default limit', () => {
    renderHook(() => useInboxPreview());

    expect(mockUseSWR.mock.calls[0][0]).toBe(
      '/posts/inbox?unreadOnly=true&status=needs_reply&limit=4'
    );
  });

  it('subscribes to the inbox endpoint with a custom limit', () => {
    renderHook(() => useInboxPreview(10));

    expect(mockUseSWR.mock.calls[0][0]).toBe(
      '/posts/inbox?unreadOnly=true&status=needs_reply&limit=10'
    );
  });

  it('disables revalidation on focus and reconnect', () => {
    renderHook(() => useInboxPreview());

    const options = mockUseSWR.mock.calls[0][2] as any;
    expect(options.revalidateOnFocus).toBe(false);
    expect(options.revalidateOnReconnect).toBe(false);
  });

  it('returns loading state while data is loading', () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: vi.fn(),
    } as any);

    const { result } = renderHook(() => useInboxPreview());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('returns data state with comments', () => {
    const data = {
      comments: [
        {
          id: '1',
          authorName: 'Alice',
          authorPicture: null,
          content: 'Hello!',
          platformCreatedAt: new Date().toISOString(),
          post: null,
        },
      ],
      nextCursor: 'cursor-1',
    };

    mockUseSWR.mockReturnValue({
      data,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    } as any);

    const { result } = renderHook(() => useInboxPreview());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual(data);
    expect(result.current.data?.comments).toHaveLength(1);
  });

  it('returns empty state when comments array is empty', () => {
    mockUseSWR.mockReturnValue({
      data: { comments: [] },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    } as any);

    const { result } = renderHook(() => useInboxPreview());

    expect(result.current.data?.comments).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
  });

  it('fetcher throws on non-ok response', async () => {
    renderHook(() => useInboxPreview());
    const load = mockUseSWR.mock.calls[0][1] as (url: string) => Promise<any>;

    mockFetchFn.mockResolvedValueOnce({ ok: false });

    await expect(load('/posts/inbox')).rejects.toThrow('Failed to load inbox');
  });

  it('fetcher returns parsed json on ok response', async () => {
    renderHook(() => useInboxPreview());
    const load = mockUseSWR.mock.calls[0][1] as (url: string) => Promise<any>;

    const payload = {
      comments: [
        {
          id: '2',
          authorName: 'Bob',
          authorPicture: null,
          content: 'Hi',
          platformCreatedAt: new Date().toISOString(),
          post: null,
        },
      ],
    };
    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce(payload),
    });

    await expect(load('/posts/inbox')).resolves.toEqual(payload);
    expect(mockFetchFn).toHaveBeenCalledWith('/posts/inbox');
  });
});
