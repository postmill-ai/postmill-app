import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { MyDesignsPanel, MyDesign } from './my-designs-panel';

const mockFetch = vi.fn();
const mockDecisionOpen = vi.fn();
const mockT = (_key: string, fallback: string, params?: Record<string, any>) =>
  Object.entries(params || {}).filter(([key]) => key !== 'interpolation').reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
    fallback,
  );

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: 'org-1' }),
}));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useDecisionModal: () => ({ open: mockDecisionOpen }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({ useT: () => mockT }));
vi.mock('use-debounce', () => ({ useDebounce: (value: string) => [value, {}] }));

const design = (id: string, name = id, extra: Partial<MyDesign> = {}): MyDesign => ({
  id,
  name,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  previewUrl: `/uploads/${id}.png`,
  mode: 'image',
  ...extra,
});
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
const renderPanel = (onOpen = vi.fn()) => {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MyDesignsPanel onOpen={onOpen} />
    </SWRConfig>,
  );
  return onOpen;
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockDecisionOpen.mockResolvedValue(true);
});

describe('MyDesignsPanel', () => {
  it('searches and sorts the full library, loads more without duplicate ids, and persists size', async () => {
    const records = Array.from({ length: 25 }, (_, index) => design(`d-${index + 1}`, `Design ${index + 1}`));
    mockFetch.mockImplementation(async (url: string) => {
      const request = new URL(url, 'https://app.postmill.ai');
      const query = request.searchParams.get('query');
      const filtered = query ? [design('unloaded', 'R&D launch')] : records;
      const page = Number(request.searchParams.get('page'));
      const start = (page - 1) * 24;
      return response({ designs: filtered.slice(start, start + 24), total: filtered.length, page, limit: 24 });
    });
    renderPanel();

    expect((await screen.findAllByRole('listitem')).length).toBe(24);
    const initialUrl = new URL(mockFetch.mock.calls[0][0], 'https://app.postmill.ai');
    expect(initialUrl.searchParams.get('sort')).toBe('newest');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(25));
    expect(new Set(screen.getAllByRole('listitem').map((card) => card.getAttribute('data-design-id'))).size).toBe(25);

    fireEvent.change(screen.getByRole('textbox', { name: 'Search designs' }), { target: { value: ' R&D ' } });
    expect(await screen.findByText('R&D launch')).toBeTruthy();
    expect(screen.queryByText('Design 1')).toBeNull();
    let lastUrl = new URL(mockFetch.mock.calls.at(-1)![0], 'https://app.postmill.ai');
    expect(lastUrl.searchParams.get('query')).toBe('R&D');
    expect(lastUrl.searchParams.get('page')).toBe('1');

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), { target: { value: 'name' } });
    await waitFor(() => {
      lastUrl = new URL(mockFetch.mock.calls.at(-1)![0], 'https://app.postmill.ai');
      expect(lastUrl.searchParams.get('sort')).toBe('name');
    });
    expect(lastUrl.searchParams.get('page')).toBe('1');

    const grid = screen.getByRole('list');
    expect(grid.getAttribute('style')).toContain('200px');
    fireEvent.click(screen.getByRole('button', { name: 'Size S' }));
    expect(localStorage.getItem('designer-gallery-size-org-1')).toBe('s');
    expect(grid.getAttribute('style')).toContain('150px');
    expect(screen.getByRole('button', { name: 'Size S' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('opens designs, confirms deletion, and revalidates loaded pages', async () => {
    const onOpen = vi.fn().mockResolvedValue(undefined);
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'DELETE') return response({});
      return response({ designs: [design('d1', 'Q&A 1/2')], total: 1, page: 1, limit: 24 });
    });
    renderPanel(onOpen);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Q&A 1/2' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Q&A 1/2' }));
    await waitFor(() => expect(mockDecisionOpen).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledWith('/media/designs/d1', { method: 'DELETE' });
    expect(mockFetch.mock.calls.filter(([, options]) => !options?.method).length).toBeGreaterThan(1);
  });

  it('uses a preview fallback for missing and broken images and offers retry after failures', async () => {
    mockFetch.mockResolvedValueOnce(response({}, false));
    renderPanel();
    expect((await screen.findByRole('alert')).textContent).toContain('Failed to load designs');

    mockFetch.mockResolvedValueOnce(response({
      designs: [design('missing', 'Missing', { previewUrl: null, previewDataUrl: null })],
      total: 1, page: 1, limit: 24,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No preview available')).toBeTruthy();

    mockFetch.mockResolvedValue(response({
      designs: [design('broken', 'Broken')], total: 1, page: 1, limit: 24,
    }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search designs' }), { target: { value: 'broken' } });
    const image = await screen.findByRole('img', { name: 'Broken preview' });
    fireEvent.error(image);
    expect(screen.getByText('No preview available')).toBeTruthy();
  });
});
