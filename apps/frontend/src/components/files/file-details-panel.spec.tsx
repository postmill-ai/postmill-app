import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

let mediaBase = '';
const mockFetch = vi.fn();
const mockPush = vi.fn();
const mockToast = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@postmill-ai/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (p: string) => `${mediaBase}${p}` }),
}));
vi.mock('@postmill-ai/react/translation/i18next', () => ({
  default: { resolvedLanguage: 'en' },
}));
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToast }),
}));
vi.mock('@postmill-ai/frontend/components/media-tools/audio-player', () => ({
  AudioPlayer: () => null,
}));
vi.mock('@postmill-ai/frontend/components/campaigns/selector/campaign-selector', () => ({
  CampaignSelector: () => null,
}));

import { FileDetailsPanel } from './file-details-panel';
import type { FileItem } from './file-manager';

const file: FileItem = {
  id: 'f1',
  name: 'abc123.png',
  originalName: 'Brand logo.png',
  path: '/uploads/abc123.png',
  thumbnail: null,
  alt: null,
  thumbnailTimestamp: null,
  fileSize: 2048,
  type: 'image',
  tags: null,
  description: null,
  folderId: null,
  createdAt: '2026-07-01T00:00:00.000Z',
};

const renderPanel = () =>
  render(<FileDetailsPanel file={file} onClose={vi.fn()} onRefresh={vi.fn()} />);

describe('FileDetailsPanel — Download vs Open file', () => {
  let clicked: { href: string; download: string }[];
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push({ href: this.href, download: this.download });
    });
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(
      () => 'blob:http://localhost/obj-1'
    );
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mediaBase = '';
  });

  it('Download saves a same-origin file via an anchor with the download attribute', async () => {
    renderPanel();
    fireEvent.click(screen.getByText('Download'));

    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0].href).toBe(`${window.location.origin}/uploads/abc123.png`);
    expect(clicked[0].download).toBe('Brand logo.png');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('Download fetches a cross-origin file into a blob and saves the object URL', async () => {
    mediaBase = 'https://cdn.example.com';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['png']),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    fireEvent.click(screen.getByText('Download'));

    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/uploads/abc123.png');
    expect(clicked[0].href).toBe('blob:http://localhost/obj-1');
    expect(clicked[0].download).toBe('Brand logo.png');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('Download falls back to opening the file when the cross-origin fetch fails', async () => {
    mediaBase = 'https://cdn.example.com';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('CORS')));

    renderPanel();
    fireEvent.click(screen.getByText('Download'));

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith('https://cdn.example.com/uploads/abc123.png', '_blank')
    );
    expect(clicked).toHaveLength(0);
  });

  it('Open file opens the file in a new tab without downloading', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Open file'));

    expect(openSpy).toHaveBeenCalledWith('/uploads/abc123.png', '_blank');
    expect(clicked).toHaveLength(0);
  });
});

describe('FileDetailsPanel — design previews and Designer actions', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockPush.mockReset();
    mockToast.mockReset();
  });

  afterEach(cleanup);

  const design: FileItem = {
    ...file,
    id: 'design-file',
    name: 'snapshot.pdesign',
    originalName: 'Snapshot.pdesign',
    path: '/uploads/snapshot.pdesign',
    thumbnail: '/thumbnails/snapshot.png',
    type: 'document',
    metadata: { kind: 'design', mode: 'video', durationMs: 65_000 },
  };

  it('shows a design thumbnail, identity, duration, and Designer action without a ZIP image', () => {
    const { container } = render(<FileDetailsPanel file={design} onClose={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('/thumbnails/snapshot.png');
    expect(screen.getByText('Video design')).toBeTruthy();
    expect(screen.getByText('1:05')).toBeTruthy();
    expect(screen.getByText('Open in Designer')).toBeTruthy();
    expect(container.querySelector('img[src="/uploads/snapshot.pdesign"]')).toBeNull();
  });

  it('shows an intentional design fallback and imports before opening the new design', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'imported-id' }) });
    const onClose = vi.fn();
    render(<FileDetailsPanel file={{ ...design, thumbnail: null }} onClose={onClose} onRefresh={vi.fn()} />);
    expect(screen.getByTestId('file-preview-fallback').textContent).toContain('Video design');
    expect(screen.queryByRole('img')).toBeNull();

    fireEvent.click(screen.getByText('Open in Designer'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/media/designer?designId=imported-id'));
    expect(mockFetch).toHaveBeenCalledWith('/media/designs/import-library', {
      method: 'POST',
      body: JSON.stringify({ fileId: 'design-file' }),
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the drawer open and reports import errors', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'Unsupported bundle' }) });
    const onClose = vi.fn();
    render(<FileDetailsPanel file={design} onClose={onClose} onRefresh={vi.fn()} drawerMode />);

    fireEvent.click(screen.getByText('Open in Designer'));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Unsupported bundle', 'warning'));
    expect(onClose).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not offer Designer for unsupported documents', () => {
    render(<FileDetailsPanel file={{ ...design, name: 'report.pdf', originalName: 'report.pdf', path: '/report.pdf', thumbnail: null, metadata: null }} onClose={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText('No preview available')).toBeTruthy();
    expect(screen.queryByText('Open in Designer')).toBeNull();
  });
});
