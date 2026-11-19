import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyDesignsPanel } from './my-designs-panel';

const fetchMock = vi.fn();
const decisionOpen = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({ useFetch: () => fetchMock }));
vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: 'org-1' }),
}));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useDecisionModal: () => ({ open: decisionOpen }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback: string, params?: Record<string, string | number>) => {
    const text = key === 'my_designs_panel_variation_count' && params?.count !== undefined
      ? params.count === 1 ? '{{count}} variation' : '{{count}} variations'
      : fallback;
    return Object.entries(params || {}).reduce(
      (result, [param, value]) => result.replaceAll(`{{${param}}}`, String(value)),
      text,
    );
  },
}));

const design = (id: string, name: string, mode: 'image' | 'video' = 'image') => ({
  id,
  name,
  mode,
  updatedAt: '2026-11-19T00:00:00.000Z',
  previewUrl: `/uploads/${id}.png`,
});
const response = (body: unknown) => ({ ok: true, json: async () => body });

const renderPanel = (initialBatchId?: string, imageOnly = false) => {
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
          designs: [design('standalone', 'Standalone'), design('video-only', 'Video only', 'video')],
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
    const { onOpen, onClose } = renderPanel();

    expect(await screen.findByText('Catalog batch')).toBeTruthy();
    expect(screen.getByText('2 variations')).toBeTruthy();
    expect(screen.getByText('Standalone')).toBeTruthy();
    expect(screen.queryByText('Variation 1')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/media/designs?page=1&limit=50&group=root');

    fireEvent.click(screen.getByText('Catalog batch'));
    expect(await screen.findByText('Variation 1')).toBeTruthy();
    expect(screen.getByText('Variation 2')).toBeTruthy();
    expect(screen.queryByText('Standalone')).toBeNull();

    fireEvent.click(screen.getByText('Variation 2'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'variation-2' }));
    expect(onClose).toHaveBeenCalledOnce();
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
    renderPanel();

    expect(await screen.findByText('1 variation')).toBeTruthy();
    fireEvent.click(screen.getByText('Catalog batch'));
    expect(await screen.findByText('1 variation')).toBeTruthy();
    expect(screen.queryByText('1 variations')).toBeNull();
  });

  it('filters video designs out of the image-only source picker', async () => {
    renderPanel(undefined, true);

    expect(await screen.findByText('Standalone')).toBeTruthy();
    expect(screen.queryByText('Video only')).toBeNull();
  });

  it('opens an initial batch directly after a deep-linked reload', async () => {
    renderPanel('batch-1');

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
    renderPanel('batch-1');

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Variation 1' }));

    await screen.findByText('0 variations');
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/media/designs/batches/batch-1').length)
        .toBeGreaterThan(1);
      expect(fetchMock.mock.calls.filter(([url]) => url === '/media/designs/batches?page=1&limit=50').length)
        .toBeGreaterThan(1);
      expect(fetchMock.mock.calls.filter(([url]) => url === '/media/designs?page=1&limit=50&group=root').length)
        .toBeGreaterThan(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '← All designs' }));
    expect(await screen.findByText('Standalone')).toBeTruthy();
    expect(screen.queryByText('Catalog batch')).toBeNull();
  });
});
