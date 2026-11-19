import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyDesignsPanel } from './my-designs-panel';

const fetchMock = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({ useFetch: () => fetchMock }));
vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: 'org-1' }),
}));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useDecisionModal: () => ({ open: vi.fn() }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, params?: Record<string, string | number>) =>
    Object.entries(params || {}).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
      fallback,
    ),
}));

const design = (id: string, name: string) => ({
  id,
  name,
  mode: 'image',
  updatedAt: '2026-11-19T00:00:00.000Z',
  previewUrl: `/uploads/${id}.png`,
});
const response = (body: unknown) => ({ ok: true, json: async () => body });

const renderPanel = (initialBatchId?: string) => {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MyDesignsPanel onOpen={onOpen} onClose={onClose} initialBatchId={initialBatchId} />
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
        return response({ designs: [design('standalone', 'Standalone')], total: 1 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows batch cards without duplicating variations and opens siblings', async () => {
    const { onOpen, onClose } = renderPanel();

    expect(await screen.findByText('Catalog batch')).toBeTruthy();
    expect(screen.getByText('Standalone')).toBeTruthy();
    expect(screen.queryByText('Variation 1')).toBeNull();

    fireEvent.click(screen.getByText('Catalog batch'));
    expect(await screen.findByText('Variation 1')).toBeTruthy();
    expect(screen.getByText('Variation 2')).toBeTruthy();
    expect(screen.queryByText('Standalone')).toBeNull();

    fireEvent.click(screen.getByText('Variation 2'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'variation-2' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('opens an initial batch directly after a deep-linked reload', async () => {
    renderPanel('batch-1');

    expect(await screen.findByText('Variation 1')).toBeTruthy();
    expect(screen.getByText('Variation 2')).toBeTruthy();
    expect(screen.queryByText('Standalone')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/media/designs/batches/batch-1');
  });
});
