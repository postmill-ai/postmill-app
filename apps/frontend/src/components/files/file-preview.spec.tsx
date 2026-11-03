import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileThumbnail } from './file-preview';
import type { FileItem } from './file-manager';

const mockNextImage = vi.fn();

vi.mock('next/image', () => ({
  default: React.forwardRef<HTMLImageElement, Record<string, unknown>>(function MockNextImage(props, ref) {
    mockNextImage(props);
    // eslint-disable-next-line @next/next/no-img-element -- test mock
    return <img ref={ref} src={String(props.src)} alt={String(props.alt)} />;
  }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const file = (patch: Partial<FileItem>): FileItem => ({
  id: 'file-1',
  name: 'asset.png',
  originalName: 'asset.png',
  path: '/uploads/asset.png',
  thumbnail: null,
  alt: null,
  thumbnailTimestamp: null,
  fileSize: 1000,
  type: 'image',
  tags: null,
  description: null,
  folderId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});

let intersect: IntersectionObserverCallback = () => {};
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

beforeEach(() => {
  mockNextImage.mockClear();
  mockObserve.mockClear();
  mockDisconnect.mockClear();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) {
      intersect = callback;
    }
    observe = mockObserve;
    disconnect = mockDisconnect;
    unobserve = vi.fn();
  });
});

describe('FileThumbnail loading', () => {
  it('uses an optimized, explicitly sized image for same-origin media', () => {
    render(<FileThumbnail file={file({})} />);

    expect(mockNextImage).toHaveBeenCalledTimes(1);
    expect(mockNextImage.mock.calls[0][0]).toMatchObject({
      src: '/uploads/asset.png',
      fill: true,
      loading: 'lazy',
      decoding: 'async',
    });
    expect(String(mockNextImage.mock.calls[0][0].sizes)).toContain('200px');
  });

  it('optimizes absolute same-origin storage URLs through their local path', () => {
    render(
      <FileThumbnail
        file={file({ path: `${window.location.origin}/uploads/asset.png?version=2` })}
      />
    );

    expect(mockNextImage).toHaveBeenCalledTimes(1);
    expect(mockNextImage.mock.calls[0][0]).toMatchObject({
      src: '/uploads/asset.png?version=2',
      fill: true,
    });
  });

  it('keeps the plain image fallback for remote storage', () => {
    render(<FileThumbnail file={file({ path: 'https://cdn.example.com/asset.png' })} />);

    expect(mockNextImage).not.toHaveBeenCalled();
    expect(screen.getByRole('img', { name: 'asset.png' }).getAttribute('src')).toBe(
      'https://cdn.example.com/asset.png'
    );
  });

  it('does not request video metadata until the tile approaches the viewport', () => {
    const { container } = render(
      <FileThumbnail file={file({ name: 'movie.mp4', path: '/uploads/movie.mp4', type: 'video' })} />
    );

    expect(container.querySelector('video')).toBeNull();
    expect(mockObserve).toHaveBeenCalledTimes(1);

    act(() => {
      intersect(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(container.querySelector('video')?.getAttribute('src')).toBe('/uploads/movie.mp4');
    expect(container.querySelector('video')?.getAttribute('preload')).toBe('metadata');
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
