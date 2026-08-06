import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';

const mockFetch = vi.fn();
const mockPush = vi.fn();
const mockReplace = vi.fn();
const navigation = { pathname: '/files' };

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars
      ? Object.entries(vars).reduce((s, [k, v]) => s.replace(`{{${k}}}`, String(v)), fallback)
      : fallback,
}));
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
vi.mock('@postmill-ai/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (p: string) => p }),
}));
vi.mock('@postmill-ai/react/translation/i18next', () => ({
  default: { resolvedLanguage: 'en' },
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => navigation.pathname,
}));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn(), closeAll: vi.fn() }),
}));
// The uploader pulls in Uppy, which is heavy and irrelevant here.
vi.mock('@postmill-ai/frontend/components/files/file-uploader', () => ({
  FileUploader: () => <div data-testid="uploader" />,
}));

import { FileManager } from './file-manager';

const FOLDERS = [
  {
    id: 'd1',
    name: 'Brand assets',
    color: null,
    parentId: null,
    children: [
      { id: 'd1a', name: 'Logos', color: null, parentId: 'd1', children: [], _count: { files: 2, children: 0 } },
    ],
    _count: { files: 5, children: 1 },
  },
];

const FILES = [
  {
    id: 'f1',
    name: 'f1.png',
    originalName: 'alpha.png',
    path: '/uploads/f1.png',
    thumbnail: null,
    alt: null,
    thumbnailTimestamp: null,
    fileSize: 1024,
    type: 'image',
    tags: null,
    description: null,
    folderId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
  },
];

const respondWith = ({ files = FILES, folders = FOLDERS }: { files?: unknown[]; folders?: unknown[] } = {}) => {
  mockFetch.mockImplementation((url: string) => {
    if (url.startsWith('/files/folders')) {
      return Promise.resolve({ ok: true, json: async () => folders });
    }
    return Promise.resolve({ ok: true, json: async () => ({ results: files, pages: 1 }) });
  });
};

const renderManager = (props: Record<string, unknown> = {}) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <FileManager standalone {...props} />
    </SWRConfig>
  );

beforeEach(() => {
  localStorage.clear();
  mockFetch.mockReset();
  mockPush.mockReset();
  mockReplace.mockReset();
  navigation.pathname = '/files';
  respondWith();
});
afterEach(cleanup);

describe('FileManager folders in the browse area', () => {
  it('renders the current folder’s subfolders ahead of files', async () => {
    renderManager();

    await waitFor(() => expect(screen.getAllByLabelText(/^Open folder /)).toHaveLength(1));
    expect(screen.getByLabelText('Open folder Brand assets')).toBeTruthy();
    // "Logos" is a grandchild of the root — only direct children show.
    expect(screen.queryByLabelText('Open folder Logos')).toBeNull();
  });

  it('hides folders once a search term is active', async () => {
    renderManager();
    await waitFor(() => expect(screen.getByLabelText('Open folder Brand assets')).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('Search files by name, tags...'), {
      target: { value: 'alpha' },
    });

    await waitFor(() => expect(screen.queryByLabelText('Open folder Brand assets')).toBeNull());
  });

  it('hides folders once a type filter is active', async () => {
    renderManager();
    await waitFor(() => expect(screen.getByLabelText('Open folder Brand assets')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Filter by file type'), { target: { value: 'video' } });

    await waitFor(() => expect(screen.queryByLabelText('Open folder Brand assets')).toBeNull());
  });

  it('shows folders instead of the empty state when a folder has no files', async () => {
    respondWith({ files: [] });
    renderManager();

    await waitFor(() => expect(screen.getByLabelText('Open folder Brand assets')).toBeTruthy());
    expect(screen.queryByText('This folder is empty')).toBeNull();
  });

  it('shows the empty state only when there are neither folders nor files', async () => {
    respondWith({ files: [], folders: [] });
    renderManager();

    await waitFor(() => expect(screen.getByText('This folder is empty')).toBeTruthy());
  });
});

describe('FileManager sidebar', () => {
  it('renders the inline sidebar toggle on a standalone surface', async () => {
    renderManager();
    await waitFor(() => expect(screen.getByText('Hide folders')).toBeTruthy());
  });

  it('persists the collapsed preference and hides the inline sidebar', async () => {
    renderManager();
    await waitFor(() => expect(screen.getByText('Hide folders')).toBeTruthy());

    fireEvent.click(screen.getByText('Hide folders'));

    await waitFor(() => expect(screen.getByText('Show folders')).toBeTruthy());
    expect(localStorage.getItem('files:sidebar')).toBe('collapsed');
    expect(document.getElementById('files-folder-sidebar')).toBeNull();
  });

  it('starts collapsed when the stored preference says so', async () => {
    localStorage.setItem('files:sidebar', 'collapsed');
    renderManager();

    await waitFor(() => expect(screen.getByText('Show folders')).toBeTruthy());
    expect(document.getElementById('files-folder-sidebar')).toBeNull();
  });

  it('carries page chrome only on the /files page, not inside the picker', async () => {
    // Embedded in the media picker this used to render a "File Library" page
    // heading, a second Upload button and a Trash toggle inside the dialog —
    // on top of the picker's own header and drop zone.
    renderManager({ standalone: false, sidebarMode: 'drawer' });

    await waitFor(() => expect(screen.getAllByText('Folders').length).toBeGreaterThan(0));
    expect(screen.queryByText('File Library')).toBeNull();
    expect(screen.queryByText('Manage your images, videos, and files')).toBeNull();
    expect(screen.queryByText(/Trash/)).toBeNull();
  });

  it('keeps page chrome on the standalone /files page', async () => {
    renderManager();

    await waitFor(() => expect(screen.getByText('File Library')).toBeTruthy());
    expect(screen.getByText(/Trash/)).toBeTruthy();
  });

  it('never renders the inline sidebar in drawer mode (modal hosts)', async () => {
    // The inline column is gated on the `lg:` *viewport* query, so inside a
    // 720px dialog it would otherwise still render on any desktop.
    renderManager({ standalone: false, sidebarMode: 'drawer' });

    // The drawer trigger is present; the inline column never is.
    await waitFor(() => expect(screen.getAllByText('Folders').length).toBeGreaterThan(0));
    expect(document.getElementById('files-folder-drawer')).toBeTruthy();
    expect(document.getElementById('files-folder-sidebar')).toBeNull();
    expect(screen.queryByText('Hide folders')).toBeNull();
    expect(screen.queryByText('Show folders')).toBeNull();
  });
});

const lastFilesQuery = () => {
  const call = [...mockFetch.mock.calls]
    .reverse()
    .find(([url]: [string]) => !url.startsWith('/files/folders'));
  return call ? (call[0] as string) : '';
};

describe('FileManager sort selector', () => {
  it('defaults to newest first and reorders through the query string', async () => {
    renderManager();
    await waitFor(() => expect(screen.getByLabelText('Sort files')).toBeTruthy());
    expect((screen.getByLabelText('Sort files') as HTMLSelectElement).value).toBe('createdAt-desc');

    fireEvent.change(screen.getByLabelText('Sort files'), { target: { value: 'name-asc' } });

    await waitFor(() => expect(lastFilesQuery()).toContain('sort=name'));
    expect(lastFilesQuery()).toContain('order=asc');
  });

  it('is offered in grid view, where column headers are not', async () => {
    renderManager();
    await waitFor(() => expect(screen.getByLabelText('Sort files')).toBeTruthy());
    // Grid view is the default — the list view's sortable headers are absent.
    expect(screen.queryByText('Largest first')).toBeTruthy();
  });

  it('returns to the first page when the order changes', async () => {
    respondWith({ files: FILES, folders: FOLDERS });
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('/files/folders')) {
        return Promise.resolve({ ok: true, json: async () => FOLDERS });
      }
      return Promise.resolve({ ok: true, json: async () => ({ results: FILES, pages: 3 }) });
    });
    renderManager();
    await waitFor(() => expect(screen.getByRole('button', { name: '2' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(lastFilesQuery()).toContain('page=2'));

    fireEvent.change(screen.getByLabelText('Sort files'), { target: { value: 'size-desc' } });
    await waitFor(() => expect(lastFilesQuery()).toContain('page=1'));
  });
});

describe('FileManager breadcrumb', () => {
  it('shows the ancestor chain and walks back up', async () => {
    renderManager();
    await waitFor(() => expect(screen.getByLabelText('Open folder Brand assets')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Open folder Brand assets'));

    const trail = await screen.findByLabelText('Folder path');
    await waitFor(() => expect(trail.textContent).toContain('Brand assets'));
    expect(trail.textContent).toContain('All Files');

    // The sidebar tree has its own "All Files" row — take the breadcrumb's.
    fireEvent.click(within(trail).getByRole('button', { name: 'All Files' }));
    await waitFor(() => expect(lastFilesQuery()).toContain('folderId=null'));
  });
});

describe('FileManager URL sync', () => {
  it('opens the folder named by the path on a deep link', async () => {
    navigation.pathname = '/files/Brand%20assets/Logos';
    renderManager({ urlSync: true });

    await waitFor(() => expect(lastFilesQuery()).toContain('folderId=d1a'));
    const trail = await screen.findByLabelText('Folder path');
    expect(trail.textContent).toContain('Logos');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('pushes the folder path when navigating', async () => {
    renderManager({ urlSync: true });
    await waitFor(() => expect(screen.getByLabelText('Open folder Brand assets')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Open folder Brand assets'));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/files/Brand%20assets', { scroll: false })
    );
  });

  it('falls back to the root when the path no longer resolves', async () => {
    navigation.pathname = '/files/Deleted%20folder';
    renderManager({ urlSync: true });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/files', { scroll: false }));
    expect(lastFilesQuery()).toContain('folderId=null');
  });

  it('never touches the location without urlSync (picker hosts)', async () => {
    renderManager({ standalone: false, sidebarMode: 'drawer' });
    await waitFor(() => expect(screen.getByLabelText('Open folder Brand assets')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Open folder Brand assets'));

    await waitFor(() => expect(lastFilesQuery()).toContain('folderId=d1'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
