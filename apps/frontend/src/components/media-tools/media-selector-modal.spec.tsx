import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars
      ? Object.entries(vars).reduce((s, [k, v]) => s.replace(`{{${k}}}`, String(v)), fallback)
      : fallback,
}));

const mockToast = vi.fn();
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToast }),
}));

const mockFetch = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

// The stock tabs and the file browser each pull in large trees; this spec is
// about the picker's chrome and selection contract, so stand them in.
vi.mock('./stock-photos', () => ({
  StockPhotos: ({ onSelectFull }: any) => (
    <button
      data-testid="stock-photo"
      onClick={() =>
        onSelectFull({
          url: 'https://stock.example/p.jpg',
          width: 10,
          height: 10,
          type: 'image',
          name: 'Stock Photo',
          source: 'unsplash',
        })
      }
    >
      pick stock
    </button>
  ),
}));
vi.mock('./stock-videos', () => ({ StockVideos: () => <div /> }));
vi.mock('./stock-vectors', () => ({ StockVectors: () => <div /> }));
vi.mock('./stock-stickers', () => ({ StockStickers: () => <div /> }));
vi.mock('./stock-icons', () => ({ StockIcons: () => <div /> }));
vi.mock('@postmill-ai/frontend/components/files/file-manager', () => ({
  FileManager: ({ onSelect }: any) => (
    <button
      data-testid="my-file"
      onClick={() => onSelect([{ id: 'file-1', path: '/uploads/a.png', name: 'a.png', type: 'image/png' }])}
    >
      pick file
    </button>
  ),
}));

import { MediaSelectorModal } from './media-selector-modal';

const noop = () => {};

beforeEach(() => {
  mockToast.mockClear();
  mockFetch.mockReset();
});
afterEach(cleanup);

describe('MediaSelectorModal chrome', () => {
  it('names itself, so the dialog is never anonymous', () => {
    render(<MediaSelectorModal open onClose={noop} />);

    const dialog = screen.getByRole('dialog');
    expect(screen.getByRole('heading', { name: 'Select media' })).toBeTruthy();
    // The accessible name comes from the visible title, not a hidden aria-label.
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)!.textContent).toBe('Select media');
    expect(dialog.getAttribute('aria-label')).toBeNull();
  });

  it('takes a contextual title from the caller', () => {
    render(<MediaSelectorModal open onClose={noop} title="Background image" />);
    expect(screen.getByRole('heading', { name: 'Background image' })).toBeTruthy();
  });

  it('is exactly one dialog — no nested chrome', () => {
    render(<MediaSelectorModal open onClose={noop} title="Add media" />);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('keeps the same panel size in single and multi-select mode', () => {
    const { unmount } = render(<MediaSelectorModal open onClose={noop} />);
    const single = screen.getByTestId('media-picker').className;
    unmount();

    render(<MediaSelectorModal open onClose={noop} multiple />);
    expect(screen.getByTestId('media-picker').className).toBe(single);
  });

  it('renders nothing when closed', () => {
    const { container } = render(<MediaSelectorModal open={false} onClose={noop} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('MediaSelectorModal tabs', () => {
  const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent);

  it('opens on your own files, not on stock', () => {
    render(<MediaSelectorModal open onClose={noop} />);

    expect(tabNames()[0]).toBe('My Files');
    expect(screen.getByRole('tab', { name: 'My Files' }).getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  it('takes an explicit tab list verbatim, in order', () => {
    // `kinds` can't separate the image sub-sources — Photos, Vectors, Stickers
    // and Icons are all 'image' — so "My Files and stock photos, nothing else"
    // needs an allow-list.
    render(
      <MediaSelectorModal open onClose={noop} tabs={['My Files', 'Stock Photos']} />
    );
    expect(tabNames()).toEqual(['My Files', 'Photos']);
  });

  it('lets the tab list beat kinds and excludeTabs', () => {
    render(
      <MediaSelectorModal
        open
        onClose={noop}
        tabs={['Stock Videos']}
        kinds={['image']}
        excludeTabs={['Stock Videos']}
      />
    );
    expect(tabNames()).toEqual(['Videos']);
  });

  it('ignores a tab name it does not have', () => {
    render(
      <MediaSelectorModal
        open
        onClose={noop}
        tabs={['My Files', 'Stock Nonsense' as never]}
      />
    );
    expect(tabNames()).toEqual(['My Files']);
  });

  it('labels the stock group once rather than on every tab', () => {
    render(<MediaSelectorModal open onClose={noop} />);
    // The whole point of the change: no tab repeats the word.
    expect(tabNames().some((n) => n?.startsWith('Stock '))).toBe(false);
    expect(screen.getAllByText('Stock:')).toHaveLength(1);
  });

  it('still leads with My Files when kinds filters the stock tabs away', () => {
    render(<MediaSelectorModal open onClose={noop} kinds={['audio']} />);

    // Audio now has a stock source of its own, so the tab list is My Files
    // plus Stock: Audio.
    expect(tabNames()).toEqual(['My Files', 'Audio']);
  });

  it('drops individual stock tabs via excludeTabs', () => {
    render(
      <MediaSelectorModal
        open
        onClose={noop}
        kinds={['image', 'video']}
        excludeTabs={['Stock Stickers', 'Stock Icons']}
      />
    );

    expect(tabNames()).not.toContain('Stickers');
    expect(tabNames()).not.toContain('Icons');
    expect(tabNames()).toContain('Photos');
  });
});

describe('MediaSelectorModal selection', () => {
  it('hands back a file pick and closes', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<MediaSelectorModal open onClose={onClose} onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId('my-file'));

    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect.mock.calls[0][0]).toMatchObject({
      source: 'file',
      fileId: 'file-1',
      url: '/uploads/a.png',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('accumulates a batch in multi-select and confirms it', async () => {
    const onConfirm = vi.fn();
    render(<MediaSelectorModal open onClose={noop} multiple onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('my-file'));
    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onConfirm.mock.calls[0][0]).toHaveLength(1);
  });
});

describe('MediaSelectorModal requireFile', () => {
  it('imports a stock pick so the caller always gets a fileId', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'imported-1', path: '/uploads/imported.png' }),
    });
    const onSelect = vi.fn();
    render(
      <MediaSelectorModal open onClose={noop} onSelect={onSelect} requireFile importName="logo" />
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Photos' }));
    fireEvent.click(screen.getByTestId('stock-photo'));

    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledWith('/files/import', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).name).toBe('logo');
    expect(onSelect.mock.calls[0][0]).toMatchObject({
      source: 'file',
      fileId: 'imported-1',
      url: '/uploads/imported.png',
    });
  });

  it('does not import a pick that is already a file', async () => {
    const onSelect = vi.fn();
    render(<MediaSelectorModal open onClose={noop} onSelect={onSelect} requireFile />);

    fireEvent.click(screen.getByTestId('my-file'));

    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and warns when the import fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 415, text: async () => 'nope' });
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<MediaSelectorModal open onClose={onClose} onSelect={onSelect} requireFile />);

    fireEvent.click(screen.getByRole('tab', { name: 'Photos' }));
    fireEvent.click(screen.getByTestId('stock-photo'));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    // Handing back a fileId-less item is what used to strand picks silently.
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
