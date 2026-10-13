import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useImportStockMedia } from './media-import';

const fetchMock = vi.fn();

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

const stockItem = {
  id: 'unsplash-1',
  source: 'stock' as const,
  type: 'photo',
  name: 'Mountain lake',
  url: 'https://images.example/lake.jpg',
  stockSource: 'unsplash',
};

const okResponse = () =>
  ({
    ok: true,
    json: async () => ({ id: 'file-1', path: '/uploads/file-1.jpg' }),
  }) as Response;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(okResponse());
});

describe('useImportStockMedia', () => {
  it('passes the aiDesigner marker through to /files/import', async () => {
    const { result } = renderHook(() => useImportStockMedia());

    await result.current(stockItem as any, { aiDesigner: 'reference' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/files/import');
    expect(JSON.parse(init.body)).toMatchObject({
      url: stockItem.url,
      aiDesigner: 'reference',
    });
  });

  it('omits the marker for ordinary imports', async () => {
    const { result } = renderHook(() => useImportStockMedia());

    await result.current(stockItem as any);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).not.toHaveProperty('aiDesigner');
  });

  it('returns the imported item as a file-sourced media item', async () => {
    const { result } = renderHook(() => useImportStockMedia());

    const imported = await result.current(stockItem as any, {
      aiDesigner: 'reference',
    });

    expect(imported).toMatchObject({
      source: 'file',
      fileId: 'file-1',
      url: '/uploads/file-1.jpg',
    });
  });
});
