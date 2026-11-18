import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
          { row: 1, designId: 'design-1', fileIds: ['file-1'], editableFileId: 'editable-1' },
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
    expect(screen.getByRole('link', { name: 'Download PNG + editable designs (.zip)' }).getAttribute('href')).toBe('/uploads/org/bulk.zip');
    expect(screen.getByRole('link', { name: 'Open Recent Designs' }).getAttribute('href')).toBe('/media/designer');
    expect(screen.getByRole('link', { name: 'Open editable design' }).getAttribute('href')).toBe('/media/designer?designId=design-1');
    expect(screen.getByText(/The ZIP also includes each \.pdesign file/)).toBeTruthy();
    expect(screen.getByText('Invalid image')).toBeTruthy();
  });

  it('guides a design with no variables from column assignment to an editable variation', async () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'title', name: 'Headline', type: 'text', text: 'Sale', x: 0, y: 0, width: 300, height: 100,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().addElement({
      id: 'photo', name: 'Headline', type: 'image', src: 'https://cdn.example.test/original.png',
      x: 0, y: 100, width: 300, height: 300, rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().addElement({
      id: 'background', type: 'shape', shape: 'rect', fill: '#000000',
      x: 0, y: 0, width: 1080, height: 1080, rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().addPage();
    store.getState().addElement({
      id: 'second-title', type: 'text', text: 'Second page', x: 0, y: 0, width: 300, height: 100,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().setSelectedIds(['title', 'photo', 'background', 'second-title']);
    const historyBefore = store.getState().history.length;
    fetchMock
      .mockResolvedValueOnce(response({ images: ['data:image/png;base64,preview'] }))
      .mockResolvedValueOnce(response({ id: 'job-2', status: 'pending' }))
      .mockResolvedValueOnce(response({
        id: 'job-2', status: 'completed', artifactUrl: '/uploads/org/bulk.zip',
        results: [{ row: 1, designId: 'editable-1', fileIds: ['file-1'] }],
      }));
    render(<BulkCreateDialog store={store} onClose={vi.fn()} />);
    await upload('headline,hero_image,accent_color\nAda,https://cdn.example.test/ada.png,#ff0000\nGrace,https://cdn.example.test/grace.png,#00ff00');

    fireEvent.click(screen.getByRole('button', { name: 'Apply variable assignments' }));
    const slotFor = (id: string) => store.getState().doc.outputs[0].children.find((child) => child.id === id)?.slot;
    await waitFor(() => expect(slotFor('title')).toEqual({ name: 'headline', kind: 'text' }));
    expect(slotFor('photo')).toEqual({ name: 'hero_image', kind: 'image' });
    expect(slotFor('background')).toEqual({ name: 'accent_color', kind: 'color' });
    expect(store.getState().doc.outputs[0].pages[0].children[0].slot).toEqual({ name: 'headline', kind: 'text' });
    expect(store.getState().history).toHaveLength(historyBefore + 1);

    fireEvent.click(screen.getByRole('button', { name: 'Preview first row' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/media/designs/bulk-generate', expect.any(Object)));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).rows).toEqual([{
      headline: 'Ada', hero_image: 'https://cdn.example.test/ada.png', accent_color: '#ff0000',
    }]);

    fireEvent.click(screen.getByRole('button', { name: 'Create 2 variations' }));
    expect(await screen.findByRole('link', { name: 'Open editable design' })).toHaveProperty(
      'href', 'http://localhost:3000/media/designer?designId=editable-1'
    );
    const batch = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(batch.rows[1]).toEqual({
      headline: 'Grace', hero_image: 'https://cdn.example.test/grace.png', accent_color: '#00ff00',
    });
    expect(batch.doc.outputs[0].pages[0].children[0].slot.name).toBe('headline');
  });

  it('applies text and colour assignments in separate passes before previewing both', async () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'title', name: 'Headline', type: 'text', text: 'Sale', fill: '#000000',
      x: 0, y: 0, width: 300, height: 100, rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().setSelectedIds([]);
    const historyBefore = store.getState().history.length;
    fetchMock.mockResolvedValueOnce(response({ images: ['data:image/png;base64,preview'] }));
    render(<BulkCreateDialog store={store} onClose={vi.fn()} />);
    await upload('headline,accent\nWinter Sale,#d62828\nSpring Sale,#007700');

    let selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(2);
    fireEvent.change(selects[0], { target: { value: 'headline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply variable assignments' }));
    const title = () => store.getState().doc.outputs[0].children.find((child) => child.id === 'title');
    await waitFor(() => expect(title()?.slot).toEqual({ name: 'headline', kind: 'text' }));
    expect(title()?.fill).toBe('#000000');

    selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[selects.length - 1], { target: { value: 'accent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply variable assignments' }));
    await waitFor(() => expect(title()?.fill).toBe('{{accent}}'));
    expect(title()?.slot).toEqual({ name: 'headline', kind: 'text' });
    expect(store.getState().history).toHaveLength(historyBefore + 2);

    fireEvent.click(screen.getByRole('button', { name: 'Preview first row' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/media/designs/bulk-generate', expect.any(Object)));
    const preview = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(preview.rows).toEqual([{ headline: 'Winter Sale', accent: '#d62828' }]);
    expect(preview.doc.outputs[0].children[0].slot).toEqual({ name: 'headline', kind: 'text' });
    expect(preview.doc.outputs[0].children[0].fill).toBe('{{accent}}');
  });

  it('discovers a selected symbol definition and previews its newly assigned variable', async () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'symbol-title', name: 'Symbol headline', type: 'text', text: 'Footer',
      x: 0, y: 0, width: 300, height: 100, rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().setSelectedIds(['symbol-title']);
    store.getState().createSymbol('Footer');
    fetchMock.mockResolvedValueOnce(response({ images: ['data:image/png;base64,preview'] }));
    render(<BulkCreateDialog store={store} onClose={vi.fn()} />);
    await upload('headline\nAda\nGrace');

    fireEvent.change(screen.getByRole('combobox', {
      name: 'Column for Symbol Footer: Symbol headline (text)',
    }), { target: { value: 'headline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply variable assignments' }));
    await waitFor(() => expect(store.getState().doc.symbols?.[0].children[0].slot).toEqual({
      name: 'headline', kind: 'text',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Preview first row' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/media/designs/bulk-generate', expect.any(Object)));
    const preview = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(preview.rows).toEqual([{ headline: 'Ada' }]);
    expect(preview.doc.symbols[0].children[0].slot).toEqual({ name: 'headline', kind: 'text' });
  });

  it('leaves unselected targets unassigned and applies only explicit choices', async () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'first', name: 'First', type: 'text', text: 'First', x: 0, y: 0, width: 300, height: 100,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().addElement({
      id: 'second', name: 'Second', type: 'text', text: 'Second', x: 0, y: 100, width: 300, height: 100,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().setSelectedIds([]);
    render(<BulkCreateDialog store={store} onClose={vi.fn()} />);
    await upload('headline\nAda\nGrace');

    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(4);
    expect(selects.map((select) => (select as HTMLSelectElement).value)).toEqual(['', '', '', '']);
    expect(screen.getByRole('button', { name: 'Apply variable assignments' })).toHaveProperty('disabled', true);

    fireEvent.change(selects[0], { target: { value: 'headline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply variable assignments' }));
    const children = store.getState().doc.outputs[0].children;
    expect(children.find((child) => child.id === 'first')?.slot).toEqual({ name: 'headline', kind: 'text' });
    expect(children.find((child) => child.id === 'second')?.slot).toBeUndefined();
  });

  it('shows an error and preserves history when an assignment targets a frozen output', async () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'title', name: 'Headline', type: 'text', text: 'Sale',
      x: 0, y: 0, width: 300, height: 100, rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().setSelectedIds(['title']);
    store.getState().setOutputFrozen(0, true);
    const before = store.getState().doc;
    const historyLength = store.getState().history.length;
    render(<BulkCreateDialog store={store} onClose={vi.fn()} />);
    await upload('headline\nAda\nGrace');

    fireEvent.click(screen.getByRole('button', { name: 'Apply variable assignments' }));

    expect((await screen.findByRole('alert')).textContent).toContain('This format is frozen');
    expect(store.getState().doc).toBe(before);
    expect(store.getState().history).toHaveLength(historyLength);
  });

  it('disables creation when there are no editable targets', async () => {
    render(<BulkCreateDialog store={createDesignerStore()} onClose={vi.fn()} />);
    await upload('name\nAda\nGrace');

    expect(screen.getByRole('button', { name: 'Create 2 variations' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Add an editable text, image, or color element before creating variations.')).toBeTruthy();
  });

  it('uses new assignments for preview and creation before React re-renders', async () => {
    const store = makeStore();
    store.getState().addElement({
      id: 'accent', type: 'shape', shape: 'rect', fill: '#0000ff',
      x: 0, y: 120, width: 100, height: 100, rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().addElement({
      id: 'hero', name: 'Hero', type: 'image', src: 'https://cdn.example.test/original.png',
      x: 120, y: 120, width: 100, height: 100, rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().addElement({
      id: 'gradient', name: 'Brand gradient', type: 'shape', shape: 'rect', fill: '#0000ff',
      fillGradient: {
        type: 'linear', stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
      },
      x: 240, y: 120, width: 100, height: 100, rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().setSelectedIds([]);
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/media/designs/bulk-generate') return response({ images: ['data:image/png;base64,preview'] });
      if (url === '/media/designs/bulk-create') return response({ id: 'job-current', status: 'pending' });
      return response({ id: 'job-current', status: 'completed', results: [] });
    });
    render(<BulkCreateDialog store={store} onClose={vi.fn()} />);
    await upload('headline,accent_color,hero_image,gradient_start,gradient_end\nAda,#ff0000,https://cdn.example.test/ada.png,#110000,#000011\nGrace,#00ff00,https://cdn.example.test/grace.png,#220000,#000022');
    const assign = (name: string, value: string) => fireEvent.change(
      screen.getByRole('combobox', { name }), { target: { value } },
    );
    assign('Column for Instagram Post / Page 1: accent (color)', 'accent_color');
    assign('Column for Instagram Post / Page 1: Hero (image)', 'hero_image');
    assign('Column for Instagram Post / Page 1: Brand gradient gradient stop 1 (color)', 'gradient_start');
    assign('Column for Instagram Post / Page 1: Brand gradient gradient stop 2 (color)', 'gradient_end');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply variable assignments' }));
      fireEvent.click(screen.getByRole('button', { name: 'Preview first row' }));
      fireEvent.click(screen.getByRole('button', { name: 'Create 2 variations' }));
    });

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/media/designs/bulk-create')).toHaveLength(1));
    const previewCall = fetchMock.mock.calls.find(([url]) => url === '/media/designs/bulk-generate')!;
    const preview = JSON.parse(previewCall[1].body);
    const firstRow = {
      headline: 'Ada', accent_color: '#ff0000', hero_image: 'https://cdn.example.test/ada.png',
      gradient_start: '#110000', gradient_end: '#000011',
    };
    const secondRow = {
      headline: 'Grace', accent_color: '#00ff00', hero_image: 'https://cdn.example.test/grace.png',
      gradient_start: '#220000', gradient_end: '#000022',
    };
    expect(preview.rows).toEqual([firstRow]);
    expect(preview.doc.outputs[0].children[1].slot).toEqual({ name: 'accent_color', kind: 'color' });
    expect(preview.doc.outputs[0].children[2].slot).toEqual({ name: 'hero_image', kind: 'image' });
    expect(preview.doc.outputs[0].children[3].fillGradient.stops.map((stop: any) => stop.color))
      .toEqual(['{{gradient_start}}', '{{gradient_end}}']);
    const batchCall = fetchMock.mock.calls.find(([url]) => url === '/media/designs/bulk-create')!;
    const batch = JSON.parse(batchCall[1].body);
    expect(batch.rows).toEqual([firstRow, secondRow]);
    expect(batch.doc.outputs[0].children[1].slot).toEqual({ name: 'accent_color', kind: 'color' });
    expect(batch.doc.outputs[0].children[2].slot).toEqual({ name: 'hero_image', kind: 'image' });
    expect(batch.doc.outputs[0].children[3].fillGradient.stops.map((stop: any) => stop.color))
      .toEqual(['{{gradient_start}}', '{{gradient_end}}']);
  });

  it('blocks duplicate batch requests while starting and unlocks after an error', async () => {
    let releaseFirst!: (value: unknown) => void;
    let first = true;
    fetchMock.mockImplementation((url: string) => {
      if (url === '/media/designs/bulk-create') {
        if (first) {
          first = false;
          return new Promise((resolve) => { releaseFirst = resolve; });
        }
        return Promise.resolve(response({ id: 'job-retry', status: 'pending' }));
      }
      return Promise.resolve(response({ id: 'job-retry', status: 'completed', results: [] }));
    });
    render(<BulkCreateDialog store={makeStore()} onClose={vi.fn()} />);
    await upload('headline\nAda\nGrace');
    const create = screen.getByRole('button', { name: 'Create 2 variations' });

    act(() => {
      fireEvent.click(create);
      fireEvent.click(create);
    });

    expect(fetchMock.mock.calls.filter(([url]) => url === '/media/designs/bulk-create')).toHaveLength(1);
    await act(async () => { releaseFirst(response({ message: 'Try again' }, false)); });
    expect((await screen.findByRole('alert')).textContent).toContain('Try again');
    await waitFor(() => expect(create).toHaveProperty('disabled', false));

    fireEvent.click(create);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/media/designs/bulk-create')).toHaveLength(2));
  });

  it('shows the server row, spreadsheet schema path and remote image error', async () => {
    fetchMock.mockResolvedValueOnce(response({
      message: 'Row 3: rows[2].product_image (outputs.0.pages.0.children.0.src): Blocked URL',
    }, false));
    render(<BulkCreateDialog store={makeStore()} onClose={vi.fn()} />);
    await upload('headline,unused\nAda,x\nGrace,y');

    fireEvent.click(screen.getByRole('button', { name: 'Create 2 variations' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Row 3: rows[2].product_image (outputs.0.pages.0.children.0.src): Blocked URL'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
