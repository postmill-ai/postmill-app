import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StockPhotos } from './stock-photos';

const search = vi.hoisted(() => ({ result: {} as any }));

vi.mock('./use-stock-search', () => ({ useStockSearch: () => search.result }));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn() }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, params?: Record<string, unknown>) =>
    params ? Object.entries(params).reduce((text, [key, value]) => text.replace(`{{${key}}}`, String(value)), fallback) : fallback,
}));

const photo = {
  id: 'photo-1',
  url: 'https://cdn.example.test/photo.jpg',
  thumbUrl: 'https://cdn.example.test/thumb.jpg',
  description: 'QA mountain photo',
  author: 'QA Photographer',
  authorUrl: 'https://example.test/photographer',
  sourceUrl: 'https://example.test/photo',
  source: 'unsplash',
  width: 1600,
  height: 900,
  downloadLocation: 'https://provider.example.test/download',
  attribution: { provider: 'Unsplash' },
};

beforeEach(() => {
  search.result = {
    items: [photo],
    lastPage: { results: [photo], page: 1, totalPages: 1, configured: true, source: 'unsplash' },
    error: undefined,
    isLoading: false,
    isValidating: false,
    size: 1,
    setSize: vi.fn(),
    mutate: vi.fn(),
  };
});

describe('StockPhotos in Elements mode', () => {
  it('uses the compact layout and emits identical select and drag metadata', () => {
    const onSelectFull = vi.fn();
    const onDragStart = vi.fn();
    const { container } = render(
      <StockPhotos mode="select" compact onSelectFull={onSelectFull} onDragStart={onDragStart} />
    );
    const tile = screen.getByRole('button', { name: 'QA mountain photo' });

    expect(tile).toHaveProperty('draggable', true);
    expect(container.querySelector('.columns-2')?.className).not.toContain('lg:columns-4');
    fireEvent.click(tile);
    fireEvent.dragStart(tile);

    const expected = expect.objectContaining({
      url: photo.url,
      type: 'image',
      width: 1600,
      height: 900,
      downloadLocation: photo.downloadLocation,
      attribution: { provider: 'Unsplash' },
    });
    expect(onSelectFull).toHaveBeenCalledWith(expected);
    expect(onDragStart).toHaveBeenCalledWith(expected, expect.anything());
  });

  it('retains the safe provider error and retry action', () => {
    const mutate = vi.fn();
    search.result = {
      ...search.result,
      items: [],
      lastPage: {
        results: [], page: 1, totalPages: 1, configured: true, source: 'unsplash',
        error: 'Provider temporarily unavailable',
      },
      mutate,
    };
    render(<StockPhotos mode="select" compact />);

    expect(screen.getByText("Couldn't reach Unsplash")).toBeDefined();
    expect(screen.getByText(/Provider temporarily unavailable/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('retains the unconfigured capability state', () => {
    search.result = {
      ...search.result,
      items: [],
      lastPage: { results: [], page: 1, totalPages: 1, configured: false },
    };
    render(<StockPhotos mode="select" compact />);

    expect(screen.getByText("Stock browsing isn't configured")).toBeDefined();
    expect(screen.queryByPlaceholderText('Search photos...')).toBeNull();
  });
});
