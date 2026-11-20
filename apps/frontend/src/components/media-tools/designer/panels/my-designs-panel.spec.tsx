import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { MyDesignsPanel, MyDesign } from './my-designs-panel';

const mockFetch = vi.fn();
const mockDecisionOpen = vi.fn();
const mockT = (key: string, fallback: string, params?: Record<string, any>) => {
  const text = key === 'my_designs_panel_variation_count' && params?.count !== undefined
    ? params.count === 1 ? '{{count}} variation' : '{{count}} variations'
    : fallback;
  return Object.entries(params || {}).filter(([key]) => key !== 'interpolation').reduce(
    (result, [param, value]) => result.replaceAll(`{{${param}}}`, String(value)),
    text,
  );
};

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


const fetchMock = mockFetch;
const decisionOpen = mockDecisionOpen;
const renderBatchPanel = (initialBatchId?: string, imageOnly = false) => {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MyDesignsPanel
        onOpen={onOpen}
        onClose={onClose}
        initialBatchId={initialBatchId}
        imageOnly={imageOnly}
      />
    </SWRConfig>
  );
  return { onOpen, onClose };
};

describe('MyDesignsPanel batches', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/media/designs/batches/batch-1')) {
        return response({
          id: 'batch-1', name: 'Catalog batch',
          designs: [design('variation-1', 'Variation 1'), design('variation-2', 'Variation 2')],
        });
      }
      if (url.startsWith('/media/designs/batches?')) {
        return response({
          batches: [{
            id: 'batch-1', name: 'Catalog batch', count: 2,
            updatedAt: '2026-11-19T00:00:00.000Z', previewUrl: '/uploads/variation-1.png',
          }],
          total: 1,
        });
      }
      if (url.startsWith('/media/designs?')) {
        return response({
          designs: [design('standalone', 'Standalone'), design('video-only', 'Video only', { mode: 'video' })],
          total: 2,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('requests only root designs and shows batches without duplicating variations', async () => {
    const { onOpen, onClose } = renderBatchPanel();

    expect(await screen.findByText('Catalog batch')).toBeTruthy();
    expect(screen.getByText('2 variations')).toBeTruthy();
    expect(screen.getByText('Standalone')).toBeTruthy();
    expect(screen.queryByText('Variation 1')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/media/designs?page=1&limit=24&group=root&sort=newest');

    fireEvent.click(screen.getByText('Catalog batch'));
    expect(await screen.findByText('Variation 1')).toBeTruthy();
    expect(screen.getByText('Variation 2')).toBeTruthy();
    expect(screen.queryByText('Standalone')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open Variation 2' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'variation-2' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('uses the singular variation label on the card and batch header', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/media/designs/batches/batch-1')) {
        return response({
          id: 'batch-1', name: 'Catalog batch', designs: [design('variation-1', 'Variation 1')],
        });
      }
      if (url.startsWith('/media/designs/batches?')) {
        return response({
          batches: [{ id: 'batch-1', name: 'Catalog batch', count: 1 }],
          total: 1,
        });
      }
      if (url.startsWith('/media/designs?')) return response({ designs: [], total: 0 });
      throw new Error(`Unexpected request: ${url}`);
    });
    renderBatchPanel();

    expect(await screen.findByText('1 variation')).toBeTruthy();
    fireEvent.click(screen.getByText('Catalog batch'));
    expect(await screen.findByText('1 variation')).toBeTruthy();
    expect(screen.queryByText('1 variations')).toBeNull();
  });

  it('hides unfiltered batches while searching designs', async () => {
    renderBatchPanel();
    expect(await screen.findByText('Catalog batch')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search designs' }), {
      target: { value: 'Standalone' },
    });

    await waitFor(() => expect(screen.queryByText('Catalog batch')).toBeNull());
    expect(screen.getByText('Standalone')).toBeTruthy();
  });

  it('filters video designs out of the image-only source picker', async () => {
    renderBatchPanel(undefined, true);

    expect(await screen.findByText('Standalone')).toBeTruthy();
    expect(screen.queryByText('Video only')).toBeNull();
  });

  it('opens an initial batch directly after a deep-linked reload', async () => {
    renderBatchPanel('batch-1');

    expect(await screen.findByText('Variation 1')).toBeTruthy();
    expect(screen.getByText('Variation 2')).toBeTruthy();
    expect(screen.queryByText('Standalone')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/media/designs/batches/batch-1');
  });

  it('refreshes the root, batch list, and active batch after deleting the last member', async () => {
    let live = true;
    decisionOpen.mockResolvedValue(true);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/media/designs/variation-1' && init?.method === 'DELETE') {
        live = false;
        return response({});
      }
      if (url.startsWith('/media/designs/batches/batch-1')) {
        return response({
          id: 'batch-1', name: 'Catalog batch',
          designs: live ? [design('variation-1', 'Variation 1')] : [],
        });
      }
      if (url.startsWith('/media/designs/batches?')) {
        return response({
          batches: live ? [{ id: 'batch-1', name: 'Catalog batch', count: 1 }] : [],
          total: live ? 1 : 0,
        });
      }
      if (url.startsWith('/media/designs?')) {
        return response({ designs: [design('standalone', 'Standalone')], total: 1 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    renderBatchPanel('batch-1');

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Variation 1' }));

    await screen.findByText('0 variations');
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/media/designs/batches/batch-1').length)
        .toBeGreaterThan(1);
      expect(fetchMock.mock.calls.filter(([url]) => url === '/media/designs/batches?page=1&limit=24').length)
        .toBeGreaterThan(1);
      expect(fetchMock.mock.calls.filter(([url]) => url === '/media/designs?page=1&limit=24&group=root&sort=newest').length)
        .toBeGreaterThan(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '← All designs' }));
    expect(await screen.findByText('Standalone')).toBeTruthy();
    expect(screen.queryByText('Catalog batch')).toBeNull();
  });
});
