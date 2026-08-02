import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars
      ? Object.entries(vars).reduce(
          (s, [k, v]) => s.replace(`{{${k}}}`, String(v)),
          fallback
        )
      : fallback,
}));
vi.mock('@postmill-ai/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (p: string) => p }),
}));
vi.mock('@postmill-ai/react/translation/i18next', () => ({
  default: { resolvedLanguage: 'en' },
}));

import { FileGrid } from './file-grid';
import type { FileItem } from './file-manager';
import type { FolderItem } from './folder.utils';

const file = (id: string, name: string): FileItem => ({
  id,
  name: `${id}.png`,
  originalName: name,
  path: `/uploads/${id}.png`,
  thumbnail: null,
  alt: null,
  thumbnailTimestamp: null,
  fileSize: 1024,
  type: 'image',
  tags: null,
  description: null,
  folderId: null,
  createdAt: '2026-07-01T00:00:00.000Z',
});

const folder = (id: string, name: string): FolderItem => ({
  id,
  name,
  color: null,
  parentId: null,
  children: [],
  _count: { files: 3, children: 0 },
});

const baseProps = {
  selectedFiles: [],
  onToggleSelect: vi.fn(),
  onFileClick: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FileGrid', () => {
  it('renders folders before files', () => {
    render(
      <FileGrid
        {...baseProps}
        files={[file('f1', 'alpha.png')]}
        folders={[folder('d1', 'Brand assets')]}
        onFolderOpen={vi.fn()}
      />
    );

    const tiles = screen.getAllByRole('button');
    // Folder tile first, then the file tile.
    expect(tiles[0].getAttribute('aria-label')).toBe('Open folder Brand assets');
    expect(tiles[1].textContent).toContain('alpha.png');
  });

  it('labels the two sections only when both are present', () => {
    const { rerender } = render(
      <FileGrid
        {...baseProps}
        files={[file('f1', 'alpha.png')]}
        folders={[folder('d1', 'Brand')]}
        onFolderOpen={vi.fn()}
      />
    );
    expect(screen.getByText('Folders')).toBeTruthy();
    expect(screen.getByText('Files')).toBeTruthy();

    rerender(<FileGrid {...baseProps} files={[]} folders={[folder('d1', 'Brand')]} onFolderOpen={vi.fn()} />);
    expect(screen.queryByText('Folders')).toBeNull();
  });

  it('renders a folder-only directory (does not bail out when files are empty)', () => {
    render(
      <FileGrid {...baseProps} files={[]} folders={[folder('d1', 'Brand')]} onFolderOpen={vi.fn()} />
    );

    expect(screen.getByText('Brand')).toBeTruthy();
  });

  it('renders nothing when there are neither files nor folders', () => {
    const { container } = render(<FileGrid {...baseProps} files={[]} folders={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('opens the folder on click rather than selecting it — even in picker mode', () => {
    // Folders never enter the file selection model, so the picker's onSelect
    // must not fire for them.
    const onFolderOpen = vi.fn();
    const onSelect = vi.fn();
    render(
      <FileGrid
        {...baseProps}
        files={[]}
        folders={[folder('d1', 'Brand')]}
        onFolderOpen={onFolderOpen}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByLabelText('Open folder Brand'));

    expect(onFolderOpen).toHaveBeenCalledWith('d1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows the folder item count', () => {
    render(
      <FileGrid {...baseProps} files={[]} folders={[folder('d1', 'Brand')]} onFolderOpen={vi.fn()} />
    );

    expect(screen.getByText('3 items')).toBeTruthy();
  });

  it('right-click on a file tile opens the file menu, not the folder menu', () => {
    const onFileMenu = vi.fn();
    const onFolderMenu = vi.fn();
    const target = file('f1', 'alpha.png');
    render(
      <FileGrid
        {...baseProps}
        files={[target]}
        folders={[folder('d1', 'Brand')]}
        onFolderOpen={vi.fn()}
        onFileMenu={onFileMenu}
        onFolderMenu={onFolderMenu}
      />
    );

    const fileTile = screen.getAllByRole('button')[1];
    fireEvent.contextMenu(fileTile, { clientX: 40, clientY: 50 });

    expect(onFileMenu).toHaveBeenCalledTimes(1);
    expect(onFileMenu.mock.calls[0][1]).toEqual(target);
    expect(onFolderMenu).not.toHaveBeenCalled();
  });

  it('right-click on a folder tile opens the folder menu', () => {
    const onFolderMenu = vi.fn();
    const target = folder('d1', 'Brand');
    render(
      <FileGrid
        {...baseProps}
        files={[]}
        folders={[target]}
        onFolderOpen={vi.fn()}
        onFolderMenu={onFolderMenu}
      />
    );

    fireEvent.contextMenu(screen.getByLabelText('Open folder Brand'), { clientX: 1, clientY: 2 });

    expect(onFolderMenu.mock.calls[0][1]).toEqual(target);
  });

  it('selects a file on click and previews on double-click when not picking', () => {
    const onToggleSelect = vi.fn();
    const onFileClick = vi.fn();
    const target = file('f1', 'alpha.png');
    render(
      <FileGrid
        {...baseProps}
        onToggleSelect={onToggleSelect}
        onFileClick={onFileClick}
        files={[target]}
        folders={[]}
      />
    );

    const tile = screen.getByRole('button');
    fireEvent.click(tile);
    expect(onToggleSelect).toHaveBeenCalledWith(target);

    fireEvent.doubleClick(tile);
    expect(onFileClick).toHaveBeenCalledWith(target);
  });
});
