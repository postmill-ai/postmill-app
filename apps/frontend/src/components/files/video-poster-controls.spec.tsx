import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VideoPosterControls } from './video-poster-controls';
import type { FileItem } from './file-manager';

const mockFetch = vi.fn();
const mockToast = vi.fn();

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToast }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@postmill-ai/frontend/components/media-tools/designer/read-error-message', () => ({
  readErrorMessage: async (res: { message?: string }, fallback: string) => res.message || fallback,
}));

const file: FileItem = {
  id: 'video-1',
  name: 'video.mp4',
  originalName: 'video.mp4',
  path: '/uploads/video.mp4',
  thumbnail: '/uploads/old-poster.jpg',
  alt: 'Product video',
  thumbnailTimestamp: 1250,
  fileSize: 5000,
  type: 'video',
  tags: null,
  description: null,
  folderId: 'folder-1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  mockFetch.mockReset();
  mockToast.mockReset();
});

describe('VideoPosterControls', () => {
  it('uploads and persists a custom thumbnail before reporting success', async () => {
    const onUpdated = vi.fn();
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ path: '/uploads/new-poster.png' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    render(<VideoPosterControls file={file} onUpdated={onUpdated} />);

    fireEvent.change(screen.getByLabelText('Upload custom thumbnail'), {
      target: { files: [new File(['poster'], 'poster.png', { type: 'image/png' })] },
    });

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith('/uploads/new-poster.png'));
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe('/files/upload-simple');
    expect(mockFetch.mock.calls[0][1].body).toBeInstanceOf(FormData);
    expect(mockFetch.mock.calls[0][1].body.get('folderId')).toBe('folder-1');
    expect(mockFetch.mock.calls[1][0]).toBe('/files/information');
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
      id: 'video-1',
      alt: 'Product video',
      thumbnail: '/uploads/new-poster.png',
      thumbnailTimestamp: 1250,
    });
    expect(mockToast).toHaveBeenCalledWith('Thumbnail updated', 'success');
  });

  it('reports an upload failure without changing the poster', async () => {
    const onUpdated = vi.fn();
    mockFetch.mockResolvedValue({ ok: false, message: 'Storage is full' });
    render(<VideoPosterControls file={file} onUpdated={onUpdated} />);

    fireEvent.change(screen.getByLabelText('Upload custom thumbnail'), {
      target: { files: [new File(['poster'], 'poster.png', { type: 'image/png' })] },
    });

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Storage is full', 'warning'));
    expect(onUpdated).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous poster when persistence fails', async () => {
    const onUpdated = vi.fn();
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ path: '/uploads/new-poster.png' }) })
      .mockResolvedValueOnce({ ok: false, message: 'Could not update metadata' });
    render(<VideoPosterControls file={file} onUpdated={onUpdated} />);

    fireEvent.change(screen.getByLabelText('Upload custom thumbnail'), {
      target: { files: [new File(['poster'], 'poster.png', { type: 'image/png' })] },
    });

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Could not update metadata', 'warning'));
    expect(onUpdated).not.toHaveBeenCalled();
    expect(screen.getByRole('img', { name: 'Current video thumbnail' }).getAttribute('src')).toBe(
      '/uploads/old-poster.jpg'
    );
  });
});
