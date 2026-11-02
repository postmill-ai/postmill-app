import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FolderTree } from './folder-tree';

const mockFetch = vi.fn();
const mockRefresh = vi.fn();
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

const folders = [
  {
    id: 'brand',
    name: 'Brand assets',
    color: null,
    parentId: null,
    children: [],
    _count: { files: 0, children: 0 },
  },
];

const renderTree = (props: Record<string, unknown> = {}) =>
  render(
    <FolderTree
      folders={folders}
      selectedFolderId={null}
      onSelectFolder={vi.fn()}
      onRefresh={mockRefresh}
      {...props}
    />
  );

beforeEach(() => {
  mockFetch.mockReset();
  mockRefresh.mockReset();
  mockToast.mockReset();
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
});

describe('FolderTree creation', () => {
  it('opens the root-folder editor and creates a root folder', async () => {
    renderTree();

    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const input = screen.getByPlaceholderText('Folder name...');
    fireEvent.change(input, { target: { value: 'Campaign assets' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith('/files/folders', {
      method: 'POST',
      body: JSON.stringify({ name: 'Campaign assets', parentId: null }),
    });
    await waitFor(() => expect(screen.queryByPlaceholderText('Folder name...')).toBeNull());
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith('Folder created', 'success');
  });

  it('creates a subfolder from the folder context menu', async () => {
    renderTree();

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Brand assets 0' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New Subfolder' }));
    const input = screen.getByPlaceholderText('Folder name...');
    fireEvent.change(input, { target: { value: 'Logos' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/files/folders', {
      method: 'POST',
      body: JSON.stringify({ name: 'Logos', parentId: 'brand' }),
    }));
  });

  it('keeps the name and reports a failed create', async () => {
    mockFetch.mockResolvedValue({ ok: false, message: 'Folder creation is unavailable' });
    renderTree({ drawerMode: true, showHeader: true });

    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const input = screen.getByPlaceholderText('Folder name...');
    fireEvent.change(input, { target: { value: 'Keep this name' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Folder creation is unavailable', 'warning'));
    expect((input as HTMLInputElement).value).toBe('Keep this name');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('does not submit twice when Enter is followed by blur', async () => {
    let resolveCreate: (value: { ok: boolean }) => void = () => {};
    mockFetch.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    renderTree();

    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const input = screen.getByPlaceholderText('Folder name...');
    fireEvent.change(input, { target: { value: 'Only once' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    resolveCreate({ ok: true });
    await waitFor(() => expect(screen.queryByPlaceholderText('Folder name...')).toBeNull());
  });
});
