import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({ useFetch: () => vi.fn() }));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({ useToaster: () => ({ show: vi.fn() }) }));
vi.mock('@postmill-ai/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (path: string) => path }),
}));
vi.mock('@postmill-ai/react/translation/i18next', () => ({ default: { resolvedLanguage: 'en' } }));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? Object.entries(vars).reduce((text, [key, value]) => text.replace(`{{${key}}}`, String(value)), fallback) : fallback,
}));

import { FileList } from './file-list';
import type { FileItem } from './file-manager';

const file = (overrides: Partial<FileItem> = {}): FileItem => ({
  id: 'f1',
  name: 'snapshot.pdesign',
  originalName: 'Snapshot.pdesign',
  path: '/uploads/snapshot.pdesign',
  thumbnail: '/thumbnails/snapshot.png',
  alt: null,
  thumbnailTimestamp: null,
  fileSize: 1000,
  type: 'document',
  tags: null,
  description: null,
  folderId: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

const renderList = (files: FileItem[]) => render(
  <FileList
    files={files}
    selectedFiles={[]}
    onToggleSelect={vi.fn()}
    onFileClick={vi.fn()}
    sortField="createdAt"
    sortOrder="desc"
    onSort={vi.fn()}
  />
);

afterEach(cleanup);

describe('FileList', () => {
  it('uses design thumbnails, meaningful type labels, and known video durations without a play overlay', () => {
    const { container } = renderList([file({ metadata: { kind: 'template', mode: 'video', durationMs: 65_000 } })]);
    expect(screen.getByRole('img').getAttribute('src')).toBe('/thumbnails/snapshot.png');
    expect(screen.getByText('Video template')).toBeTruthy();
    expect(screen.getByTestId('video-duration-badge').textContent).toBe('1:05');
    expect(screen.queryByTestId('video-play-overlay')).toBeNull();
    expect(container.querySelector('img[src="/uploads/snapshot.pdesign"]')).toBeNull();
  });

  it('shows an intentional fallback instead of a document image', () => {
    const { container } = renderList([file({ name: 'report.pdf', originalName: 'report.pdf', path: '/report.pdf', thumbnail: null })]);
    expect(screen.getByText('No preview available')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('probes legacy real videos with metadata-only preload and hides invalid durations', () => {
    const { container } = renderList([file({
      name: 'clip.webm',
      originalName: 'clip.webm',
      path: '/clip.webm',
      type: 'video',
      thumbnail: null,
    })]);
    const probe = container.querySelector('video.hidden') as HTMLVideoElement;
    expect(probe.getAttribute('preload')).toBe('metadata');
    Object.defineProperty(probe, 'duration', { configurable: true, value: 61.2 });
    fireEvent.loadedMetadata(probe);
    expect(screen.getByTestId('video-duration-badge').textContent).toBe('1:01');
    expect(screen.getByTestId('video-play-overlay').className).toContain('top-');

    Object.defineProperty(probe, 'duration', { configurable: true, value: Number.POSITIVE_INFINITY });
    fireEvent.loadedMetadata(probe);
    expect(screen.queryByTestId('video-duration-badge')).toBeNull();
  });
});
