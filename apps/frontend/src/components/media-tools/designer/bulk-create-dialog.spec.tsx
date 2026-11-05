import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BulkCreateDialog } from './bulk-create-dialog';
import { createDesignerStore } from './designer.store';

const fetchMock = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, params?: Record<string, unknown>) =>
    Object.entries(params || {}).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
      fallback,
    ),
}));

const response = (body: unknown, ok = true) => ({ ok, json: vi.fn(async () => body) });
const makeStore = () => {
  const store = createDesignerStore(1080, 1080);
  store.getState().addElement({
    id: '', type: 'text', text: 'Hello {{headline}}', x: 0, y: 0, width: 300, height: 100,
    rotation: 0, opacity: 1, locked: false, hidden: false,
  });
  store.getState().setDesignName('Campaign');
  return store;
};
const upload = async (contents: string) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([contents], 'rows.csv', { type: 'text/csv' })] } });
  await waitFor(() => expect(screen.getByText('2 data rows loaded')).toBeTruthy());
};

beforeEach(() => {
  fetchMock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('BulkCreateDialog', () => {
  it('maps columns, previews the first row, polls and exposes editable results and the ZIP', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ images: ['data:image/png;base64,preview'] }))
      .mockResolvedValueOnce(response({ id: 'job-1', status: 'pending' }))
      .mockResolvedValueOnce(response({ id: 'job-1', status: 'processing', progress: { done: 1, total: 2 } }))
      .mockResolvedValueOnce(response({
        id: 'job-1', status: 'completed', artifactUrl: '/uploads/org/bulk.zip',
        progress: { done: 2, total: 2 },
        results: [
          { row: 1, designId: 'design-1', fileIds: ['file-1'] },
          { row: 2, error: 'Invalid image', fileIds: [] },
        ],
      }));
    render(<BulkCreateDialog store={makeStore()} onClose={vi.fn()} />);
    await upload('headline,unused\n"Hello, Ada",x\nGrace,y');

    fireEvent.click(screen.getByRole('button', { name: 'Preview first row' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/media/designs/bulk-generate', expect.any(Object)));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).rows).toEqual([{ headline: 'Hello, Ada' }]);
    expect(await screen.findByRole('img', { name: 'First Bulk Create row' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Create 2 variations' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/media/designs/bulk-create', expect.objectContaining({ method: 'POST' })));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      nameBase: 'Campaign', rows: [{ headline: 'Hello, Ada' }, { headline: 'Grace' }],
    });
    expect(await screen.findByText('1 of 2 rows processed')).toBeTruthy();

    expect(await screen.findByText('Bulk Create complete', undefined, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download PNG bundle (.zip)' }).getAttribute('href')).toBe('/uploads/org/bulk.zip');
    expect(screen.getByRole('link', { name: 'Open editable design' }).getAttribute('href')).toBe('/media/designer?designId=design-1');
    expect(screen.getByText('Invalid image')).toBeTruthy();
  });

  it('rejects duplicate headers and malformed quoted input before any API call', async () => {
    render(<BulkCreateDialog store={makeStore()} onClose={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['name,name\na,b'], 'rows.csv')] } });
    expect(await screen.findByText('Column headers must be unique.')).toBeTruthy();

    fireEvent.change(input, { target: { files: [new File(['name\n"unclosed'], 'rows.csv')] } });
    expect(await screen.findByText('The spreadsheet contains an unclosed quoted field.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
