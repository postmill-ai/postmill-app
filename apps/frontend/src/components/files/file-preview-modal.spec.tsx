import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockFetch, mockPush, mockCloseAll, mockToast, mockOpenInDesigner } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockPush: vi.fn(),
  mockCloseAll: vi.fn(),
  mockToast: vi.fn(),
  mockOpenInDesigner: vi.fn(),
}));

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock('@postmill-ai/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (path: string) => path }),
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToast }),
}));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ closeAll: mockCloseAll }),
}));
vi.mock('@postmill-ai/frontend/components/media-tools/open-in-designer', () => ({
  openInDesigner: mockOpenInDesigner,
}));
vi.mock('@postmill-ai/frontend/components/media-tools/audio-player', () => ({
  AudioPlayer: () => <div data-testid="audio-player" />,
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

import { FilePreviewModal } from './file-preview-modal';
import type { FileItem } from './file-manager';

const file = (overrides: Partial<FileItem> = {}): FileItem => ({
  id: 'design-file',
  name: 'snapshot.pdesign',
  originalName: 'Snapshot.pdesign',
  path: '/uploads/snapshot.pdesign',
  thumbnail: '/thumbnails/snapshot.png',
  alt: null,
  thumbnailTimestamp: null,
  fileSize: 2048,
  type: 'document',
  tags: null,
  description: null,
  folderId: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  metadata: { kind: 'template', mode: 'video', durationMs: 5000 },
  ...overrides,
});

beforeEach(() => {
  mockFetch.mockReset();
  mockPush.mockReset();
  mockCloseAll.mockReset();
  mockToast.mockReset();
  mockOpenInDesigner.mockReset();
});

afterEach(cleanup);

describe('FilePreviewModal', () => {
  it('shows a design thumbnail and identity without rendering the ZIP as an image', () => {
    const { container } = render(<FilePreviewModal file={file()} />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('/thumbnails/snapshot.png');
    expect(screen.getByText(/Video template/)).toBeTruthy();
    expect(container.querySelector('img[src="/uploads/snapshot.pdesign"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open in Designer' })).toBeTruthy();
  });

  it('shows intentional fallbacks for designs without thumbnails and ordinary documents', () => {
    const { rerender } = render(<FilePreviewModal file={file({ thumbnail: null })} />);
    expect(screen.getByTestId('file-preview-fallback').textContent).toContain('Video template');
    expect(screen.queryByRole('img')).toBeNull();

    rerender(<FilePreviewModal file={file({ name: 'report.pdf', originalName: 'report.pdf', path: '/report.pdf', thumbnail: null, metadata: null })} />);
    expect(screen.getByText('No preview available')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open in Designer' })).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('imports a design snapshot, closes the modal, and opens the new design', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'new design/id', name: 'Imported' }) });
    render(<FilePreviewModal file={file()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open in Designer' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/media/designer?designId=new%20design%2Fid'));
    expect(mockFetch).toHaveBeenCalledWith('/media/designs/import-library', {
      method: 'POST',
      body: JSON.stringify({ fileId: 'design-file' }),
    });
    expect(mockCloseAll).toHaveBeenCalledTimes(1);
  });

  it('shows the API error and keeps the modal open when import fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'Bundle is corrupt' }) });
    render(<FilePreviewModal file={file()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open in Designer' }));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Bundle is corrupt', 'warning'));
    expect(mockCloseAll).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open in Designer' })).toBeTruthy();
  });

  it('retains the existing media Designer handoff and video poster', () => {
    const video = file({
      id: 'video-file',
      name: 'clip.mov',
      originalName: 'clip.mov',
      path: '/uploads/clip.mov',
      type: 'video/quicktime',
      metadata: null,
    });
    const { container } = render(<FilePreviewModal file={video} />);
    expect(container.querySelector('video')?.getAttribute('poster')).toBe('/thumbnails/snapshot.png');

    fireEvent.click(screen.getByRole('button', { name: 'Open in Designer' }));
    expect(mockOpenInDesigner).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'video',
      artifactUrl: '/uploads/clip.mov',
      thumbUrl: '/thumbnails/snapshot.png',
    }), mockPush);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
