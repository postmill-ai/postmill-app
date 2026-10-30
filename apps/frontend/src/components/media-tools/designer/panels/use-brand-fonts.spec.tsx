import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUploadCustomFont } from './use-brand-fonts';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  mutate: vi.fn(),
  show: vi.fn(),
}));

vi.mock('swr', () => ({
  default: vi.fn(),
  useSWRConfig: () => ({ mutate: mocks.mutate }),
}));
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mocks.fetch,
}));
vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: 'org-1' }),
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mocks.show }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, params?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(params?.[key] ?? '')),
}));

const response = (ok: boolean, body: unknown = {}) => ({
  ok,
  json: vi.fn().mockResolvedValue(body),
});

const font = (name: string) => new File(['font'], name, { type: 'font/ttf' });

describe('useUploadCustomFont batch uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutate.mockResolvedValue(undefined);
  });

  it('uploads sequentially with one pending state and one final refresh', async () => {
    let resolveFirst: (value: ReturnType<typeof response>) => void;
    let resolveSecond: (value: ReturnType<typeof response>) => void;
    const firstResponse = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveFirst = resolve;
    });
    const secondResponse = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveSecond = resolve;
    });
    mocks.fetch
      .mockReturnValueOnce(firstResponse)
      .mockReturnValueOnce(secondResponse);

    const { result } = renderHook(() => useUploadCustomFont());
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.uploadMany([font('one.ttf'), font('two.ttf')]);
    });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    expect(result.current.uploading).toBe(true);
    expect(mocks.mutate).not.toHaveBeenCalled();

    resolveFirst!(response(true, { uploaded: { serverRender: true } }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(result.current.uploading).toBe(true);
    resolveSecond!(response(true, { uploaded: { serverRender: true } }));
    await act(async () => pending);

    expect(result.current.uploading).toBe(false);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith('custom-fonts-org-1');
    expect(mocks.show).toHaveBeenCalledWith('2 fonts uploaded', 'success');
  });

  it('continues after validation and server failures and reports per-file results', async () => {
    mocks.fetch
      .mockResolvedValueOnce(response(false, { message: 'Server rejected font' }))
      .mockResolvedValueOnce(response(true, { uploaded: { serverRender: false } }));
    const { result } = renderHook(() => useUploadCustomFont());

    let results: Awaited<ReturnType<typeof result.current.uploadMany>>;
    await act(async () => {
      results = await result.current.uploadMany([
        font('bad.txt'),
        font('rejected.ttf'),
        font('browser-only.woff2'),
      ]);
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(results!.map(({ success }) => success)).toEqual([false, false, true]);
    expect(results![0].error).toContain('Invalid file type');
    expect(results![1].error).toBe('Server rejected font');
    expect(results![2].serverRender).toBe(false);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledWith(
      '1 of 3 fonts uploaded; 2 failed. WOFF2 fonts are not used in server-rendered exports.',
      'warning',
    );
  });

  it('returns successful uploads when the cache refresh fails', async () => {
    mocks.fetch.mockResolvedValue(response(true, { uploaded: { serverRender: true } }));
    mocks.mutate.mockRejectedValue(new Error('refresh failed'));
    const { result } = renderHook(() => useUploadCustomFont());

    let results: Awaited<ReturnType<typeof result.current.uploadMany>>;
    await act(async () => {
      results = await result.current.uploadMany([font('uploaded.ttf')]);
    });

    expect(results!.map(({ success }) => success)).toEqual([true]);
    expect(result.current.uploading).toBe(false);
    expect(mocks.show).toHaveBeenCalledWith(
      'Fonts uploaded, but the font list could not be refreshed.',
      'warning',
    );
    expect(mocks.show).toHaveBeenCalledWith('Font uploaded', 'success');
  });

  it('retains the single-file wrapper', async () => {
    mocks.fetch.mockResolvedValue(response(true, { uploaded: { serverRender: true } }));
    const { result } = renderHook(() => useUploadCustomFont());

    let uploaded = false;
    await act(async () => {
      uploaded = await result.current.upload(font('single.ttf'));
    });

    expect(uploaded).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledWith('Font uploaded', 'success');
  });
});
